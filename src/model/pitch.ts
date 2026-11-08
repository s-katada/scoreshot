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

/** ピアノの鍵盤の範囲 (A0〜C8) を MIDI のノート番号で表したもの */
export const PIANO_LOWEST_MIDI = 21;
export const PIANO_HIGHEST_MIDI = 108;

/** 調号の長調の主音が、幹音でいくつ目か (C = 0)。5 度上がるごとに幹音 4 つ上 */
function tonicStepIndex(fifths: number): number {
  return (((fifths * 4) % 7) + 7) % 7;
}

/**
 * semitones 半音だけ移調した先の調号。同じ高さの調が 2 通りあるとき
 * (変ニ長調と嬰ハ長調など) は ♯♭ の少ない方を選び、同じ数 (変ト長調と
 * 嬰ヘ長調) なら元の調号と同じ側にする。
 */
export function transposedFifths(fifths: number, semitones: number): number {
  // 半音 1 つ上げると、5 度の輪を 7 つ進む
  const base = (((fifths + 7 * semitones) % 12) + 12) % 12;
  const other = base - 12;
  if (other < -7) {
    return base;
  }
  if (Math.abs(other) !== Math.abs(base)) {
    return Math.abs(other) < Math.abs(base) ? other : base;
  }
  return fifths < 0 ? other : base;
}

/**
 * 移調で幹音をいくつずらすか。元の調の主音が行き先の調の主音に移るように
 * 決める (ハ長調から半音上の変ニ長調へなら C→D で 1 つ、オクターブなら 7 つ)。
 */
export function transposedSteps(fromFifths: number, toFifths: number, semitones: number): number {
  const steps = (((tonicStepIndex(toFifths) - tonicStepIndex(fromFifths)) % 7) + 7) % 7;
  // 7 の倍数 (オクターブ) の違いは、半音の数から見積もった幹音の数に
  // いちばん近いものを選ぶ (半音 12 = 幹音 7)
  const estimate = (semitones * 7) / 12;
  return steps + 7 * Math.round((estimate - steps) / 7);
}

/** 幹音の通し番号の音を、ちょうど midi の高さにする変化を付けて返す。付けられなければ null */
function spellAt(number: number, midi: number): Pitch | null {
  const natural = pitchFromDiatonic(number, 0);
  const alter = midi - midiNumber(natural);
  return alter === -1 || alter === 0 || alter === 1 ? withAlter(natural, alter) : null;
}

/**
 * 音高を移調する。幹音を steps だけずらして音程どおりに綴る (C♯ を長 2 度
 * 上げれば D♯)。♯♯ や ♭♭ が要る音はモデルで持てないので、隣の幹音で
 * 綴り直す。そのときは行き先の調号 (toFifths) に合う方、合うものが無ければ
 * 調号と同じ側の変化 (♯ の調なら ♯) を選ぶ。
 */
export function transposePitch(pitch: Pitch, semitones: number, steps: number, toFifths: number): Pitch {
  const midi = midiNumber(pitch) + semitones;
  const number = diatonicNumber(pitch) + steps;
  const direct = spellAt(number, midi);
  if (direct !== null) {
    return direct;
  }
  const options = [number - 1, number + 1, number - 2, number + 2]
    .map((n) => spellAt(n, midi))
    .filter((p): p is Pitch => p !== null);
  return (
    options.find((p) => (p.alter ?? 0) === keyAlter(p.step, toFifths)) ??
    options.find((p) => (toFifths < 0 ? (p.alter ?? 0) <= 0 : (p.alter ?? 0) >= 0)) ??
    options[0]
  );
}
