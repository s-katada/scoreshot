/**
 * 音高の計算。
 *
 * 五線上の位置 (幹音) と実際に鳴る高さ (半音) は別物で、編集では両方を使う。
 * 五線上で 1 段上げるのは幹音の 1 つ上 (E→F)、並べ替えや重複の判定は
 * 半音で比べる。
 */

import { STEPS, type Alter, type Pitch, type Step } from "./score";

const STEP_SEMITONES: Record<Step, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** MIDI のノート番号。C4 = 60 */
export function midiNumber(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + (pitch.alter ?? 0);
}

/** 幹音の通し番号。C0 = 0 で、幹音が 1 つ上がるごとに 1 増える */
export function diatonicNumber(pitch: Pitch): number {
  return pitch.octave * 7 + STEPS.indexOf(pitch.step);
}

/** ピアノの鍵盤の範囲 (A0〜C8) を幹音の通し番号で表したもの */
export const PIANO_LOWEST = diatonicNumber({ step: "A", octave: 0 });
export const PIANO_HIGHEST = diatonicNumber({ step: "C", octave: 8 });

/** 調号で ♯ が付く順と ♭ が付く順 */
const SHARP_ORDER: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Step[] = ["B", "E", "A", "D", "G", "C", "F"];

/** 調号のもとで、その幹音が臨時記号なしで取る変化 */
export function keyAlter(step: Step, fifths: number): Alter {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) {
    return 1;
  }
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(step)) {
    return -1;
  }
  return 0;
}

/**
 * 幹音の通し番号から音高を作る。変化は調号に従わせる
 * (ト長調で F の位置に置けば F♯ になる)。
 */
export function pitchFromDiatonic(number: number, fifths: number): Pitch {
  const index = ((number % 7) + 7) % 7;
  const step = STEPS[index];
  const octave = Math.floor(number / 7);
  const alter = keyAlter(step, fifths);
  return alter === 0 ? { step, octave } : { step, octave, alter };
}

export function samePitch(a: Pitch, b: Pitch): boolean {
  return (
    a.step === b.step && a.octave === b.octave && (a.alter ?? 0) === (b.alter ?? 0)
  );
}

/** 低い順に並べるための比較 */
export function comparePitch(a: Pitch, b: Pitch): number {
  return midiNumber(a) - midiNumber(b) || diatonicNumber(a) - diatonicNumber(b);
}

/** 変化記号を付け替えた音高 (0 なら alter を持たない形にする) */
export function withAlter(pitch: Pitch, alter: Alter): Pitch {
  const { step, octave } = pitch;
  return alter === 0 ? { step, octave } : { step, octave, alter };
}
