import { useCallback, useEffect, useMemo, useState } from "react";
import { ScoreView } from "./components/ScoreView";
import { loadInstrument, play, playNote, stop } from "./audio/player";
import { scoreToMusicXml } from "./model/musicxml";
import { sampleScore } from "./model/sample";

export default function App() {
  // スライダーを動かしている間の値と、楽譜に反映する値を分けている。
  // テンポは MusicXML のメトロノーム記号に載るため、確定させずに反映すると
  // つまみを動かすたびに OSMD の再レイアウトが走ってしまう。
  const [tempoInput, setTempoInput] = useState(sampleScore.tempo);
  const [tempo, setTempo] = useState(sampleScore.tempo);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

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

  const score = useMemo(() => ({ ...sampleScore, tempo }), [tempo]);
  const musicXml = useMemo(() => scoreToMusicXml(score), [score]);

  const handlePlay = useCallback(async () => {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    await play(score, () => setPlaying(false));
  }, [playing, score]);

  const handleNoteClick = useCallback((frequency: number) => {
    void playNote(frequency);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">scoreshot</h1>
        <p className="text-sm opacity-60">ピアノ譜エディタ</p>
      </header>

      <section className="flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => void handlePlay()}
          disabled={!audioReady}
          className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
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
            onPointerUp={() => setTempo(tempoInput)}
            onKeyUp={() => setTempo(tempoInput)}
            className="w-40"
          />
          <span className="w-16 tabular-nums opacity-60">
            {tempoInput} BPM
          </span>
        </label>
      </section>

      <ScoreView musicXml={musicXml} onNoteClick={handleNoteClick} />

      <p className="text-sm opacity-50">
        音符をクリックするとその音だけ鳴る。
      </p>
    </main>
  );
}
