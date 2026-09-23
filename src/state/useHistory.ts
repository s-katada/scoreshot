/**
 * Undo / Redo のための履歴。
 *
 * 値のスナップショットを並べて持つだけの素朴な作り。Score は編集のたびに
 * 新しいオブジェクトになり、変わらない小節は前の版と共有されるので、
 * スナップショットを積んでもほとんど膨らまない。
 */

import { useCallback, useMemo, useState } from "react";

/** さかのぼれる手数の上限 */
const LIMIT = 200;

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface History<T> {
  value: T;
  /** 新しい値にする。Undo で戻せる。同じ値なら何もしない */
  update: (fn: (current: T) => T) => void;
  undo: () => void;
  redo: () => void;
  /** 履歴を捨てて値を差し替える (保存からの復元など、戻せなくてよいとき) */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: T): History<T> {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  });

  const update = useCallback((fn: (current: T) => T) => {
    setState((s) => {
      const next = fn(s.present);
      if (Object.is(next, s.present)) {
        return s;
      }
      return {
        past: [...s.past, s.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      const previous = s.past[s.past.length - 1];
      if (previous === undefined) {
        return s;
      }
      return {
        past: s.past.slice(0, -1),
        present: previous,
        future: [s.present, ...s.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      const [next, ...future] = s.future;
      if (next === undefined) {
        return s;
      }
      return { past: [...s.past, s.present], present: next, future };
    });
  }, []);

  const reset = useCallback((value: T) => {
    setState({ past: [], present: value, future: [] });
  }, []);

  return useMemo(
    () => ({
      value: state.present,
      update,
      undo,
      redo,
      reset,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, update, undo, redo, reset],
  );
}
