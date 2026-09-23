/**
 * 楽譜の設定 (タイトル・調号・拍子) を変える欄。
 *
 * タイトルと拍子の数は、打ち終えたとき (フォーカスが外れたとき / Enter)
 * に反映する。1 文字ごとに楽譜を差し替えると、そのたびに描き直しと
 * 元に戻す履歴が 1 手ずつ積まれてしまうため。
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import {
  setKeySignature,
  setTimeSignature,
  setTitle,
} from "../model/edit";
import type { Score } from "../model/score";
import { BEAT_TYPE_OPTIONS, KEY_SIGNATURES } from "./keySignatures";

interface ScoreSettingsProps {
  score: Score;
  /**
   * 楽譜を変える。変えられたら true。できなかったときの理由の表示は
   * 呼び出し側に任せる
   */
  onEdit: (edit: (current: Score) => Score) => boolean;
}

const fieldClass =
  "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
}

export function ScoreSettings({ score, onEdit }: ScoreSettingsProps) {
  const [title, setTitleDraft] = useState(score.title);
  const [beats, setBeatsDraft] = useState(String(score.time.beats));

  // 元に戻す・読み込みなどで楽譜側が変わったら欄を追従させる
  useEffect(() => setTitleDraft(score.title), [score.title]);
  useEffect(() => setBeatsDraft(String(score.time.beats)), [score.time.beats]);

  const commitTitle = () => {
    const next = title.trim() === "" ? "無題" : title.trim();
    setTitleDraft(next);
    onEdit((s) => setTitle(s, next));
  };

  const commitBeats = () => {
    const value = Number(beats);
    if (!Number.isInteger(value) || value < 1 || value > 32) {
      setBeatsDraft(String(score.time.beats));
      return;
    }
    if (!onEdit((s) => setTimeSignature(s, { beats: value, beatType: s.time.beatType }))) {
      setBeatsDraft(String(score.time.beats));
    }
  };

  return (
    <section
      className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm"
      aria-label="楽譜の設定"
    >
      <label className="flex items-center gap-2">
        <span className="opacity-60">タイトル</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={commitOnEnter}
          className={`${fieldClass} w-48`}
        />
      </label>

      <label className="flex items-center gap-2">
        <span className="opacity-60">調号</span>
        <select
          value={score.key.fifths}
          onChange={(e) => {
            const fifths = Number(e.target.value);
            onEdit((s) => setKeySignature(s, fifths));
          }}
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
          onChange={(e) => setBeatsDraft(e.target.value)}
          onBlur={commitBeats}
          onKeyDown={commitOnEnter}
          aria-label="拍子の分子"
          className={`${fieldClass} w-16`}
        />
        <span className="opacity-60">/</span>
        <select
          value={score.time.beatType}
          onChange={(e) => {
            const beatType = Number(e.target.value);
            onEdit((s) => setTimeSignature(s, { beats: s.time.beats, beatType }));
          }}
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
    </section>
  );
}
