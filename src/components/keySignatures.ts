/** 調号の選択肢。同じ調号を持つ長調と短調を並べて示す */

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
