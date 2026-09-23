/**
 * 休符を見つけて種類を決める。
 *
 * 2 つ目のモデルは休符を符幹と同じクラスに入れるので、そのうち細長く
 * ないものを休符とする。種類は高さと位置で決める:
 *
 * - 全休符・2 分休符: 平たい長方形。第 4 線からぶら下がるのが全休符、
 *   第 3 線に乗るのが 2 分休符
 * - 8 分休符: 線の間隔の 2 倍くらいの高さ
 * - 4 分休符・16 分休符: 3 倍くらいの高さ。16 分休符の方が幅がある
 * - 32 分休符: それより高い
 */

import { connectedComponents } from "./components";
import type { NoteType } from "../model/score";
import { SYMBOL_CLASS } from "./models";
import type { Page } from "./page";
import { nearestStaff, systemBand } from "./noteheads";
import { staffPosition, type System } from "./staves";

export interface Rest {
  staff: number;
  x: number;
  type: NoteType;
  /** 全休符の形。小節まるごと休むことが多い */
  wholeShape: boolean;
}

export function findRests(page: Page, system: System): Rest[] {
  const d = page.spacing;
  const [bandTop, bandBottom] = systemBand(system, d);
  const mask = new Uint8Array(page.symbolLabels.data.length);
  for (let y = Math.max(0, Math.floor(bandTop)); y < Math.min(page.height, bandBottom); y++) {
    for (let x = Math.max(0, Math.floor(system.left)); x < Math.min(page.width, system.right); x++) {
      const i = y * page.width + x;
      mask[i] = page.symbolLabels.data[i] === SYMBOL_CLASS.stemOrRest ? 1 : 0;
    }
  }
  const { components } = connectedComponents(mask, page.width, page.height, Math.round(d * d * 0.3));
  const rests: Rest[] = [];
  for (const c of components) {
    const w = (c.right - c.left + 1) / d;
    const h = (c.bottom - c.top + 1) / d;
    // 符幹や小節線 (細長いもの) は除く
    if (w <= 0.45 || w > 2) {
      continue;
    }
    const staff = nearestStaff(system, c.cx, c.cy);
    const position = staffPosition(system.staves[staff], c.cx, c.cy);
    // 五線から大きく外れたものは休符ではない
    if (position < -3 || position > 11) {
      continue;
    }
    let type: NoteType;
    let wholeShape = false;
    if (h <= 0.85 && w >= 0.7) {
      wholeShape = position < 3;
      type = wholeShape ? "whole" : "half";
    } else if (h < 1.3) {
      continue;
    } else if (h < 2.3) {
      type = "eighth";
    } else if (h < 3.6) {
      type = w >= 1.25 ? "16th" : "quarter";
    } else {
      type = "32nd";
    }
    rests.push({ staff, x: c.left, type, wholeShape });
  }
  return rests.sort((a, b) => a.x - b.x);
}
