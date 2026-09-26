/**
 * 楽譜のデータモデル。
 *
 * このモデルが唯一の真実の情報源で、描画 (OSMD) も再生 (Tone.js) も
 * 保存も、すべてここから生やす。OSMD には状態を持たせない。
 *
 * 対象はピアノの大譜表 (ト音記号 + ヘ音記号の 2 段) に絞っている。
 */

/** 幹音名 */
export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** 幹音名を低い順に並べたもの */
export const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/** 変化記号。-1 = ♭, 0 = なし, 1 = ♯ */
export type Alter = -1 | 0 | 1;

export interface Pitch {
  step: Step;
  /** 中央ハ (C4) を 4 とする国際式 */
  octave: number;
  alter?: Alter;
}

/** 音価。付点は dots で別に持つ */
export type NoteType =
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "16th"
  | "32nd";

/** 音価を長い順に並べたもの */
export const NOTE_TYPES: readonly NoteType[] = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "16th",
  "32nd",
];

/** 大譜表の段。1 = ト音記号 (右手), 2 = ヘ音記号 (左手) */
export type StaffNumber = 1 | 2;

export interface Note {
  id: string;
  /** null なら休符 */
  pitch: Pitch | null;
  type: NoteType;
  /** 付点の数。1 で 1.5 倍、2 で 1.75 倍 */
  dots?: number;
  staff: StaffNumber;
  /** true なら直前の音と同時に鳴る (和音の構成音) */
  chord?: boolean;
  /**
   * true なら、同じ段で次に鳴る同じ高さの音へタイでつなぐ (小節線を
   * またいでもよい)。つなぐ相手が無ければ無視する (ties.ts)
   */
  tie?: boolean;
}

export interface Measure {
  id: string;
  notes: Note[];
  /**
   * true なら、この小節から次の段にする (改段)。紙の楽譜と同じ段組みで
   * 見るためのもので、再生には効かない (#18)
   */
  newSystem?: boolean;
}

export interface Score {
  title: string;
  /** 四分音符あたりの BPM */
  tempo: number;
  /** 調号。0 = ハ長調、正で♯の数、負で♭の数 */
  key: { fifths: number };
  time: { beats: number; beatType: number };
  measures: Measure[];
  /**
   * 表示するときの音符の間隔 (小節の幅) の倍率。無ければ 1。見た目だけの
   * 設定で、再生や書き出しには効かない (#17)
   */
  spacing?: number;
}

/** 小節の幅の倍率の範囲 */
export const SPACING_MIN = 0.5;
export const SPACING_MAX = 2;

export function scoreSpacing(score: Score): number {
  return score.spacing ?? 1;
}

/**
 * MusicXML の divisions。四分音符 1 個ぶんの長さ。
 * 480 は 3 連符 (160) や 32 分音符 (60) まで整数で表せる。
 */
export const DIVISIONS = 480;

/** 音価を四分音符いくつぶんかで表した値 */
export const QUARTER_LENGTH: Record<NoteType, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
};

/** 音符の長さを四分音符単位で返す (付点込み) */
export function noteQuarterLength(note: Note): number {
  const base = QUARTER_LENGTH[note.type];
  const dots = note.dots ?? 0;
  // 付点 1 つで 1.5 倍、2 つで 1.75 倍
  let factor = 1;
  let add = 0.5;
  for (let i = 0; i < dots; i++) {
    factor += add;
    add /= 2;
  }
  return base * factor;
}

/** 1 小節の長さを四分音符単位で返す (6/8 なら 3) */
export function measureQuarterLength(time: Score["time"]): number {
  return (time.beats * 4) / time.beatType;
}

/** 音符の長さを MusicXML の duration (divisions 単位) で返す */
export function noteDuration(note: Note): number {
  return Math.round(noteQuarterLength(note) * DIVISIONS);
}

/**
 * 1 小節のうち、指定した段が占める長さを四分音符単位で返す。
 * 和音の構成音は時間を進めないので除外する。
 */
export function staffQuarterLength(
  measure: Measure,
  staff: StaffNumber,
): number {
  return measure.notes
    .filter((n) => n.staff === staff && !n.chord)
    .reduce((sum, n) => sum + noteQuarterLength(n), 0);
}

/** 音高を "C4" / "F#4" / "Bb3" 形式の文字列にする (Tone.js 用) */
export function pitchToName(pitch: Pitch): string {
  const accidental =
    pitch.alter === 1 ? "#" : pitch.alter === -1 ? "b" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}
