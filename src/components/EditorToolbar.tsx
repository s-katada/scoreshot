/**
 * 編集のツールバー。モードの切り替え、音価のパレット、選んだ音符の操作、
 * 小節の追加・削除、Undo/Redo を並べる。
 */

import type { ReactNode } from "react";
import type { EditMode, ScoreEditor } from "../editor/useScoreEditor";
import type { NoteType } from "../model/score";

/** パレットに並べる音価。32 分音符は付点と組むと 64 分の休符が要るので出さない */
const PALETTE_TYPES: Array<{ type: NoteType; label: string; title: string }> = [
  { type: "whole", label: "全", title: "全音符" },
  { type: "half", label: "2分", title: "2 分音符" },
  { type: "quarter", label: "4分", title: "4 分音符" },
  { type: "eighth", label: "8分", title: "8 分音符" },
  { type: "16th", label: "16分", title: "16 分音符" },
];

/** キーボードの割り当て (useKeyboardShortcuts と揃える) */
const KEYBOARD_HELP: Array<[string, string]> = [
  ["A〜G", "入力カーソルの位置に音符を置く (⇧ で選んでいる音に和音を積む)"],
  ["3〜7", "音価 (16 分・8 分・4 分・2 分・全音符)"],
  [".", "付点"],
  ["0", "休符を置く"],
  ["↑ / ↓", "選んでいる音を 1 音上下 (⌘ と一緒でオクターブ)"],
  ["← / →", "前後の音を選ぶ"],
  ["Delete", "選んでいる音を消す"],
  ["⌘Z / ⇧⌘Z", "元に戻す / やり直す"],
  ["Space", "再生 / 一時停止"],
  ["Esc", "選択を外す"],
];

const MODES: Array<{ mode: EditMode; label: string; title: string }> = [
  { mode: "input", label: "入力", title: "五線をタップして音符を置く" },
  { mode: "select", label: "選択", title: "音符をタップして選ぶ" },
];

interface ToolButtonProps {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}

function ToolButton({ children, onClick, active, disabled, title }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`min-w-10 rounded-md border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-40 ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-neutral-300 hover:bg-neutral-100 disabled:hover:bg-transparent dark:border-neutral-700 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs opacity-50">{label}</span>
      {children}
    </div>
  );
}

export function EditorToolbar({ editor }: { editor: ScoreEditor }) {
  const { palette, selected, mode } = editor;
  const hasPitch = selected !== null && selected.note.pitch !== null;
  const alter = hasPitch ? (selected.note.pitch?.alter ?? 0) : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Group label="モード">
          {MODES.map((m) => (
            <ToolButton
              key={m.mode}
              active={mode === m.mode}
              onClick={() => editor.setMode(m.mode)}
              title={m.title}
            >
              {m.label}
            </ToolButton>
          ))}
        </Group>

        <Group label="音価">
          {PALETTE_TYPES.map((p) => (
            <ToolButton
              key={p.type}
              active={palette.type === p.type}
              onClick={() => editor.chooseType(p.type)}
              title={p.title}
            >
              {p.label}
            </ToolButton>
          ))}
          <ToolButton
            active={palette.dots > 0}
            onClick={editor.toggleDot}
            title="付点"
          >
            付点
          </ToolButton>
        </Group>

        {mode === "input" && (
          <Group label="入力">
            <ToolButton
              active={palette.rest}
              onClick={editor.togglePaletteRest}
              title="音符の代わりに休符を置く"
            >
              休符
            </ToolButton>
            <ToolButton
              active={palette.chord}
              onClick={editor.togglePaletteChord}
              title="既にある音に重ねて和音にする"
            >
              和音
            </ToolButton>
          </Group>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Group label="選択中">
          <ToolButton onClick={() => editor.moveSelection(1)} disabled={!hasPitch} title="1 音上げる">
            ↑
          </ToolButton>
          <ToolButton onClick={() => editor.moveSelection(-1)} disabled={!hasPitch} title="1 音下げる">
            ↓
          </ToolButton>
          <ToolButton onClick={() => editor.moveSelection(7)} disabled={!hasPitch} title="1 オクターブ上げる">
            8va↑
          </ToolButton>
          <ToolButton onClick={() => editor.moveSelection(-7)} disabled={!hasPitch} title="1 オクターブ下げる">
            8va↓
          </ToolButton>
          <ToolButton onClick={() => editor.setAccidental(1)} disabled={!hasPitch} active={alter === 1} title="♯ を付ける (もう一度押すと外す)">
            ♯
          </ToolButton>
          <ToolButton onClick={() => editor.setAccidental(-1)} disabled={!hasPitch} active={alter === -1} title="♭ を付ける (もう一度押すと外す)">
            ♭
          </ToolButton>
          <ToolButton onClick={() => editor.setAccidental(0)} disabled={!hasPitch} active={alter === 0} title="♮ にする (もう一度押すと調号どおりに戻す)">
            ♮
          </ToolButton>
          <ToolButton onClick={editor.toggleSelectedRest} disabled={selected === null} title="休符と音符を入れ替える">
            休符⇄音符
          </ToolButton>
          <ToolButton onClick={editor.deleteSelected} disabled={!hasPitch} title="消す (休符になる)">
            削除
          </ToolButton>
        </Group>

        <Group label="小節">
          <ToolButton onClick={editor.addMeasure} title="選んでいる小節の後ろ (無ければ末尾) に足す">
            追加
          </ToolButton>
          <ToolButton
            onClick={editor.deleteMeasure}
            disabled={editor.measureCount <= 1}
            title="選んでいる小節 (無ければ末尾) を消す"
          >
            削除
          </ToolButton>
        </Group>

        <Group label="履歴">
          <ToolButton onClick={editor.undo} disabled={!editor.canUndo} title="元に戻す">
            元に戻す
          </ToolButton>
          <ToolButton onClick={editor.redo} disabled={!editor.canRedo} title="やり直す">
            やり直す
          </ToolButton>
        </Group>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer select-none opacity-60">キーボードの操作</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 opacity-80">
          {KEYBOARD_HELP.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt className="font-mono">{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="min-h-5 text-sm" aria-live="polite">
        {editor.message !== null ? (
          <span className="text-red-600 dark:text-red-400">{editor.message}</span>
        ) : (
          <span className="opacity-60">{editor.hoverLabel ?? guide(mode, selected !== null)}</span>
        )}
      </p>
    </section>
  );
}

function guide(mode: EditMode, hasSelection: boolean): string {
  if (mode === "input") {
    return "五線をタップすると、選んだ音価の音符を置きます。";
  }
  return hasSelection
    ? "↑↓ で高さ、音価ボタンで長さを変えられます。"
    : "音符をタップして選びます。";
}
