/**
 * 楽譜ライブラリの一覧。開く・複製・名前の変更・削除と、新規作成の入口 (#6)。
 */

import { useState, type FormEvent } from "react";
import type { LibraryEntry } from "../storage/library";
import { ConfirmButton } from "./ConfirmButton";
import { primaryButtonClass, secondaryButtonClass, smallButtonClass } from "./styles";

interface LibraryPanelProps {
  entries: LibraryEntry[];
  currentId: string | null;
  /** 開いている楽譜の今の題名 (保存が追いつく前でも最新を出す) */
  currentTitle: string;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}

const smallButton = smallButtonClass;

function formatDate(date: Date | null): string {
  if (date === null) {
    return "";
  }
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RenameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (next !== "") {
      onSubmit(next);
    }
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="新しい名前"
        className="w-48 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        autoFocus
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <button type="submit" className={smallButton}>
        決定
      </button>
      <button type="button" onClick={onCancel} className={smallButton}>
        やめる
      </button>
    </form>
  );
}

export function LibraryPanel({
  entries,
  currentId,
  currentTitle,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onCreate,
  onClose,
}: LibraryPanelProps) {
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
      aria-label="楽譜一覧"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">楽譜一覧 ({entries.length})</h2>
        <div className="flex gap-2">
          <button type="button" onClick={onCreate} className={primaryButtonClass}>
            ＋ 新しい楽譜
          </button>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            閉じる
          </button>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {entries.map((entry) => {
          const isCurrent = entry.id === currentId;
          const title = isCurrent ? currentTitle : entry.title;
          return (
            <li
              key={entry.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-2 ${
                isCurrent ? "font-medium" : ""
              }`}
            >
              <div className="min-w-48 flex-1">
                {renaming === entry.id ? (
                  <RenameForm
                    initial={title}
                    onSubmit={(next) => {
                      onRename(entry.id, next);
                      setRenaming(null);
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span>
                    {isCurrent && <span className="mr-2 text-blue-600">●</span>}
                    {title}
                  </span>
                )}
                <div className="text-xs font-normal opacity-50">
                  {entry.broken !== undefined
                    ? entry.broken.split("\n")[0]
                    : `${entry.measures} 小節 ${formatDate(entry.savedAt)}`}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 font-normal">
                {isCurrent ? (
                  <span className="px-2.5 text-xs opacity-60">開いています</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(entry.id)}
                    disabled={entry.broken !== undefined}
                    className={smallButton}
                  >
                    開く
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDuplicate(entry.id)}
                  disabled={entry.broken !== undefined}
                  className={smallButton}
                >
                  複製
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming(entry.id)}
                  disabled={entry.broken !== undefined}
                  className={smallButton}
                >
                  名前を変える
                </button>
                <ConfirmButton
                  onConfirm={() => onDelete(entry.id)}
                  confirmLabel="削除"
                  message="この楽譜を削除します。元に戻せません。"
                >
                  削除
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
