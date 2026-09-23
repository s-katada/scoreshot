/**
 * 音部記号・調号・臨時記号を読む。
 *
 * 2 つ目のモデルは、音部記号と調号 (と臨時記号) を 1 つのクラスに入れる。
 * 五線の頭の背の高いものを音部記号とし (ト音記号は五線より大きくはみ出す、
 * ヘ音記号は五線の上半分に収まる)、その右に並ぶものを調号、それ以外で
 * 符頭のすぐ左にあるものを臨時記号とする。
 *
 * ♯ ♭ ♮ の見分けは形で行う。♭ は下に丸い膨らみがあって下半分が重く、
 * ♯ と ♮ は上下に釣り合っている。♮ は ♯ より細い。
 */

import { connectedComponents, type Component, type ComponentMap } from "./components";
import type { Alter } from "../model/score";
import { SYMBOL_CLASS } from "./models";
import type { Page } from "./page";
import type { Notehead } from "./noteheads";
import { lineY, type Staff, type System } from "./staves";

export type Clef = "treble" | "bass";

export interface StaffSigns {
  clef: Clef;
  /** 調号。正で ♯ の数、負で ♭ の数 */
  fifths: number;
  /** 調号より右 (音符の始まり) の x */
  contentStart: number;
}

export interface SystemSigns {
  staves: StaffSigns[];
  /** 臨時記号が付いた符頭 */
  accidentals: Map<Notehead, Alter>;
}

type AccidentalShape = "sharp" | "flat" | "natural";

/** かたまりの下半分にある画素の割合 */
function lowerMass(map: ComponentMap, width: number, c: Component): number {
  const middle = (c.top + c.bottom) / 2;
  let lower = 0;
  let total = 0;
  for (let y = c.top; y <= c.bottom; y++) {
    for (let x = c.left; x <= c.right; x++) {
      if (map.labels[y * width + x] === c.id) {
        total++;
        if (y > middle) {
          lower++;
        }
      }
    }
  }
  return total === 0 ? 0.5 : lower / total;
}

function shapeOf(map: ComponentMap, width: number, c: Component, spacing: number): AccidentalShape {
  const w = (c.right - c.left + 1) / spacing;
  if (lowerMass(map, width, c) >= 0.58) {
    return "flat";
  }
  return w < 0.8 ? "natural" : "sharp";
}

function isAccidentalSized(c: Component, spacing: number): boolean {
  const w = (c.right - c.left + 1) / spacing;
  const h = (c.bottom - c.top + 1) / spacing;
  return h >= 1.4 && h <= 3.8 && w >= 0.35 && w <= 1.7;
}

function staffBand(staff: Staff, x: number, spacing: number): [number, number] {
  return [lineY(staff, 0, x) - spacing * 3.5, lineY(staff, 4, x) + spacing * 3.5];
}

export function readSigns(page: Page, system: System, heads: Notehead[]): SystemSigns {
  const d = page.spacing;
  const mask = new Uint8Array(page.symbolLabels.data.length);
  const top = Math.max(0, Math.floor(lineY(system.staves[0], 0, system.left) - d * 4));
  const bottom = Math.min(
    page.height,
    Math.ceil(lineY(system.staves[system.staves.length - 1], 4, system.left) + d * 4),
  );
  for (let y = top; y < bottom; y++) {
    for (let x = Math.max(0, Math.floor(system.left - d)); x < Math.min(page.width, system.right); x++) {
      const i = y * page.width + x;
      mask[i] = page.symbolLabels.data[i] === SYMBOL_CLASS.clefOrKey ? 1 : 0;
    }
  }
  const map = connectedComponents(mask, page.width, page.height, Math.round(d * d * 0.3));
  const used = new Set<Component>();

  const staves: StaffSigns[] = system.staves.map((staff, staffIndex) => {
    const inStaff = map.components
      .filter((c) => {
        const [bandTop, bandBottom] = staffBand(staff, c.cx, d);
        return c.cy >= bandTop && c.cy <= bandBottom;
      })
      .sort((a, b) => a.left - b.left);

    // 音部記号: 五線の頭にある背の高いもの
    const clefComponent = inStaff.find(
      (c) => c.left <= staff.left + d * 5 && (c.bottom - c.top + 1) / d >= 2.5,
    );
    let clef: Clef = staffIndex === 0 && system.staves.length > 1 ? "treble" : "bass";
    let cursor = staff.left + d;
    if (clefComponent) {
      used.add(clefComponent);
      clef = (clefComponent.bottom - clefComponent.top + 1) / d >= 5.2 ? "treble" : "bass";
      cursor = clefComponent.right;
    } else if (system.staves.length === 1) {
      clef = "treble";
    }

    // 調号: 音部記号の右に、間を空けずに並ぶ臨時記号の形のもの
    const firstHead = Math.min(
      Infinity,
      ...heads.filter((h) => h.staff === staffIndex).map((h) => h.left),
    );
    const key: Component[] = [];
    for (const c of inStaff) {
      if (used.has(c) || c.left < cursor - d * 0.3 || !isAccidentalSized(c, d)) {
        continue;
      }
      const gap = c.left - cursor;
      if (gap > (key.length === 0 ? d * 2.5 : d * 1.3) || c.right > firstHead - d * 0.5) {
        break;
      }
      key.push(c);
      used.add(c);
      cursor = c.right;
    }
    const shapes = key.map((c) => shapeOf(map, page.width, c, d));
    const flats = shapes.filter((s) => s === "flat").length;
    const fifths = Math.min(7, key.length) * (flats * 2 > key.length ? -1 : 1);
    return { clef, fifths, contentStart: cursor + d * 0.5 };
  });

  // 臨時記号: 残りのうち、符頭のすぐ左にあるもの
  const accidentals = new Map<Notehead, Alter>();
  for (const c of map.components) {
    if (used.has(c) || !isAccidentalSized(c, d)) {
      continue;
    }
    const shape = shapeOf(map, page.width, c, d);
    // ♭ は下の膨らみの高さ、♯ と ♮ は真ん中の高さが符頭に揃う
    const anchor = shape === "flat" ? c.bottom - d * 0.6 : (c.top + c.bottom) / 2;
    let best: Notehead | null = null;
    let bestScore = Infinity;
    for (const head of heads) {
      const gap = head.left - c.right;
      if (gap < -d * 0.3 || gap > d * 2.2) {
        continue;
      }
      const dy = Math.abs(head.y - anchor);
      if (dy > d * 0.7) {
        continue;
      }
      const score = dy + gap * 0.3;
      if (score < bestScore) {
        best = head;
        bestScore = score;
      }
    }
    if (best !== null && !accidentals.has(best)) {
      accidentals.set(best, shape === "sharp" ? 1 : shape === "flat" ? -1 : 0);
    }
  }
  return { staves, accidentals };
}
