/**
 * 符頭を符幹でまとめて和音にし、連桁・旗と付点から音価を決める。
 *
 * - 符幹: 2 つ目のモデルの「符幹・休符」のうち、細長いもの
 * - 連桁・旗: 2 つ目のモデルには出ない (背景になる) ので、元の画像で
 *   符幹の先 (符頭の無い側) の脇を縦に切って、横切る太い線を数える。
 *   旗は斜めに垂れるので横に切ると数えられない
 * - 付点: 1 つ目のモデルの「記号」のうち、符頭の右の小さな丸。付点は
 *   線の間に置かれるので、線の上にあるもの (加線の切れ端) は除く
 *
 * 白玉で符幹が無ければ全音符、白玉で符幹があれば 2 分音符、黒玉は
 * 連桁・旗の数で 4 分・8 分・16 分・32 分音符。
 */

import { connectedComponents, type Component } from "./components";
import type { Duration } from "../model/edit";
import type { NoteType } from "../model/score";
import { SYMBOL_CLASS, STAFF_CLASS } from "./models";
import { clampX, clampY, type Page } from "./page";
import type { Notehead } from "./noteheads";
import { nearestStaff, systemBand } from "./noteheads";
import { staffPosition, type System } from "./staves";

export interface Stem {
  x: number;
  top: number;
  bottom: number;
}

export interface Chord {
  heads: Notehead[];
  staff: number;
  /** 左端 (並べる順に使う) */
  x: number;
  stem: Stem | null;
  /** 符幹が上向きか */
  up: boolean;
  /** 連桁・旗の数 */
  beams: number;
  dots: number;
  duration: Duration;
}

/** 段の中の符幹 */
export function findStems(page: Page, system: System): Stem[] {
  const d = page.spacing;
  const [bandTop, bandBottom] = systemBand(system, d);
  const mask = new Uint8Array(page.symbolLabels.data.length);
  for (let y = Math.max(0, Math.floor(bandTop)); y < Math.min(page.height, bandBottom); y++) {
    for (let x = Math.max(0, Math.floor(system.left)); x < Math.min(page.width, system.right + d); x++) {
      const i = y * page.width + x;
      mask[i] = page.symbolLabels.data[i] === SYMBOL_CLASS.stemOrRest ? 1 : 0;
    }
  }
  const { components } = connectedComponents(mask, page.width, page.height, 3);
  const pieces = components
    .filter((c) => c.right - c.left + 1 <= Math.max(4, d * 0.4) && c.bottom - c.top + 1 >= d * 0.6)
    .map((c) => ({ x: c.cx, top: c.top, bottom: c.bottom }))
    .sort((a, b) => a.x - b.x || a.top - b.top);

  // 途切れた符幹をつなぐ
  const stems: Stem[] = [];
  for (const piece of pieces) {
    const previous = stems.find(
      (s) =>
        Math.abs(s.x - piece.x) <= 2 &&
        piece.top - s.bottom <= d * 1.5 &&
        s.top - piece.bottom <= d * 1.5,
    );
    if (previous) {
      previous.top = Math.min(previous.top, piece.top);
      previous.bottom = Math.max(previous.bottom, piece.bottom);
      previous.x = (previous.x + piece.x) / 2;
    } else {
      stems.push({ ...piece });
    }
  }
  // 細い符幹はモデルが一部しか塗らないことがあるので、元の画像のインクを
  // たどって上下に延ばす (延ばした先の連桁や符頭までが符幹になる)
  const inkAt = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) {
      if (page.ink[clampY(page, y) * page.width + clampX(page, x + dx)] === 1) {
        return true;
      }
    }
    return false;
  };
  for (const stem of stems) {
    const x = Math.round(stem.x);
    const limit = d * 6;
    while (stem.top > 0 && stem.bottom - stem.top < limit && inkAt(x, stem.top - 1)) {
      stem.top--;
    }
    while (stem.bottom < page.height - 1 && stem.bottom - stem.top < limit && inkAt(x, stem.bottom + 1)) {
      stem.bottom++;
    }
  }
  return stems.filter((s) => s.bottom - s.top + 1 >= d * 1.5);
}

/**
 * 列 x を y = from から to へたどって、横切る太い線 (連桁・旗) の数を数える。
 * 見るのは元の画像のインク。連桁が五線に重なると 1 つ目のモデルは五線と
 * 塗るので、ラベルでは数えられない。五線・加線・スラーのような細い線は
 * 数えない。連桁どうしの隙間に五線が重なると 2 本が 1 本につながって
 * 見えるので、太さから本数を割り出す (連桁の太さは線の間隔の 0.5 倍、
 * 隙間は 0.25 倍)。
 */
function strokesAlong(page: Page, x: number, from: number, to: number, heads: Notehead[]): number {
  const d = page.spacing;
  const step = from <= to ? 1 : -1;
  // 隣の音符の符頭も数えない
  const near = heads.filter((h) => x >= h.left - 1 && x <= h.right + 1);
  let strokes = 0;
  let run = 0;
  let other = 0;
  const close = () => {
    // 2 つ目のモデルがほとんど符幹か臨時記号と塗ったものは、隣の符幹や
    // 臨時記号の縦の線 (連桁も一部だけそう塗られることがあるので、
    // 画素ごとには除かない)
    if (run >= d * 0.3 && other < run * 0.7) {
      strokes += Math.max(1, Math.round((run + d * 0.25) / (d * 0.75)));
    }
    run = 0;
    other = 0;
  };
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) {
    const i = clampY(page, y) * page.width + x;
    const onHead = near.some((h) => Math.abs(y - h.y) <= d * 0.55);
    if (!onHead && page.ink[i] === 1) {
      run++;
      const label = page.symbolLabels.data[i];
      if (label === SYMBOL_CLASS.stemOrRest || label === SYMBOL_CLASS.clefOrKey) {
        other++;
      }
    } else {
      close();
    }
  }
  close();
  return strokes;
}

/**
 * 符幹の先の脇 (side = 1 で右、-1 で左) にある連桁・旗の数。符幹の先から
 * 符頭の手前 (y = limit) までを、符幹から少し離れた 3 本の列で数え、
 * その真ん中の値をとる (1 本だけに乗ったごみに引きずられないように)。
 */
function countStrokes(
  page: Page,
  stem: Stem,
  up: boolean,
  limit: number,
  side: 1 | -1,
  heads: Notehead[],
): number {
  const d = page.spacing;
  // 連桁が斜めだと、符幹から離れた所では符幹の先より外にはみ出す
  const from = Math.round(up ? stem.top - d * 0.4 : stem.bottom + d * 0.4);
  const to = Math.round(up ? Math.min(limit, stem.top + d * 3.2) : Math.max(limit, stem.bottom - d * 3.2));
  if (up ? to - from < d * 0.3 : from - to < d * 0.3) {
    return 0;
  }
  // 旗の先は縦に垂れるので、符幹から離れすぎない所で切る
  const counts = [0.3, 0.45, 0.6]
    .map((offset) => strokesAlong(page, clampX(page, stem.x + side * offset * d), from, to, heads))
    .sort((a, b) => a - b);
  return Math.min(3, counts[1]);
}

/** 付点の候補: 1 つ目のモデルの「記号」の、線の間にある小さな丸 */
function findDots(page: Page, system: System): Component[] {
  const d = page.spacing;
  const [bandTop, bandBottom] = systemBand(system, d);
  const mask = new Uint8Array(page.staffLabels.data.length);
  for (let y = Math.max(0, Math.floor(bandTop)); y < Math.min(page.height, bandBottom); y++) {
    for (let x = Math.max(0, Math.floor(system.left)); x < Math.min(page.width, system.right + d * 2); x++) {
      const i = y * page.width + x;
      mask[i] =
        page.staffLabels.data[i] === STAFF_CLASS.symbol &&
        page.symbolLabels.data[i] !== SYMBOL_CLASS.notehead
          ? 1
          : 0;
    }
  }
  const { components } = connectedComponents(mask, page.width, page.height, 2);
  return components.filter((c) => {
    const w = c.right - c.left + 1;
    const h = c.bottom - c.top + 1;
    if (
      w < d * 0.28 ||
      h < d * 0.28 ||
      w > d * 0.8 ||
      h > d * 0.8 ||
      Math.abs(w - h) > d * 0.3 ||
      c.area < w * h * 0.55
    ) {
      return false;
    }
    const staff = system.staves[nearestStaff(system, c.cx, c.cy)];
    const position = staffPosition(staff, c.cx, c.cy);
    return Math.abs(position - 2 * Math.round(position / 2)) >= 0.4;
  });
}

function durationFor(filled: boolean, stem: boolean, beams: number, dots: number): Duration {
  let type: NoteType;
  if (!filled) {
    type = stem ? "half" : "whole";
  } else {
    type = (["quarter", "eighth", "16th", "32nd"] as const)[Math.min(3, stem ? beams : 0)];
  }
  return { type, dots: Math.min(2, dots) };
}

/** 段の符頭を和音にまとめ、音価を決める。x の小さい順 */
export function buildChords(page: Page, system: System, heads: Notehead[]): Chord[] {
  const d = page.spacing;
  const stems = findStems(page, system);
  const dots = findDots(page, system);

  // 符頭をいちばん近い符幹に付ける
  const byStem = new Map<Stem, Notehead[]>();
  const loose: Notehead[] = [];
  for (const head of heads) {
    let best: Stem | null = null;
    let bestDistance = Infinity;
    for (const stem of stems) {
      if (stem.x < head.left - d * 0.45 || stem.x > head.right + d * 0.45) {
        continue;
      }
      if (head.y < stem.top - d * 0.7 || head.y > stem.bottom + d * 0.7) {
        continue;
      }
      const distance = Math.min(Math.abs(stem.x - head.left), Math.abs(stem.x - head.right));
      if (distance < bestDistance) {
        best = stem;
        bestDistance = distance;
      }
    }
    if (best === null) {
      loose.push(head);
    } else {
      byStem.set(best, [...(byStem.get(best) ?? []), head]);
    }
  }

  const chords: Chord[] = [];
  for (const [stem, members] of byStem) {
    // 符幹を共有していても、別の段の符頭は別の和音にする
    for (const staff of new Set(members.map((h) => h.staff))) {
      const group = members.filter((h) => h.staff === staff);
      const highest = Math.min(...group.map((h) => h.y));
      const lowest = Math.max(...group.map((h) => h.y));
      const up = highest - stem.top > stem.bottom - lowest;
      const filled = group.filter((h) => h.filled).length * 2 >= group.length;
      // 符頭には掛からないように、いちばん先の符頭の手前で止める
      const limit = up ? highest - d * 0.8 : lowest + d * 0.8;
      const beams = filled
        ? Math.max(
            countStrokes(page, stem, up, limit, 1, heads),
            countStrokes(page, stem, up, limit, -1, heads),
          )
        : 0;
      chords.push({
        heads: group,
        staff,
        x: Math.min(...group.map((h) => h.left)),
        stem,
        up,
        beams,
        dots: 0,
        duration: durationFor(filled, true, beams, 0),
      });
    }
  }

  // 符幹の無い符頭 (全音符など) は、横に重なるものをまとめる
  for (const head of loose) {
    const chord = chords.find(
      (c) => c.stem === null && c.staff === head.staff && Math.abs(c.heads[0].x - head.x) < d * 0.8,
    );
    if (chord) {
      chord.heads.push(head);
    } else {
      chords.push({
        heads: [head],
        staff: head.staff,
        x: head.left,
        stem: null,
        up: false,
        beams: 0,
        dots: 0,
        duration: durationFor(head.filled, false, 0, 0),
      });
    }
  }

  // 付点: 和音のいちばん右の符頭の右にある小さな丸
  for (const chord of chords) {
    const right = Math.max(...chord.heads.map((h) => h.right));
    const found = dots.filter(
      (dot) =>
        dot.cx > right + d * 0.1 &&
        dot.cx < right + d * 1.6 &&
        chord.heads.some((h) => dot.cy > h.y - d * 0.85 && dot.cy < h.y + d * 0.45),
    );
    if (found.length > 0) {
      // 2 つ並んでいれば複付点
      const xs = [...new Set(found.map((f) => Math.round(f.cx / (d * 0.5))))];
      chord.dots = Math.min(2, xs.length);
      chord.duration = { ...chord.duration, dots: chord.dots };
    }
  }

  return chords.sort((a, b) => a.x - b.x);
}
