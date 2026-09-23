/**
 * 画像分割モデルを画像全体に掛ける。
 *
 * モデルは決まった大きさ (256×256 など) の正方形しか受けないので、画像を
 * 重なりのあるタイルに切って順に通し、画素ごとに いちばん確からしい
 * クラスを選ぶ。タイルの縁は周りが見えないぶん当たりにくいので、重なって
 * いる所は中心に近いタイルの結果を採る (確率を貯めて平均するより、使う
 * メモリがずっと少なくて済む)。
 *
 * 白紙のタイルはモデルに通さず、背景として扱う。楽譜は余白が多いので、
 * これだけで通す枚数がかなり減る。
 */

import type { GrayImage, LabelImage } from "./image";

export interface SegmentationModel {
  /** 1 枚のタイルの一辺 (画素) */
  tileSize: number;
  /** 出てくるクラスの数 (0 が背景) */
  classes: number;
  /**
   * count 枚ぶんのタイル (RGB、uint8、[count, size, size, 3]) を受け、
   * 画素ごとのクラスの確率 ([count, size, size, classes]) を返す
   */
  run(tiles: Uint8Array, count: number): Promise<Float32Array>;
}

export interface SegmentOptions {
  /** タイルどうしの重なり (一辺に対する割合) */
  overlap?: number;
  /** 一度にモデルへ渡す枚数 */
  batch?: number;
  /** これより白い画素しか無いタイルは通さない */
  blankThreshold?: number;
  /** 渡すと、false を返したタイル (左上の座標と一辺) は通さずに背景とする */
  include?: (left: number, top: number, size: number) => boolean;
  onProgress?: (done: number, total: number) => void;
}

/** タイルの左端 (上端) の並びと、各画素をどのタイルに受け持たせるか */
function tileLayout(length: number, tile: number, step: number) {
  const starts: number[] = [];
  for (let p = 0; ; p += step) {
    const start = Math.min(p, Math.max(0, length - tile));
    if (starts.length === 0 || start !== starts[starts.length - 1]) {
      starts.push(start);
    }
    if (start + tile >= length) {
      break;
    }
  }
  const owner = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    let best = 0;
    let bestDistance = Infinity;
    starts.forEach((start, index) => {
      if (i < start || i >= start + tile) {
        return;
      }
      const distance = Math.abs(i - (start + tile / 2));
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    owner[i] = best;
  }
  return { starts, owner };
}

export async function segment(
  image: GrayImage,
  model: SegmentationModel,
  options: SegmentOptions = {},
): Promise<LabelImage> {
  const tile = model.tileSize;
  const step = Math.max(1, Math.round(tile * (1 - (options.overlap ?? 0.25))));
  const batchSize = options.batch ?? 4;
  const blank = options.blankThreshold ?? 200;

  // タイルより小さい画像は白で広げてから通す
  const width = Math.max(image.width, tile);
  const height = Math.max(image.height, tile);
  const pixel = (x: number, y: number) =>
    x < image.width && y < image.height ? image.data[y * image.width + x] : 255;

  const xs = tileLayout(width, tile, step);
  const ys = tileLayout(height, tile, step);
  const labels = new Uint8Array(width * height);

  interface Tile {
    column: number;
    row: number;
  }
  const pending: Tile[] = [];
  ys.starts.forEach((top, row) => {
    xs.starts.forEach((left, column) => {
      if (options.include && !options.include(left, top, tile)) {
        return;
      }
      for (let y = top; y < top + tile; y++) {
        for (let x = left; x < left + tile; x++) {
          if (pixel(x, y) < blank) {
            pending.push({ column, row });
            return;
          }
        }
      }
    });
  });

  const total = pending.length;
  options.onProgress?.(0, total);
  const classes = model.classes;
  for (let begin = 0; begin < total; begin += batchSize) {
    const batch = pending.slice(begin, begin + batchSize);
    const input = new Uint8Array(batch.length * tile * tile * 3);
    batch.forEach(({ column, row }, b) => {
      const left = xs.starts[column];
      const top = ys.starts[row];
      let o = b * tile * tile * 3;
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          const v = pixel(left + x, top + y);
          input[o++] = v;
          input[o++] = v;
          input[o++] = v;
        }
      }
    });

    const output = await model.run(input, batch.length);

    batch.forEach(({ column, row }, b) => {
      const left = xs.starts[column];
      const top = ys.starts[row];
      const base = b * tile * tile * classes;
      for (let y = 0; y < tile; y++) {
        const gy = top + y;
        if (ys.owner[gy] !== row) {
          continue;
        }
        for (let x = 0; x < tile; x++) {
          const gx = left + x;
          if (xs.owner[gx] !== column) {
            continue;
          }
          const p = base + (y * tile + x) * classes;
          let best = 0;
          for (let c = 1; c < classes; c++) {
            if (output[p + c] > output[p + best]) {
              best = c;
            }
          }
          labels[gy * width + gx] = best;
        }
      }
    });
    options.onProgress?.(Math.min(total, begin + batch.length), total);
  }

  // 広げた所を落として元の大きさに戻す
  if (width === image.width && height === image.height) {
    return { width, height, data: labels };
  }
  const cropped = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) {
    cropped.set(labels.subarray(y * width, y * width + image.width), y * image.width);
  }
  return { width: image.width, height: image.height, data: cropped };
}
