/**
 * 検証で使う楽譜を作る。
 */

import { emptyMeasure } from "../../src/model/edit";
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
