/**
 * 符頭を見つけ、五線上の位置と、黒玉か白玉かを決める。
 *
 * 2 つ目のモデルは符頭を 1 つのクラスに塗り分ける (白玉も塗りつぶして
 * 出る)。和音では符頭どうしがくっついて 1 つのかたまりになるので、
 * かたまりの上端と下端を五線上の位置に丸め、その間に 1 つおき (3 度ずつ)
 * に符頭があるとみなす。2 度でぶつかる符頭は左右にずれて置かれるので、
 * 横に長いかたまりは左右に分けてから数える。
 *
 * 黒玉か白玉かは元の画像で見る。符頭の内側の楕円の平均の明るさが、
 * 黒玉ではインクとほぼ同じ、白玉では穴のぶん明るい。写真はぼけて白玉の
 * 穴が埋まりかけるので、白黒に分けた画像ではなく濃淡のまま比べる。
 * インクの濃さは写真ごとに違うので、そのページの符頭の濃さと紙の明るさ
 * の間でしきい値を決める。符頭を五線や加線が横切るので、五線の画素は
 * 数えない。
 */

import { connectedComponents, type Component } from "./components";
import { SYMBOL_CLASS } from "./models";
import { clampX, clampY, isStaffPixel, type Page } from "./page";
import { lineY, staffPosition, type Staff, type System } from "./staves";

export interface Notehead {
  /** 中心 */
  x: number;
  y: number;
  left: number;
  right: number;
  /** 段の中の何段目か (0 が上) */
  staff: number;
  /** 五線上の位置。上の線が 0、下の線が 8、下へ行くほど大きい */
  position: number;
  filled: boolean;
}

/** かたまりのうち、x が [from, to] の画素の上端と下端 */
function verticalExtent(
  labels: Int32Array,
  width: number,
  component: Component,
  from: number,
  to: number,
): [number, number] | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (let y = component.top; y <= component.bottom; y++) {
    for (let x = from; x <= to; x++) {
      if (labels[y * width + x] === component.id) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return top === Infinity ? null : [top, bottom];
}

/** 横に長いかたまり (2 度でぶつかった符頭) を分ける x。分けなければ null */
function splitColumn(
  labels: Int32Array,
  width: number,
  component: Component,
  spacing: number,
): number | null {
  if (component.right - component.left + 1 < spacing * 2.1) {
    return null;
  }
  let best: number | null = null;
  let bestCount = Infinity;
  const from = Math.round(component.left + spacing * 0.7);
  const to = Math.round(component.right - spacing * 0.7);
  for (let x = from; x <= to; x++) {
    let count = 0;
    for (let y = component.top; y <= component.bottom; y++) {
      if (labels[y * width + x] === component.id) {
        count++;
      }
    }
    if (count < bestCount) {
      bestCount = count;
      best = x;
    }
  }
  return best;
}

/** 黒玉と白玉を分ける明るさ */
function fillThreshold(page: Page): number {
  // インクの濃さ: 符頭と塗られた画素のうち暗い方 (白玉の穴を除くため)
  const heads = new Uint32Array(256);
  const all = new Uint32Array(256);
  let headCount = 0;
  const { data } = page.gray;
  for (let i = 0; i < data.length; i += 3) {
    all[data[i]]++;
    if (page.symbolLabels.data[i] === SYMBOL_CLASS.notehead) {
      heads[data[i]]++;
      headCount++;
    }
  }
  const percentile = (histogram: Uint32Array, total: number, p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histogram[v];
      if (seen >= total * p) {
        return v;
      }
    }
    return 255;
  };
  const ink = headCount === 0 ? 0 : percentile(heads, headCount, 0.25);
  const paper = percentile(all, Math.ceil(data.length / 3), 0.5);
  return ink + (paper - ink) * 0.25;
}

/** 符頭の中が黒いか。五線・加線の画素は数えない */
function isFilled(page: Page, x: number, y: number, threshold: number): boolean {
  const d = page.spacing;
  const rx = d * 0.35;
  const ry = d * 0.3;
  let sum = 0;
  let total = 0;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1) {
        continue;
      }
      const xx = clampX(page, x + dx);
      const yy = clampY(page, y + dy);
      if (isStaffPixel(page, xx, yy)) {
        continue;
      }
      total++;
      sum += page.gray.data[yy * page.width + xx];
    }
  }
  return total === 0 ? true : sum / total < threshold;
}

/** 段の中で、y にいちばん近い五線 */
export function nearestStaff(system: System, x: number, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  system.staves.forEach((staff, i) => {
    const top = lineY(staff, 0, x);
    const bottom = lineY(staff, 4, x);
    const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** 段の上下の範囲 (加線の分だけ広げる) */
export function systemBand(system: System, spacing: number): [number, number] {
  const first = system.staves[0];
  const last = system.staves[system.staves.length - 1];
  const x = (system.left + system.right) / 2;
  return [lineY(first, 0, x) - spacing * 5, lineY(last, 4, x) + spacing * 5];
}

function headsInColumn(
  page: Page,
  staff: Staff,
  staffIndex: number,
  top: number,
  bottom: number,
  left: number,
  right: number,
  threshold: number,
): Notehead[] {
  const d = page.spacing;
  const x = (left + right) / 2;
  const center = (top + bottom) / 2;
  let first = Math.round(staffPosition(staff, x, top + d / 2));
  let last = Math.round(staffPosition(staff, x, bottom - d / 2));
  if (last < first || bottom - top < d * 1.5) {
    first = last = Math.round(staffPosition(staff, x, center));
  }
  const count = Math.max(1, Math.round((last - first) / 2) + 1);
  const heads: Notehead[] = [];
  for (let k = 0; k < count; k++) {
    const position = count === 1 ? first : first + Math.round((k * (last - first)) / (count - 1));
    const y = lineY(staff, position / 2, x);
    heads.push({ x, y, left, right, staff: staffIndex, position, filled: isFilled(page, x, y, threshold) });
  }
  return heads;
}

/** 段ごとの符頭。段の並びと同じ順に返す */
export function findNoteheads(page: Page, systems: System[]): Notehead[][] {
  const d = page.spacing;
  const mask = new Uint8Array(page.symbolLabels.data.length);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = page.symbolLabels.data[i] === SYMBOL_CLASS.notehead ? 1 : 0;
  }
  const { labels, components } = connectedComponents(mask, page.width, page.height, Math.round(d * d * 0.2));
  const result: Notehead[][] = systems.map(() => []);
  const threshold = fillThreshold(page);

  for (const component of components) {
    const w = component.right - component.left + 1;
    const h = component.bottom - component.top + 1;
    // 小さすぎるものは符頭ではない (符幹の切れ端や、テンポ表示の小さな音符など)。
    // 符頭は幅が線の間隔の 1.3 倍、高さが 1 倍くらいある
    if (w < d * 0.85 || h < d * 0.65 || w > d * 4) {
      continue;
    }
    const systemIndex = systems.findIndex((system) => {
      const [top, bottom] = systemBand(system, d);
      return (
        component.cy >= top &&
        component.cy <= bottom &&
        component.cx >= system.left - d &&
        component.cx <= system.right + d
      );
    });
    if (systemIndex < 0) {
      continue;
    }
    const system = systems[systemIndex];
    const staffIndex = nearestStaff(system, component.cx, component.cy);
    const staff = system.staves[staffIndex];

    const split = splitColumn(labels, page.width, component, d);
    const columns: Array<[number, number]> =
      split === null
        ? [[component.left, component.right]]
        : [
            [component.left, split],
            [split + 1, component.right],
          ];
    for (const [left, right] of columns) {
      const extent = verticalExtent(labels, page.width, component, left, right);
      if (extent === null) {
        continue;
      }
      result[systemIndex].push(
        ...headsInColumn(page, staff, staffIndex, extent[0], extent[1], left, right, threshold),
      );
    }
  }
  for (const heads of result) {
    heads.sort((a, b) => a.x - b.x || a.y - b.y);
  }
  return result;
}
