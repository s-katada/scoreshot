import { useCallback, useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { ConfirmButton } from "./components/ConfirmButton";
import { EditorToolbar } from "./components/EditorToolbar";
import { FileMenu } from "./components/FileMenu";
import { LibraryPanel } from "./components/LibraryPanel";
import { NewScoreForm } from "./components/NewScoreForm";
import { OmrPanel } from "./components/OmrPanel";
import { ScoreSettings } from "./components/ScoreSettings";
import { ScoreView } from "./components/ScoreView";
import { TransportControls } from "./components/TransportControls";
import { secondaryButtonClass } from "./components/styles";
import { playNote } from "./audio/player";
import { usePlayback } from "./audio/usePlayback";
import { useKeyboardShortcuts } from "./editor/useKeyboardShortcuts";
import { useScoreEditor } from "./editor/useScoreEditor";
import { setTitle } from "./model/edit";
import { scoreToMidi } from "./model/midi";
import { scoreToMusicXml } from "./model/musicxml";
import { readMusicXmlFile } from "./model/musicxmlFile";
import { MusicXmlImportError } from "./model/musicxmlImport";
import { createEmptyScore, type NewScoreOptions } from "./model/newScore";
import type { Recognition } from "./omr/recognize";
import { sampleScore } from "./model/sample";
import { measureQuarterLength, type Score } from "./model/score";
import { useHistory } from "./state/useHistory";
import {
  addScore,
  deleteScore,
  listScores,
  openLibrary,
  readScore,
  rememberLastOpened,
  scoreFileName,
  writeScore,
  type LibraryEntry,
} from "./storage/library";
import { useAutoSave, type SaveStatus } from "./storage/persist";
import {
  MIDI_FILE,
  MUSICXML_FILE,
  openFile,
  safeFileName,
  saveFileAs,
  type FileType,
} from "./storage/userFiles";
import { describeError } from "./util/errors";

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

/**
 * 開いている楽譜。baseline はファイルに書かれていると分かっている中身。
 * id が null なら保存しない (保存先に触れなかったとき)
 */
interface OpenScore {
  id: string | null;
  baseline: Score;
}

type Notice = { tone: "error" | "info"; text: string };

export default function App() {
  // 楽譜そのもの。描画・再生・保存はすべてここから生やす。
  // 編集のたびにスナップショットを積み、Undo/Redo で行き来する
  const history = useHistory<Score>(sampleScore);
  const score = history.value;
  const resetHistory = history.reset;
  // null の間は読み込み中
  const [current, setCurrent] = useState<OpenScore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);
  // 読み込み・書き出しなどの結果のお知らせ
  const [notice, setNotice] = useState<Notice | null>(null);
  // スライダーを動かしている間の値と、楽譜に反映する値を分けている。
  // テンポは MusicXML のメトロノーム記号に載るため、確定させずに反映すると
  // つまみを動かすたびに OSMD の再レイアウトが走ってしまう。
  const [tempoInput, setTempoInput] = useState(score.tempo);
  const playback = usePlayback(score);

  const autoSave = useAutoSave(
    current === null ? null : score,
    current?.baseline ?? null,
    current?.id ? scoreFileName(current.id) : null,
  );
  const saveStatus = autoSave.status;

  const refreshEntries = useCallback(async () => {
    try {
      setEntries(await listScores());
    } catch (error) {
      setNotice({ tone: "error", text: `楽譜の一覧を読めませんでした。\n${describeError(error)}` });
    }
  }, []);

  // 前回開いていた楽譜を開く。無ければ、または壊れていればサンプル
  useEffect(() => {
    let cancelled = false;
    void openLibrary()
      .then((opened) => {
        if (cancelled) {
          return;
        }
        resetHistory(opened.score);
        setCurrent({ id: opened.id, baseline: opened.score });
        setLoadError(opened.error ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // 保存先に触れないときも、サンプルで編集はできるようにする (保存はしない)
        resetHistory(sampleScore);
        setCurrent({ id: null, baseline: sampleScore });
        setLoadError(
          `保存された楽譜を読み込めませんでした。サンプルを表示しています (保存はされません)。\n${describeError(error)}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [resetHistory]);

  // 楽譜が差し替わったとき (復元・編集など) はスライダーを追従させる
  useEffect(() => {
    setTempoInput(score.tempo);
  }, [score.tempo]);

  const commitTempo = useCallback(() => {
    history.update((s) => (s.tempo === tempoInput ? s : { ...s, tempo: tempoInput }));
  }, [history, tempoInput]);

  const editor = useScoreEditor({
    history,
    onSound: (name) => void playNote(name),
  });

  useKeyboardShortcuts({
    editor,
    togglePlayback: playback.toggle,
    enabled: current !== null,
  });

  // 選んでいる音符の位置 (曲頭からの四分音符単位)。そこから再生できる
  const selectionPosition =
    editor.selected === null
      ? null
      : editor.selected.measureIndex * measureQuarterLength(score.time) +
        editor.selected.event.onset;

  const stopPlayback = playback.stop;
  const clearSelection = editor.clearSelection;
  const flushSave = autoSave.flush;

  /**
   * ライブラリの別の楽譜に切り替える。元に戻す履歴は楽譜ごとに捨てる。
   *
   * 呼ぶ前に flushSave で今の楽譜を保存しきること。自動保存の待ち時間の
   * 間にした編集を失わないように。
   */
  const switchTo = useCallback(
    (id: string, next: Score) => {
      stopPlayback();
      clearSelection();
      resetHistory(next);
      setCurrent({ id, baseline: next });
      void rememberLastOpened(id).catch(() => {
        // 覚えられなくても、次の起動で最近の楽譜が開くだけ
      });
    },
    [stopPlayback, clearSelection, resetHistory],
  );

  const openScore = useCallback(
    async (id: string) => {
      await flushSave();
      try {
        switchTo(id, await readScore(id));
        setLibraryOpen(false);
      } catch (error) {
        setNotice({ tone: "error", text: `楽譜を開けませんでした。\n${describeError(error)}` });
      }
      void refreshEntries();
    },
    [flushSave, switchTo, refreshEntries],
  );

  /** 新しい楽譜としてライブラリに足し、それを開く */
  const addAndOpen = useCallback(
    async (next: Score) => {
      await flushSave();
      const id = await addScore(next);
      switchTo(id, next);
      void refreshEntries();
    },
    [flushSave, switchTo, refreshEntries],
  );

  const duplicateScore = useCallback(
    async (id: string) => {
      await flushSave();
      try {
        const source = id === current?.id ? score : await readScore(id);
        await addScore({ ...source, title: `${source.title} のコピー` });
      } catch (error) {
        setNotice({ tone: "error", text: `楽譜を複製できませんでした。\n${describeError(error)}` });
      }
      void refreshEntries();
    },
    [flushSave, current, score, refreshEntries],
  );

  const renameScore = useCallback(
    async (id: string, title: string) => {
      if (id === current?.id) {
        // 開いている楽譜は編集として変える (元に戻せ、自動で保存される)
        editor.editScore((s) => setTitle(s, title));
        return;
      }
      try {
        await writeScore(id, setTitle(await readScore(id), title));
      } catch (error) {
        setNotice({ tone: "error", text: `名前を変えられませんでした。\n${describeError(error)}` });
      }
      void refreshEntries();
    },
    [current, editor, refreshEntries],
  );

  const removeScore = useCallback(
    async (id: string) => {
      try {
        if (id === current?.id) {
          await flushSave();
          await deleteScore(id);
          // 開いていた楽譜を消したら、残りのうち最近のものを開く
          const rest = (await listScores()).filter((e) => e.broken === undefined);
          if (rest.length > 0) {
            switchTo(rest[0].id, await readScore(rest[0].id));
          } else {
            switchTo(await addScore(sampleScore), sampleScore);
          }
        } else {
          await deleteScore(id);
        }
      } catch (error) {
        setNotice({ tone: "error", text: `楽譜を削除できませんでした。\n${describeError(error)}` });
      }
      void refreshEntries();
    },
    [current, flushSave, switchTo, refreshEntries],
  );

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

  /** 開いている楽譜を丸ごと差し替える。履歴に積むので元に戻せる */
  const replaceScore = useCallback(
    (next: Score) => {
      stopPlayback();
      clearSelection();
      history.update(() => next);
    },
    [history, clearSelection, stopPlayback],
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
      await addAndOpen(imported);
      const lines = [`「${imported.title}」を読み込み、新しい楽譜として楽譜一覧に足しました。`];
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
  }, [addAndOpen]);

  /** 画像から読み取った楽譜を、新しい楽譜として足して開く (#2) */
  const addRecognized = useCallback(
    async (recognition: Recognition, name: string) => {
      setReading(false);
      try {
        await addAndOpen({ ...recognition.score, title: name });
      } catch (error) {
        setNotice({
          tone: "error",
          text: `読み取った楽譜を楽譜一覧に足せませんでした。\n${describeError(error)}`,
        });
        return;
      }
      const lines = [
        `「${name}」を読み取り、新しい楽譜として楽譜一覧に足しました。`,
        "読み取りは完全ではありません。再生して確かめ、違う所は編集で直してください。",
      ];
      if (recognition.warnings.length > 0) {
        lines.push("", "読み取りで気づいたこと:", ...recognition.warnings.map((w) => `・${w}`));
      }
      setNotice({ tone: "info", text: lines.join("\n") });
    },
    [addAndOpen],
  );

  const createScore = useCallback(
    async (options: NewScoreOptions) => {
      setCreating(false);
      setLibraryOpen(false);
      try {
        await addAndOpen(createEmptyScore(options));
      } catch (error) {
        setNotice({ tone: "error", text: `楽譜を作れませんでした。\n${describeError(error)}` });
      }
    },
    [addAndOpen],
  );

  const toggleLibrary = useCallback(() => {
    if (!libraryOpen) {
      void refreshEntries();
    }
    setLibraryOpen(!libraryOpen);
  }, [libraryOpen, refreshEntries]);

  const ready = current !== null;

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

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleLibrary}
          disabled={!ready}
          aria-expanded={libraryOpen}
          className={secondaryButtonClass}
        >
          楽譜一覧
        </button>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          disabled={!ready}
          aria-expanded={creating}
          className={secondaryButtonClass}
        >
          新規作成
        </button>
        <button
          type="button"
          onClick={() => setReading((r) => !r)}
          disabled={!ready}
          aria-expanded={reading}
          className={secondaryButtonClass}
        >
          画像から読み取る
        </button>
        <ConfirmButton
          onConfirm={resetToSample}
          confirmLabel="サンプルに戻す"
          message="開いている楽譜がサンプルに置き換わります (元に戻すで戻せます)。"
          disabled={!ready}
        >
          サンプルに戻す
        </ConfirmButton>
        <FileMenu
          onImportMusicXml={() => void importMusicXml()}
          onExportMusicXml={() => void exportMusicXml()}
          onExportMidi={() => void exportMidi()}
          disabled={!ready}
        />
      </section>

      {creating && (
        <NewScoreForm
          onCreate={(options) => void createScore(options)}
          onCancel={() => setCreating(false)}
          submitLabel="作成"
          notice="新しい楽譜として楽譜一覧に足し、それを開きます。"
        />
      )}

      {reading && (
        <OmrPanel
          onRecognized={(recognition, name) => void addRecognized(recognition, name)}
          onClose={() => setReading(false)}
        />
      )}

      {libraryOpen && (
        <LibraryPanel
          entries={entries}
          currentId={current?.id ?? null}
          currentTitle={score.title}
          onOpen={(id) => void openScore(id)}
          onDuplicate={(id) => void duplicateScore(id)}
          onRename={(id, title) => void renameScore(id, title)}
          onDelete={(id) => void removeScore(id)}
          onCreate={() => setCreating(true)}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      <TransportControls
        playback={playback}
        selectionPosition={selectionPosition}
        tempo={tempoInput}
        onTempoInput={setTempoInput}
        onTempoCommit={commitTempo}
      />

      {!ready ? (
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
