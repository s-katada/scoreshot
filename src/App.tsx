import { useCallback, useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { ConfirmButton } from "./components/ConfirmButton";
import { EditorToolbar } from "./components/EditorToolbar";
import { FileMenu } from "./components/FileMenu";
import { NewScoreForm } from "./components/NewScoreForm";
import { ScoreSettings } from "./components/ScoreSettings";
import { ScoreView } from "./components/ScoreView";
import { TransportControls } from "./components/TransportControls";
import { secondaryButtonClass } from "./components/styles";
import { playNote } from "./audio/player";
import { usePlayback } from "./audio/usePlayback";
import { useScoreEditor } from "./editor/useScoreEditor";
import { scoreToMidi } from "./model/midi";
import { scoreToMusicXml } from "./model/musicxml";
import { readMusicXmlFile } from "./model/musicxmlFile";
import { MusicXmlImportError } from "./model/musicxmlImport";
import { createEmptyScore, type NewScoreOptions } from "./model/newScore";
import { sampleScore } from "./model/sample";
import { measureQuarterLength, type Score } from "./model/score";
import { useHistory } from "./state/useHistory";
import {
  MIDI_FILE,
  MUSICXML_FILE,
  openFile,
  safeFileName,
  saveFileAs,
  type FileType,
} from "./storage/userFiles";
import { describeError } from "./util/errors";
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
  // 楽譜そのもの。描画・再生・保存はすべてここから生やす。
  // 編集のたびにスナップショットを積み、Undo/Redo で行き来する
  const history = useHistory<Score>(sampleScore);
  const score = history.value;
  const resetHistory = history.reset;
  // 起動時の復元結果。null の間は読み込み中
  const [loaded, setLoaded] = useState<LoadedScore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 読み込み・書き出しの結果のお知らせ
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  // スライダーを動かしている間の値と、楽譜に反映する値を分けている。
  // テンポは MusicXML のメトロノーム記号に載るため、確定させずに反映すると
  // つまみを動かすたびに OSMD の再レイアウトが走ってしまう。
  const [tempoInput, setTempoInput] = useState(score.tempo);
  const playback = usePlayback(score);

  // 前回の楽譜を復元する。無ければ、または壊れていればサンプルのまま
  useEffect(() => {
    let cancelled = false;
    void loadSavedScore().then((result) => {
      if (cancelled) {
        return;
      }
      resetHistory(result.score);
      setLoaded(result);
      setLoadError(result.error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [resetHistory]);

  const saveStatus = useAutoSave(
    loaded === null ? null : score,
    loaded?.inSync ? loaded.score : null,
  );

  // 楽譜が差し替わったとき (復元・編集など) はスライダーを追従させる
  useEffect(() => {
    setTempoInput(score.tempo);
  }, [score.tempo]);

  const commitTempo = useCallback(() => {
    history.update((current) =>
      current.tempo === tempoInput ? current : { ...current, tempo: tempoInput },
    );
  }, [history, tempoInput]);

  const editor = useScoreEditor({
    history,
    onSound: (name) => void playNote(name),
  });

  // 選んでいる音符の位置 (曲頭からの四分音符単位)。そこから再生できる
  const selectionPosition =
    editor.selected === null
      ? null
      : editor.selected.measureIndex * measureQuarterLength(score.time) +
        editor.selected.event.onset;

  /** 楽譜を形式 label のファイルに書き出す */
  const exportScore = useCallback(
    async (label: string, extension: string, data: () => Uint8Array | string, type: FileType) => {
      try {
        const saved = await saveFileAs(`${safeFileName(score.title)}.${extension}`, data(), type);
        if (saved) {
          setNotice({ tone: "info", text: `${label} に書き出しました。` });
        }
      } catch (error) {
        setNotice({
          tone: "error",
          text: `${label} に書き出せませんでした。\n${describeError(error)}`,
        });
      }
    },
    [score.title],
  );

  const exportMusicXml = useCallback(
    () => exportScore("MusicXML", "musicxml", () => scoreToMusicXml(score), MUSICXML_FILE),
    [exportScore, score],
  );

  const exportMidi = useCallback(
    () => exportScore("MIDI", "mid", () => scoreToMidi(score), MIDI_FILE),
    [exportScore, score],
  );

  /** 楽譜を丸ごと差し替える。履歴に積むので元に戻せる */
  const stopPlayback = playback.stop;
  const replaceScore = useCallback(
    (next: Score) => {
      stopPlayback();
      editor.clearSelection();
      history.update(() => next);
    },
    [history, editor, stopPlayback],
  );

  const resetToSample = useCallback(() => replaceScore(sampleScore), [replaceScore]);

  const importMusicXml = useCallback(async () => {
    let picked;
    try {
      picked = await openFile([MUSICXML_FILE]);
    } catch (error) {
      setNotice({ tone: "error", text: `ファイルを開けませんでした。\n${describeError(error)}` });
      return;
    }
    if (picked === null) {
      return;
    }
    try {
      const { score: imported, warnings } = readMusicXmlFile(picked.name, picked.bytes);
      replaceScore(imported);
      const lines = [
        `「${imported.title}」を読み込み、今の楽譜と置き換えました (元に戻すで戻せます)。`,
      ];
      if (warnings.length > 0) {
        lines.push("", "読み込めなかったもの・変えて読み込んだもの:", ...warnings.map((w) => `・${w}`));
      }
      setNotice({ tone: "info", text: lines.join("\n") });
    } catch (error) {
      const reason =
        error instanceof MusicXmlImportError
          ? error.message
          : `思わぬエラーです: ${describeError(error)}`;
      setNotice({ tone: "error", text: `「${picked.name}」を読み込めませんでした。\n${reason}` });
    }
  }, [replaceScore]);

  const createScore = useCallback(
    (options: NewScoreOptions) => {
      replaceScore(createEmptyScore(options));
      setCreating(false);
    },
    [replaceScore],
  );

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
      {notice !== null && (
        <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}

      <TransportControls
        playback={playback}
        selectionPosition={selectionPosition}
        tempo={tempoInput}
        onTempoInput={setTempoInput}
        onTempoCommit={commitTempo}
      />

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          disabled={loaded === null}
          aria-expanded={creating}
          className={secondaryButtonClass}
        >
          新規作成
        </button>

        <ConfirmButton
          onConfirm={resetToSample}
          confirmLabel="サンプルに戻す"
          disabled={loaded === null}
        >
          サンプルに戻す
        </ConfirmButton>

        <FileMenu
          onImportMusicXml={() => void importMusicXml()}
          onExportMusicXml={() => void exportMusicXml()}
          onExportMidi={() => void exportMidi()}
          disabled={loaded === null}
        />
      </section>

      {creating && (
        <NewScoreForm
          onCreate={createScore}
          onCancel={() => setCreating(false)}
          submitLabel="作成して置き換える"
          notice="今の楽譜は置き換わります (元に戻すで戻せます)。"
        />
      )}

      {loaded === null ? (
        <p className="text-sm opacity-60">楽譜を読み込み中…</p>
      ) : (
        <>
          <ScoreSettings score={score} onEdit={editor.editScore} />
          <EditorToolbar editor={editor} />
          <ScoreView
            score={score}
            playbackPosition={playback.position}
            selectedNoteIds={editor.selectedIds}
            ghost={editor.ghost}
            caret={editor.cursor}
            onHit={editor.handleHit}
            onHover={editor.handleHover}
            cursorStyle={editor.mode === "input" ? "crosshair" : "default"}
          />
        </>
      )}
    </main>
  );
}
