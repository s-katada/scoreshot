/**
 * 新しい楽譜を作る。
 *
 * 空の大譜表 (両段とも休符だけの小節を並べたもの) を返す。新規作成 (#11)
 * と楽譜ライブラリ (#6) の両方から使う。
 */

import { emptyMeasure } from "./edit";
import type { Score } from "./score";

export interface NewScoreOptions {
  title: string;
  tempo: number;
  /** 調号。0 = ハ長調、正で♯の数、負で♭の数 */
  fifths: number;
  time: Score["time"];
  /** 最初に並べる小節の数 */
  measures: number;
}

export const DEFAULT_NEW_SCORE: NewScoreOptions = {
  title: "無題",
  tempo: 100,
  fifths: 0,
  time: { beats: 4, beatType: 4 },
  measures: 4,
};

export function createEmptyScore(options: NewScoreOptions): Score {
  const count = Math.max(1, Math.floor(options.measures));
  return {
    title: options.title,
    tempo: options.tempo,
    key: { fifths: options.fifths },
    time: { ...options.time },
    measures: Array.from({ length: count }, () => emptyMeasure(options.time)),
  };
}
