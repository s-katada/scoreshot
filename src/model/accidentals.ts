/**
 * 楽譜に書く臨時記号を決める。
 *
 * Score には鳴る高さ (実音) だけを持たせ、臨時記号は書き出すときに
 * 調号と、同じ小節の中で先に付いた臨時記号から導く。表示用の臨時記号を
 * モデルに持たせると、調号を変えたときに実音と表示がずれるため。
 *
 * 決まりは一般的なもの:
 * - 調号で既に変化している音には付けない (ト長調の F♯)
 * - 調号で変化するはずの音を幹音で鳴らすときは ♮ を付ける
 * - 臨時記号はその小節の終わりまで、同じ段・同じ高さ (オクターブ違いは
 *   別) の音に効く。効いている間は付け直さない
 */

import { staffEvents } from "./edit";
import { comparePitch, keyAlter } from "./pitch";
import type { Measure, Pitch, StaffNumber } from "./score";

export type AccidentalMark = "sharp" | "flat" | "natural";

function markFor(alter: number): AccidentalMark {
  return alter > 0 ? "sharp" : alter < 0 ? "flat" : "natural";
}

/** 小節の中で臨時記号を付ける音符の id と、その記号 */
export function measureAccidentals(
  measure: Measure,
  fifths: number,
): Map<string, AccidentalMark> {
  const marks = new Map<string, AccidentalMark>();
  for (const staff of [1, 2] as StaffNumber[]) {
    // 幹音 + オクターブごとに、今効いている変化
    const current = new Map<string, number>();
    for (const event of staffEvents(measure, staff)) {
      const pitched = event.notes
        .filter((n) => n.pitch !== null)
        .sort((a, b) => comparePitch(a.pitch as Pitch, b.pitch as Pitch));
      for (const note of pitched) {
        const pitch = note.pitch as Pitch;
        const key = `${pitch.step}${pitch.octave}`;
        const alter = pitch.alter ?? 0;
        const active = current.get(key) ?? keyAlter(pitch.step, fifths);
        if (alter !== active) {
          marks.set(note.id, markFor(alter));
          current.set(key, alter);
        }
      }
    }
  }
  return marks;
}
