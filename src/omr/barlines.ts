/**
 * 小節線を見つけて、段を小節に区切る。
 *
 * 小節線は五線の上端から下端まで (大譜表なら上の段から下の段まで) 切れ目
 * なく走る。1 つ目のモデルの「記号」がその範囲をほぼ埋めている線を
 * 小節線とする。符幹は五線 1 つぶんより短く、2 段をまたぐこともないので
 * 紛れない。
 *
 * 写真は傾いているので、真下ではなく五線に直交する向きにたどる (1° 傾くと
 * 大譜表の上から下までで線の太さより大きくずれる)。斜めから撮ると縦の
 * 線は遠近でさらに傾くので、その向きから少しずつ振っても確かめる。紙の
 * たわみで少し曲がるぶんは、左右 1 画素まで見込む。
 */

import { STAFF_CLASS } from "./models";
import type { Page } from "./page";
import { lineY, type System } from "./staves";

/**
 * 上の線の x0 から傾き slope (五線の dy/dx) に直交する向きに、y の範囲を
 * たどったとき、線 (記号か、インクの乗った五線) で埋まっている割合
 */
function coverage(page: Page, x0: number, y0: number, slope: number, top: number, bottom: number): number {
  let covered = 0;
  let total = 0;
  for (let y = Math.max(0, Math.round(top)); y <= Math.min(page.height - 1, Math.round(bottom)); y++) {
    const x = Math.round(x0 - (y - y0) * slope);
    total++;
    for (let dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || x + dx >= page.width) {
        continue;
      }
      const i = y * page.width + x + dx;
      const label = page.staffLabels.data[i];
      if (label === STAFF_CLASS.symbol || (label === STAFF_CLASS.staff && page.ink[i] === 1)) {
        covered++;
        break;
      }
    }
  }
  return total === 0 ? 0 : covered / total;
}

/** 五線の直交方向からの、小節線の傾きの候補 (dx/dy、±3.4° まで) */
const LEANS = [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03, -0.04, 0.04, -0.05, 0.05, -0.06, 0.06];

/** 小節の左右の x。段の頭 (音部記号など) を含む最初の小節から順に */
export function measureBounds(page: Page, system: System): Array<[number, number]> {
  const d = page.spacing;
  const first = system.staves[0];
  const last = system.staves[system.staves.length - 1];
  const threshold = system.staves.length > 1 ? 0.9 : 0.95;

  const columns: number[] = [];
  for (let x = Math.ceil(system.left + d); x <= Math.floor(system.right); x++) {
    const y0 = lineY(first, 0, x);
    const slope = (lineY(first, 0, x + d * 4) - lineY(first, 0, x - d * 4)) / (d * 8);
    // 小節線は五線から少しはみ出さない範囲で測る (上下端の揺れを見込む)
    const top = y0 + 1;
    const bottom = lineY(last, 4, x - (lineY(last, 4, x) - y0) * slope) - 1;
    // 斜めから撮った写真では、縦の線が遠近で五線の直交方向から少し傾く
    // (大譜表の上から下までで数画素ずれる)。傾きを少しずつ振って確かめる
    if (LEANS.some((lean) => coverage(page, x, y0, slope + lean, top, bottom) >= threshold)) {
      columns.push(x);
    }
  }

  // 隣り合う列 (太い線・複縦線) を 1 本にまとめる
  const lines: number[] = [];
  let groupStart = -1;
  let previous = -Infinity;
  for (const x of [...columns, Infinity]) {
    if (x - previous > d * 0.8) {
      if (groupStart >= 0) {
        lines.push((groupStart + previous) / 2);
      }
      groupStart = x;
    }
    previous = x;
  }

  const bounds: number[] = [system.left, ...lines.filter((x) => x > system.left + d * 1.5)];
  if (system.right - bounds[bounds.length - 1] > d * 2) {
    bounds.push(system.right);
  }
  const measures: Array<[number, number]> = [];
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] - bounds[i - 1] >= d * 1.5) {
      measures.push([bounds[i - 1], bounds[i]]);
    }
  }
  return measures;
}
