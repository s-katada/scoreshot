/**
 * 検証で使う楽譜を作る。
 */

import { emptyMeasure, placeNotes, toggleTie } from "../../src/model/edit";
import type { Score } from "../../src/model/score";

/** 両段とも休符だけの小節を count 個並べた楽譜 */
export function blankScore(options: {
  title: string;
  tempo: number;
  fifths: number;
  time: Score["time"];
  measures: number;
}): Score {
  return {
    title: options.title,
    tempo: options.tempo,
    key: { fifths: options.fifths },
    time: { ...options.time },
    measures: Array.from({ length: options.measures }, () => emptyMeasure(options.time)),
  };
}

/**
 * タイの検証用 (#16)。4/4 の 2 小節で、上段は 1 小節目の 3 拍目から
 * 2 分音符の C4+E4 と、2 小節目の頭の 4 分音符の C4+E4。C4 だけを
 * タイでつなぐ。下段は休符だけ。
 */
export function tiedScore(): Score {
  let score = blankScore({ title: "タイ", tempo: 120, fifths: 0, time: { beats: 4, beatType: 4 }, measures: 2 });
  const c4 = { step: "C", octave: 4 } as const;
  const e4 = { step: "E", octave: 4 } as const;
  score = placeNotes(score, { measureIndex: 0, staff: 1, onset: 2 }, [c4, e4], { type: "half", dots: 0 }).score;
  score = placeNotes(score, { measureIndex: 1, staff: 1, onset: 0 }, [c4, e4], { type: "quarter", dots: 0 }).score;
  const start = score.measures[0].notes.find((n) => n.pitch?.step === "C")!;
  return toggleTie(score, start.id).score;
}
