/**
 * 五線を見つける。
 *
 * 1 つ目のモデルが五線の画素だけを分けてくれるので、それを縦の帯に切り、
 * 帯ごとに横方向に数えて線の高さを拾う。5 本が等間隔に並んでいる所を
 * 五線とし、隣り合う帯の五線どうしをつないで 1 本の五線にする。帯ごとに
 * 拾うので、写真の少しの傾きや紙のたわみにも付いていける。
 */

import { STAFF_CLASS } from "./models";
import type { LabelImage } from "./image";

/** ある x での 5 本の線の高さ */
export interface StaffSample {
  x: number;
  lines: [number, number, number, number, number];
}

export interface Staff {
  left: number;
  right: number;
  /** x の小さい順 */
  samples: StaffSample[];
  /** 線の間隔 */
  spacing: number;
}

export interface System {
  /** 上から順。ピアノの大譜表なら 2 段 */
  staves: Staff[];
  left: number;
  right: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * x での、上から line 本目 (0〜4、はみ出してもよい) の線の高さ。拾った
 * 所の間はつなぎ、端より外は端の近くの傾きのまま延ばす (写真の傾き)
 */
export function lineY(staff: Staff, line: number, x: number): number {
  const samples = staff.samples;
  const at = (s: StaffSample) => {
    const spacing = (s.lines[4] - s.lines[0]) / 4;
    return s.lines[0] + line * spacing;
  };
  if (samples.length === 1) {
    return at(samples[0]);
  }
  let a: StaffSample;
  let b: StaffSample;
  if (x <= samples[0].x) {
    a = samples[0];
    b = samples[Math.min(2, samples.length - 1)];
  } else if (x >= samples[samples.length - 1].x) {
    a = samples[Math.max(0, samples.length - 3)];
    b = samples[samples.length - 1];
  } else {
    let i = 1;
    while (samples[i].x < x) {
      i++;
    }
    a = samples[i - 1];
    b = samples[i];
  }
  const t = (x - a.x) / (b.x - a.x);
  return at(a) * (1 - t) + at(b) * t;
}

/**
 * (x, y) の五線上の位置。上の線が 0、下の線が 8 で、線と間が 1 ずつ
 * (半音ではなく幹音 1 つぶん)。上に行くほど小さい。
 */
export function staffPosition(staff: Staff, x: number, y: number): number {
  const top = lineY(staff, 0, x);
  const bottom = lineY(staff, 4, x);
  return ((y - top) / (bottom - top)) * 8;
}

/**
 * 帯の中で線の高さを拾う。傾いた線は帯の中で数行に散らばるので、五線の
 * 画素が続く行をひとまとめにし、合わせて帯の幅の 35% 以上あれば線とする。
 * 線の太さより厚いまとまり (五線と塗られた連桁など) は線としない。
 */
function lineCenters(
  mask: Uint8Array,
  width: number,
  height: number,
  from: number,
  to: number,
  spacing: number,
): number[] {
  const span = to - from;
  const low = span * 0.08;
  const needed = span * 0.35;
  const thickest = Math.max(3, spacing * 0.8);
  const centers: number[] = [];
  let rows = 0;
  let weight = 0;
  let weighted = 0;
  for (let y = 0; y <= height; y++) {
    let count = 0;
    if (y < height) {
      const row = y * width;
      for (let x = from; x < to; x++) {
        count += mask[row + x];
      }
    }
    if (count >= low && y < height) {
      rows++;
      weight += count;
      weighted += count * y;
    } else if (rows > 0) {
      if (weight >= needed && rows <= thickest) {
        centers.push(weighted / weight);
      }
      rows = 0;
      weight = 0;
      weighted = 0;
    }
  }
  return centers;
}

/** 等間隔に並んだ 5 本を五線として取り出す */
function groupIntoStaves(centers: number[], spacing: number): Array<StaffSample["lines"]> {
  const staves: Array<StaffSample["lines"]> = [];
  let i = 0;
  while (i + 4 < centers.length) {
    const lines = centers.slice(i, i + 5);
    const gaps = lines.slice(1).map((y, k) => y - lines[k]);
    const ok =
      gaps.every((g) => g > spacing * 0.6 && g < spacing * 1.45) &&
      Math.max(...gaps) / Math.min(...gaps) < 1.35;
    if (ok) {
      staves.push(lines as StaffSample["lines"]);
      i += 5;
    } else {
      i += 1;
    }
  }
  return staves;
}

/** 線の端を、五線の画素が途切れる所まで探す */
function extent(mask: Uint8Array, width: number, staff: Staff, direction: -1 | 1): number {
  const start = direction < 0 ? staff.samples[0] : staff.samples[staff.samples.length - 1];
  const gapLimit = Math.max(3, Math.round(staff.spacing));
  let edge = start.x;
  for (const line of [1, 2, 3]) {
    let x = Math.round(start.x);
    let gap = 0;
    let last = x;
    while (x >= 0 && x < width && gap <= gapLimit) {
      const y = Math.round(lineY(staff, line, x));
      let hit = false;
      for (let dy = -1; dy <= 1; dy++) {
        if (mask[(y + dy) * width + x] === 1) {
          hit = true;
        }
      }
      if (hit) {
        last = x;
        gap = 0;
      } else {
        gap++;
      }
      x += direction;
    }
    edge = direction < 0 ? Math.min(edge, last) : Math.max(edge, last);
  }
  return edge;
}

/**
 * 五線を見つける。spacing は線の間隔の見込み (縮尺合わせをしていれば
 * 目標の値)。上から順に返す。
 */
export function findStaves(staffLabels: LabelImage, spacing: number): Staff[] {
  const { width, height } = staffLabels;
  const mask = new Uint8Array(staffLabels.data.length);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = staffLabels.data[i] === STAFF_CLASS.staff ? 1 : 0;
  }

  // 帯が広いと、傾いた線が帯の中で大きくずれる
  const stripWidth = Math.max(16, Math.round(spacing * 6));
  interface Chain {
    samples: StaffSample[];
    lastStrip: number;
  }
  const chains: Chain[] = [];
  for (let from = 0, strip = 0; from < width; from += stripWidth, strip++) {
    const to = Math.min(width, from + stripWidth);
    if (to - from < stripWidth / 2) {
      break;
    }
    const x = (from + to) / 2;
    for (const lines of groupIntoStaves(lineCenters(mask, width, height, from, to, spacing), spacing)) {
      const chain = chains.find(
        (c) =>
          strip - c.lastStrip <= 4 &&
          Math.abs(c.samples[c.samples.length - 1].lines[0] - lines[0]) < spacing * 1.5,
      );
      if (chain) {
        chain.samples.push({ x, lines });
        chain.lastStrip = strip;
      } else {
        chains.push({ samples: [{ x, lines }], lastStrip: strip });
      }
    }
  }

  const staves: Staff[] = [];
  for (const chain of chains) {
    if (chain.samples.length < 3) {
      continue;
    }
    const gaps = chain.samples.flatMap((s) => s.lines.slice(1).map((y, k) => y - s.lines[k]));
    const staff: Staff = {
      left: chain.samples[0].x,
      right: chain.samples[chain.samples.length - 1].x,
      samples: chain.samples,
      spacing: median(gaps),
    };
    staff.left = extent(mask, width, staff, -1);
    staff.right = extent(mask, width, staff, 1);
    if (staff.right - staff.left < width * 0.15) {
      continue;
    }
    staves.push(staff);
  }
  return staves.sort((a, b) => a.samples[0].lines[0] - b.samples[0].lines[0]);
}

/** 五線の真ん中あたりでの上下の線の高さ */
function verticalRange(staff: Staff): [number, number] {
  const x = (staff.left + staff.right) / 2;
  return [lineY(staff, 0, x), lineY(staff, 4, x)];
}

/**
 * 五線を段 (大譜表) にまとめる。
 *
 * ピアノの楽譜は上下 2 段で 1 組になり、組の中の間隔は組と組の間隔より
 * 狭い。隣との間が狭い方と組にする。組にならない五線は 1 段の段にする。
 */
export function groupSystems(staves: Staff[]): System[] {
  const gaps = staves.slice(1).map((staff, i) => verticalRange(staff)[0] - verticalRange(staves[i])[1]);
  const systems: System[] = [];
  let i = 0;
  while (i < staves.length) {
    const here = staves[i];
    const next = staves[i + 1];
    const gap = gaps[i];
    const overlap =
      next !== undefined
        ? Math.min(here.right, next.right) - Math.max(here.left, next.left)
        : 0;
    const pairable =
      next !== undefined &&
      overlap > 0.5 * Math.min(here.right - here.left, next.right - next.left) &&
      gap < here.spacing * 12 &&
      (gaps[i + 1] === undefined || gap <= gaps[i + 1] * 1.05);
    const members = pairable ? [here, next] : [here];
    systems.push({
      staves: members,
      left: Math.min(...members.map((s) => s.left)),
      right: Math.max(...members.map((s) => s.right)),
    });
    i += members.length;
  }
  return systems;
}
