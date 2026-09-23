/**
 * 開いている楽譜を自動で保存する。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Score } from "../model/score";
import { describeError } from "../util/errors";
import { serializeScore } from "./scoreFile";
import { getTextStore } from "./textStore";

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

/** 変更が落ち着いてから書き込むまでの待ち時間 */
const SAVE_DELAY_MS = 300;

export interface AutoSave {
  status: SaveStatus;
  /**
   * 待っている書き込みがあれば今すぐ書き、書き終わるのを待つ。
   * 別の楽譜に切り替える前に呼ぶ (待ち時間の間の編集を失わないように)。
   */
  flush: () => Promise<void>;
}

/**
 * 楽譜が変わるたびに、ファイル target へ自動で保存する。
 *
 * baseline にはファイルに書かれていると分かっている楽譜を渡す (無ければ
 * null)。それと同じ内容のうちは書き込まない (開いただけで保存が走らない
 * ように)。
 *
 * 書き込みは 1 本の列に並べて順に行う。前の書き込みが終わる前に次を
 * 始めると、遅れて終わった古い内容でファイルが上書きされうるため。
 */
export function useAutoSave(
  score: Score | null,
  baseline: Score | null,
  target: string | null,
): AutoSave {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  // ファイルごとに、書かれているはずの内容 (保存日時を除く)
  const savedRef = useRef(new Map<string, string>());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // 最後に積んだ書き込みの番号。古い書き込みの結果で表示を戻さないため
  const seqRef = useRef(0);
  const pendingRef = useRef<{ target: string; score: Score; timer: number } | null>(null);

  useEffect(() => {
    if (baseline !== null && target !== null) {
      savedRef.current.set(target, serializeScore(baseline));
    }
  }, [baseline, target]);

  const enqueue = useCallback((file: string, next: Score) => {
    const text = serializeScore(next);
    const seq = ++seqRef.current;
    const isLatest = () => seq === seqRef.current;

    queueRef.current = queueRef.current.then(async () => {
      if (savedRef.current.get(file) === text) {
        if (isLatest()) {
          setStatus((s) => (s.state === "saving" ? { state: "saved" } : s));
        }
        return;
      }
      if (isLatest()) {
        setStatus({ state: "saving" });
      }
      try {
        await getTextStore().write(file, serializeScore(next, new Date()));
        savedRef.current.set(file, text);
        if (isLatest()) {
          setStatus({ state: "saved" });
        }
      } catch (error) {
        if (isLatest()) {
          setStatus({
            state: "error",
            message: `楽譜を保存できませんでした。\n${describeError(error)}`,
          });
        }
      }
    });
  }, []);

  useEffect(() => {
    if (score === null || target === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      pendingRef.current = null;
      enqueue(target, score);
    }, SAVE_DELAY_MS);
    pendingRef.current = { target, score, timer };

    return () => {
      window.clearTimeout(timer);
      if (pendingRef.current?.timer === timer) {
        pendingRef.current = null;
      }
    };
  }, [score, target, enqueue]);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending !== null) {
      window.clearTimeout(pending.timer);
      pendingRef.current = null;
      enqueue(pending.target, pending.score);
    }
    return queueRef.current;
  }, [enqueue]);

  return { status, flush };
}
