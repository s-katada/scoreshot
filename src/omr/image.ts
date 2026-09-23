/**
 * OMR で扱う画像。
 *
 * DOM に頼らない素の配列で持つ (ブラウザでも Node の検証でも同じ処理を
 * 通すため)。濃淡画像は 0 = 黒 〜 255 = 白、ラベル画像は画素ごとの
 * クラス番号。
 */

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface LabelImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * RGBA (canvas の ImageData など) を濃淡画像にする。透明な所は白い紙として
 * 扱う (MuseScore などが書き出す PNG は背景が透明なことがある)。
 */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const alpha = rgba[p + 3] / 255;
    const luma = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    data[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return { width, height, data };
}

/**
 * 倍率 scale で拡大・縮小する。縮小は面積平均 (細い線が消えにくい)、
 * 拡大は双線形補間。
 */
export function resizeGray(image: GrayImage, scale: number): GrayImage {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8Array(width * height);
  const sx = image.width / width;
  const sy = image.height / height;

  if (scale < 1) {
    for (let y = 0; y < height; y++) {
      const y0 = y * sy;
      const y1 = Math.min(image.height, (y + 1) * sy);
      for (let x = 0; x < width; x++) {
        const x0 = x * sx;
        const x1 = Math.min(image.width, (x + 1) * sx);
        let sum = 0;
        let area = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          const row = yy * image.width;
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
            sum += image.data[row + xx] * w;
            area += w;
          }
        }
        out[y * width + x] = Math.round(sum / area);
      }
    }
    return { width, height, data: out };
  }

  for (let y = 0; y < height; y++) {
    const fy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = image.data[y0 * image.width + x0];
      const b = image.data[y0 * image.width + x1];
      const c = image.data[y1 * image.width + x0];
      const d = image.data[y1 * image.width + x1];
      out[y * width + x] = Math.round(
        a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty,
      );
    }
  }
  return { width, height, data: out };
}

/**
 * 紙の地を白に揃える (写真の照明のむらや紙の色を消す)。
 *
 * 画像を升目に切り、升目ごとに明るい方の画素 (上位 10%) の値を紙の地の
 * 明るさとみなす。升目がまるごと記号で埋まることもあるので、周りの升目
 * のうち明るいものも見る。これを滑らかにつないで割ることで、地は 255 に、
 * インクは地との比で暗いまま残る。
 */
export function flattenBackground(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const cell = Math.min(64, Math.max(12, Math.round(Math.min(width, height) / 48)));
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const paper = new Float32Array(columns * rows);
  const histogram = new Uint32Array(256);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      histogram.fill(0);
      let count = 0;
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y++) {
        for (let x = column * cell; x < Math.min(width, (column + 1) * cell); x++) {
          histogram[data[y * width + x]]++;
          count++;
        }
      }
      let seen = 0;
      let value = 255;
      while (value > 0 && seen + histogram[value] < count * 0.1) {
        seen += histogram[value];
        value--;
      }
      paper[row * columns + column] = value;
    }
  }
  // 周りの升目の明るい方をとる
  const spread = new Float32Array(paper.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy;
          const c = column + dx;
          if (r >= 0 && r < rows && c >= 0 && c < columns) {
            best = Math.max(best, paper[r * columns + c]);
          }
        }
      }
      spread[row * columns + column] = Math.max(1, best);
    }
  }
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const r0 = Math.floor(fy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const ty = fy - r0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(columns - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const c0 = Math.floor(fx);
      const c1 = Math.min(columns - 1, c0 + 1);
      const tx = fx - c0;
      const background =
        spread[r0 * columns + c0] * (1 - tx) * (1 - ty) +
        spread[r0 * columns + c1] * tx * (1 - ty) +
        spread[r1 * columns + c0] * (1 - tx) * ty +
        spread[r1 * columns + c1] * tx * ty;
      out[y * width + x] = Math.min(255, Math.round((data[y * width + x] * 255) / background));
    }
  }
  return { width, height, data: out };
}

/** 大津の方法で、黒と白を分けるしきい値を決める */
export function otsuThreshold(image: GrayImage): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of image.data) {
    histogram[value]++;
  }
  const total = image.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    sumAll += i * histogram[i];
  }
  let sumBack = 0;
  let weightBack = 0;
  let best = 0;
  let bestThreshold = 128;
  for (let t = 0; t < 256; t++) {
    weightBack += histogram[t];
    if (weightBack === 0) {
      continue;
    }
    const weightFore = total - weightBack;
    if (weightFore === 0) {
      break;
    }
    sumBack += t * histogram[t];
    const meanBack = sumBack / weightBack;
    const meanFore = (sumAll - sumBack) / weightFore;
    const between = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (between > best) {
      best = between;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

/** しきい値以下 (黒) を 1、それ以外を 0 にした配列 */
export function binarize(image: GrayImage, threshold = otsuThreshold(image)): Uint8Array {
  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = image.data[i] <= threshold ? 1 : 0;
  }
  return out;
}
