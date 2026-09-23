/**
 * 空の楽譜を新しく作るときの設定欄。
 */

import { useState, type FormEvent } from "react";
import { DEFAULT_NEW_SCORE, type NewScoreOptions } from "../model/newScore";
import { TEMPO_MAX, TEMPO_MIN } from "../model/validate";
import { BEAT_TYPE_OPTIONS, KEY_SIGNATURES } from "./keySignatures";
import { primaryButtonClass, secondaryButtonClass } from "./styles";

interface NewScoreFormProps {
  onCreate: (options: NewScoreOptions) => void;
  onCancel: () => void;
  /** 作成ボタンの横に添える注意書き */
  notice?: string;
  submitLabel?: string;
}

const fieldClass =
  "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

/** 数値の欄。範囲外や空欄は範囲に収めて読む */
function readNumber(value: string, min: number, max: number, fallback: number): number {
  const number = Math.round(Number(value));
  if (value.trim() === "" || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

export function NewScoreForm({
  onCreate,
  onCancel,
  notice,
  submitLabel = "作成",
}: NewScoreFormProps) {
  const [title, setTitle] = useState(DEFAULT_NEW_SCORE.title);
  const [fifths, setFifths] = useState(DEFAULT_NEW_SCORE.fifths);
  const [beats, setBeats] = useState(String(DEFAULT_NEW_SCORE.time.beats));
  const [beatType, setBeatType] = useState<number>(DEFAULT_NEW_SCORE.time.beatType);
  const [tempo, setTempo] = useState(String(DEFAULT_NEW_SCORE.tempo));
  const [measures, setMeasures] = useState(String(DEFAULT_NEW_SCORE.measures));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate({
      title: title.trim() === "" ? DEFAULT_NEW_SCORE.title : title.trim(),
      fifths,
      time: {
        beats: readNumber(beats, 1, 32, DEFAULT_NEW_SCORE.time.beats),
        beatType,
      },
      tempo: readNumber(tempo, TEMPO_MIN, TEMPO_MAX, DEFAULT_NEW_SCORE.tempo),
      measures: readNumber(measures, 1, 200, DEFAULT_NEW_SCORE.measures),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
      aria-label="新規作成"
    >
      <h2 className="font-medium">新しい楽譜</h2>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2">
          <span className="opacity-60">タイトル</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${fieldClass} w-48`}
            autoFocus
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="opacity-60">調号</span>
          <select
            value={fifths}
            onChange={(e) => setFifths(Number(e.target.value))}
            className={fieldClass}
          >
            {KEY_SIGNATURES.map((k) => (
              <option key={k.fifths} value={k.fifths}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="opacity-60">拍子</span>
          <input
            type="number"
            min={1}
            max={32}
            value={beats}
            onChange={(e) => setBeats(e.target.value)}
            aria-label="拍子の分子"
            className={`${fieldClass} w-16`}
          />
          <span className="opacity-60">/</span>
          <select
            value={beatType}
            onChange={(e) => setBeatType(Number(e.target.value))}
            aria-label="拍子の分母"
            className={fieldClass}
          >
            {BEAT_TYPE_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          <span className="opacity-60">テンポ</span>
          <input
            type="number"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            value={tempo}
            onChange={(e) => setTempo(e.target.value)}
            className={`${fieldClass} w-20`}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="opacity-60">小節数</span>
          <input
            type="number"
            min={1}
            max={200}
            value={measures}
            onChange={(e) => setMeasures(e.target.value)}
            className={`${fieldClass} w-20`}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryButtonClass}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          やめる
        </button>
        {notice && <span className="opacity-60">{notice}</span>}
      </div>
    </form>
  );
}
