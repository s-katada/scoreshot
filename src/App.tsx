import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner } from "./components/Banner";
import { ScoreView } from "./components/ScoreView";
import { primaryButtonClass } from "./components/styles";
import { loadInstrument, play, playNote, stop } from "./audio/player";
import { scoreToMusicXml } from "./model/musicxml";
import { sampleScore } from "./model/sample";
import type { Score } from "./model/score";
import {
  loadSavedScore,
  useAutoSave,
  type LoadedScore,
  type SaveStatus,
} from "./storage/persist";

function saveStatusLabel(status: SaveStatus): string {
  switch (status.state) {
    case "idle":
      return "";
    case "saving":
      return "保存中…";
    case "saved":
      return "保存済み";
    case "error":
      return "保存に失敗";
  }
}

export default function App() {
  // 楽譜そのもの。描画・再生・保存はすべてここから生やす
  const [score, setScore] = useState<Score>(sampleScore);
  // 起動時の復元結果。null の間は読み込み中
  const [loaded, setLoaded] = useState<LoadedScore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // スライダーを動かしている間の値と、楽譜に反映する値を分けている。
  // テンポは MusicXML のメトロノーム記号に載るため、確定させずに反映すると
  // つまみを動かすたびに OSMD の再レイアウトが走ってしまう。
  const [tempoInput, setTempoInput] = useState(score.tempo);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  // 再生位置 (四分音符単位)。null は停止中
  const [position, setPosition] = useState<number | null>(null);

  // 音源の読み込みにはユーザー操作が要らないので起動時に済ませておく。
  // 最初の再生で 2MB の読み込みを待たされるのを避けるため。
  useEffect(() => {
    let cancelled = false;
    void loadInstrument().then(() => {
      if (!cancelled) {
        setAudioReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 前回の楽譜を復元する。無ければ、または壊れていればサンプルのまま
  useEffect(() => {
    let cancelled = false;
    void loadSavedScore().then((result) => {
      if (cancelled) {
        return;
      }
      setScore(result.score);
      setLoaded(result);
      setLoadError(result.error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveStatus = useAutoSave(
    loaded === null ? null : score,
    loaded?.inSync ? loaded.score : null,
  );

  // 楽譜が差し替わったとき (復元・編集など) はスライダーを追従させる
  useEffect(() => {
    setTempoInput(score.tempo);
  }, [score.tempo]);

  const commitTempo = useCallback(() => {
    setScore((current) =>
      current.tempo === tempoInput ? current : { ...current, tempo: tempoInput },
    );
  }, [tempoInput]);

  const musicXml = useMemo(() => scoreToMusicXml(score), [score]);

  const handlePlay = useCallback(async () => {
    if (playing) {
      stop();
      setPlaying(false);
      setPosition(null);
      return;
    }
    setPlaying(true);
    setPosition(0);
    await play(score, {
      onEnded: () => {
        setPlaying(false);
        setPosition(null);
      },
      onPosition: setPosition,
    });
  }, [playing, score]);

  const handleNoteClick = useCallback((frequency: number) => {
    void playNote(frequency);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">scoreshot</h1>
          <p className="text-sm opacity-60">ピアノ譜エディタ</p>
        </div>
        <p className="text-xs opacity-50" aria-live="polite">
          {saveStatusLabel(saveStatus)}
        </p>
      </header>

      {loadError !== null && (
        <Banner tone="error" onDismiss={() => setLoadError(null)}>
          {loadError}
        </Banner>
      )}
      {saveStatus.state === "error" && (
        <Banner tone="error">{saveStatus.message}</Banner>
      )}

      <section className="flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => void handlePlay()}
          disabled={!audioReady}
          className={primaryButtonClass}
        >
          {!audioReady ? "音源を読み込み中…" : playing ? "停止" : "再生"}
        </button>

        <label className="flex items-center gap-3 text-sm">
          <span className="opacity-60">テンポ</span>
          <input
            type="range"
            min={40}
            max={200}
            step={1}
            value={tempoInput}
            onChange={(e) => setTempoInput(Number(e.target.value))}
            onPointerUp={commitTempo}
            onKeyUp={commitTempo}
            className="w-40"
          />
          <span className="w-16 tabular-nums opacity-60">
            {tempoInput} BPM
          </span>
        </label>
      </section>

      {loaded === null ? (
        <p className="text-sm opacity-60">楽譜を読み込み中…</p>
      ) : (
        <ScoreView
          musicXml={musicXml}
          playbackPosition={position}
          onNoteClick={handleNoteClick}
        />
      )}

      <p className="text-sm opacity-50">
        再生すると縦線が今の位置を示す。音符をクリックするとその音だけ鳴る。
      </p>
    </main>
  );
}
