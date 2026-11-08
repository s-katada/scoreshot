/** 調号と移調の選択肢。調は、同じ調号を持つ長調と短調を並べて示す */

import { TRANSPOSE_LIMIT } from "../model/edit";
import { transposedFifths } from "../model/pitch";

const MAJOR = ["変ハ", "変ト", "変ニ", "変イ", "変ホ", "変ロ", "ヘ", "ハ", "ト", "ニ", "イ", "ホ", "ロ", "嬰ヘ", "嬰ハ"];
const MINOR = ["変イ", "変ホ", "変ロ", "ヘ", "ハ", "ト", "ニ", "イ", "ホ", "ロ", "嬰ヘ", "嬰ハ", "嬰ト", "嬰ニ", "嬰イ"];

export interface KeySignatureOption {
  fifths: number;
  label: string;
}

export const KEY_SIGNATURES: KeySignatureOption[] = MAJOR.map((major, i) => {
  const fifths = i - 7;
  const marks = fifths === 0 ? "" : fifths > 0 ? ` (♯${fifths})` : ` (♭${-fifths})`;
  return { fifths, label: `${major}長調 / ${MINOR[i]}短調${marks}` };
});

/** 拍子の分母の選択肢 */
export const BEAT_TYPE_OPTIONS = [2, 4, 8, 16] as const;

const INTERVAL_NAMES = [
  "",
  "短2度",
  "長2度",
  "短3度",
  "長3度",
  "完全4度",
  "増4度",
  "完全5度",
  "短6度",
  "長6度",
  "短7度",
  "長7度",
  "1 オクターブ",
];

export interface TransposeOption {
  semitones: number;
  label: string;
}

/** 移調の選択肢。上げる方から下げる方へ、行き先の調と並べて示す */
export function transposeOptions(fifths: number): TransposeOption[] {
  const options: TransposeOption[] = [];
  for (let semitones = TRANSPOSE_LIMIT; semitones >= -TRANSPOSE_LIMIT; semitones--) {
    if (semitones === 0) {
      continue;
    }
    const arrow = semitones > 0 ? "↑" : "↓";
    const interval = INTERVAL_NAMES[Math.abs(semitones)];
    const key = KEY_SIGNATURES.find((k) => k.fifths === transposedFifths(fifths, semitones));
    const label =
      Math.abs(semitones) === 12 ? `${arrow} ${interval}` : `${arrow} ${interval} → ${key?.label ?? ""}`;
    options.push({ semitones, label });
  }
  return options;
}
