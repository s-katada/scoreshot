/**
 * タイ (#16)。
 *
 * タイは音符の `tie` の印だけで持ち、つなぐ相手は持たない。相手は「同じ段で
 * 次に鳴る音 (次の小節の頭も含む) のうち、同じ高さのもの」と決まるので、
 * 必要なときにここで求める。相手が無い印 (高さを変えた・次の音を消した
 * など) は無視する。印と相手を別々に持つと、編集のたびに両方を揃え直す
 * 必要が出るため。
 */

import { staffEvents } from "./edit";
import { samePitch } from "./pitch";
import type { Note, Score, StaffNumber } from "./score";

/** その段で次に鳴る音 (和音ならそのすべて)。無ければ null */
function nextEventNotes(score: Score, measureIndex: number, staff: StaffNumber, onset: number): Note[] | null {
  const events = staffEvents(score.measures[measureIndex], staff);
  const i = events.findIndex((e) => Math.abs(e.onset - onset) < 1e-9);
  if (i >= 0 && i + 1 < events.length) {
    return events[i + 1].notes;
  }
  const next = score.measures[measureIndex + 1];
  if (next === undefined) {
    return null;
  }
  return staffEvents(next, staff)[0]?.notes ?? null;
}

/** タイでつながる音の組。キーはタイを付けた音の id、値はつながる先の音 */
export function tiePairs(score: Score): Map<string, Note> {
  const pairs = new Map<string, Note>();
  score.measures.forEach((measure, measureIndex) => {
    for (const staff of [1, 2] as StaffNumber[]) {
      for (const event of staffEvents(measure, staff)) {
        for (const note of event.notes) {
          if (!note.tie || note.pitch === null) {
            continue;
          }
          const target = nextEventNotes(score, measureIndex, staff, event.onset)?.find(
            (n) => n.pitch !== null && samePitch(n.pitch, note.pitch!),
          );
          if (target !== undefined) {
            pairs.set(note.id, target);
          }
        }
      }
    }
  });
  return pairs;
}

/** 音 note からタイでつなげる相手。無ければ null */
export function tieTarget(score: Score, noteId: string): Note | null {
  const copy: Score = {
    ...score,
    measures: score.measures.map((m) => ({
      ...m,
      notes: m.notes.map((n) => (n.id === noteId ? { ...n, tie: true } : n)),
    })),
  };
  return tiePairs(copy).get(noteId) ?? null;
}
