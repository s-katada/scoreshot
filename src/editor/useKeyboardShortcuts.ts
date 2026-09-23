/**
 * キーボードでの入力と編集 (#13)。割り当ては MuseScore に倣う。
 *
 *   A〜G          入力カーソルの位置に音符を置く (⇧ で選んでいる音に和音を積む)
 *   3〜7          音価 (16 分・8 分・4 分・2 分・全音符)
 *   .             付点
 *   0             休符を置く
 *   ↑ / ↓         選んでいる音を 1 音上下 (⌘ / Ctrl と一緒でオクターブ)
 *   ← / →         前後の音を選ぶ
 *   Delete / ⌫    選んでいる音を消す
 *   ⌘Z / ⇧⌘Z      元に戻す / やり直す (Ctrl+Z / Ctrl+Y でも)
 *   Space         再生 / 一時停止
 *   Esc           選択を外す
 *
 * キー操作はどれも画面のボタンと同じ編集関数を呼ぶだけで、キー専用の
 * 編集ロジックは持たない。Undo/Redo もそのまま揃う。
 *
 * 文字を打つ欄 (タイトルなど) にフォーカスがあるときは何もしない。
 */

import { useEffect, useRef } from "react";
import type { Step } from "../model/score";
import type { NoteType } from "../model/score";
import type { ScoreEditor } from "./useScoreEditor";

const DURATION_KEYS: Record<string, NoteType> = {
  "3": "16th",
  "4": "eighth",
  "5": "quarter",
  "6": "half",
  "7": "whole",
};

const STEP_KEYS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

/** 文字を打ったり値を選んだりする要素か */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface Options {
  editor: ScoreEditor;
  togglePlayback: () => void;
  enabled: boolean;
}

export function useKeyboardShortcuts({ editor, togglePlayback, enabled }: Options) {
  // ハンドラを付け直さずに最新の関数を呼べるよう ref に置く
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const toggleRef = useRef(togglePlayback);
  toggleRef.current = togglePlayback;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || isEditable(event.target)) {
        return;
      }
      const e = editorRef.current;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key;
      const upper = key.length === 1 ? key.toUpperCase() : key;

      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };

      if (command) {
        if (upper === "Z") {
          run(event.shiftKey ? e.redo : e.undo);
        } else if (upper === "Y") {
          run(e.redo);
        } else if (key === "ArrowUp") {
          run(() => e.moveSelection(7));
        } else if (key === "ArrowDown") {
          run(() => e.moveSelection(-7));
        }
        return;
      }
      if (event.altKey) {
        return;
      }

      if (STEP_KEYS.has(upper)) {
        run(() => e.typeNote(upper as Step, event.shiftKey));
      } else if (key in DURATION_KEYS) {
        run(() => e.chooseType(DURATION_KEYS[key]));
      } else if (key === ".") {
        run(e.toggleDot);
      } else if (key === "0") {
        run(e.typeRest);
      } else if (key === "ArrowUp") {
        run(() => e.moveSelection(1));
      } else if (key === "ArrowDown") {
        run(() => e.moveSelection(-1));
      } else if (key === "ArrowLeft") {
        run(() => e.moveSelectionSideways(-1));
      } else if (key === "ArrowRight") {
        run(() => e.moveSelectionSideways(1));
      } else if (key === "Delete" || key === "Backspace") {
        run(e.deleteSelected);
      } else if (key === " ") {
        // フォーカスのあるボタンが Space で押されるのも止める
        run(toggleRef.current);
      } else if (key === "Escape") {
        run(e.clearSelection);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled]);
}
