/**
 * 連結成分 (つながった画素のかたまり) を取り出す。
 *
 * 符頭・符幹・休符などは、ラベル画像の上ではそれぞれ 1 つのかたまりに
 * なるので、まずかたまりに分けてから形や位置を調べる。
 */

export interface Component {
  /** labels に書かれる番号 (1 始まり) */
  id: number;
  left: number;
  top: number;
  /** 右端・下端の画素 (含む) */
  right: number;
  bottom: number;
  area: number;
  /** 重心 */
  cx: number;
  cy: number;
}

export interface ComponentMap {
  /** 画素ごとのかたまりの番号。0 はかたまりでない */
  labels: Int32Array;
  components: Component[];
}

/**
 * mask の 1 の画素を、8 近傍でつながったかたまりに分ける。
 * minArea より小さいかたまりは捨てる (labels も 0 に戻す)。
 */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 1,
): ComponentMap {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  const stack = new Int32Array(width * height);
  let next = 1;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) {
      continue;
    }
    const id = next++;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let left = width;
    let right = -1;
    let upper = height;
    let lower = -1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    const members: number[] = [];

    while (top > 0) {
      const p = stack[--top];
      members.push(p);
      const x = p % width;
      const y = (p - x) / width;
      area++;
      sumX += x;
      sumY += y;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < upper) upper = y;
      if (y > lower) lower = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) {
            continue;
          }
          const q = ny * width + nx;
          if (mask[q] !== 0 && labels[q] === 0) {
            labels[q] = id;
            stack[top++] = q;
          }
        }
      }
    }

    if (area < minArea) {
      for (const p of members) {
        labels[p] = 0;
      }
      continue;
    }
    components.push({
      id,
      left,
      top: upper,
      right,
      bottom: lower,
      area,
      cx: sumX / area,
      cy: sumY / area,
    });
  }
  return { labels, components };
}

/** ラベル画像のうち、クラスが classId の画素を 1 にした配列 */
export function classMask(labels: Uint8Array, classId: number): Uint8Array {
  const mask = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    mask[i] = labels[i] === classId ? 1 : 0;
  }
  return mask;
}

export function width(component: Component): number {
  return component.right - component.left + 1;
}

export function height(component: Component): number {
  return component.bottom - component.top + 1;
}
