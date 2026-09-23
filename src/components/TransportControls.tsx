/**
 * 再生の操作: 再生 / 一時停止 / 再開、停止、選んだ音から再生、テンポ。
 */

import type { Playback } from "../audio/usePlayback";
import { primaryButtonClass, secondaryButtonClass } from "./styles";

interface TransportControlsProps {
  playback: Playback;
  /** 選んでいる音符の位置 (曲頭からの四分音符単位)。選んでいなければ null */
  selectionPosition: number | null;
  tempo: number;
  onTempoInput: (tempo: number) => void;
  /** スライダーを離したときに楽譜へ反映する */
  onTempoCommit: () => void;
}

function toggleLabel(playback: Playback): string {
  if (!playback.ready) {
    return "音源を読み込み中…";
  }
  switch (playback.state) {
    case "stopped":
      return "▶ 再生";
    case "playing":
      return "⏸ 一時停止";
    case "paused":
      return "▶ 再開";
  }
}

export function TransportControls({
  playback,
  selectionPosition,
  tempo,
  onTempoInput,
  onTempoCommit,
}: TransportControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="再生">
      <button
        type="button"
        onClick={playback.toggle}
        disabled={!playback.ready}
        className={`${primaryButtonClass} min-w-28`}
      >
        {toggleLabel(playback)}
      </button>
      <button
        type="button"
        onClick={playback.stop}
        disabled={playback.state === "stopped"}
        className={secondaryButtonClass}
        title="止めて頭に戻る"
      >
        ■ 停止
      </button>
      <button
        type="button"
        onClick={() => selectionPosition !== null && playback.playFrom(selectionPosition)}
        disabled={!playback.ready || selectionPosition === null}
        className={secondaryButtonClass}
        title="選んでいる音符の位置から再生する"
      >
        選んだ音から再生
      </button>

      <label className="ml-3 flex items-center gap-3 text-sm">
        <span className="opacity-60">テンポ</span>
        <input
          type="range"
          min={40}
          max={200}
          step={1}
          value={tempo}
          onChange={(e) => onTempoInput(Number(e.target.value))}
          onPointerUp={onTempoCommit}
          onKeyUp={onTempoCommit}
          className="w-40"
        />
        <span className="w-16 tabular-nums opacity-60">{tempo} BPM</span>
      </label>
    </div>
  );
}
