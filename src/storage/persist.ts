/**
 * 開いている楽譜をローカルに保存し、次回起動時に復元する。
 */

import { useEffect, useRef, useState } from "react";
import { sampleScore } from "../model/sample";
import type { Score } from "../model/score";
import { parseScoreFile, serializeScore } from "./scoreFile";
import { describeError } from "../util/errors";
import { getTextStore } from "./textStore";

const FILE_NAME = "score.json";
/** 読み込めなかったファイルの退避先。次の保存で上書きされて消えないように */
const BROKEN_FILE_NAME = "score.broken.json";

export interface LoadedScore {
  score: Score;
  /** 保存済みの楽譜を復元できたら true。サンプルを出したら false */
  restored: boolean;
  /** 保存済みの楽譜があったのに読み込めなかったときの説明 */
  error?: string;
  /**
   * ファイルの中身が score と一致しているか。壊れたファイルを退避して
   * サンプルを出したときは false になり、次の自動保存でサンプルが書かれる
   * (毎回の起動で同じエラーが出続けないように)
   */
  inSync: boolean;
}

/**
 * 保存済みの楽譜を読み込む。無ければサンプルを返す。
 *
 * 壊れていたらサンプルにフォールバックし、その旨を error で伝える。
 * 壊れたファイルは別名で退避しておく (次の自動保存で上書きされないように)。
 */
export async function loadSavedScore(): Promise<LoadedScore> {
  const store = getTextStore();
  let text: string | null;
  try {
    text = await store.read(FILE_NAME);
  } catch (error) {
    // 読めなかっただけでファイルは無事かもしれないので、上書きしない
    return {
      score: sampleScore,
      restored: false,
      error: `保存された楽譜を読み込めませんでした。\n${describeError(error)}`,
      inSync: true,
    };
  }
  if (text === null) {
    return { score: sampleScore, restored: false, inSync: false };
  }

  try {
    return { score: parseScoreFile(text), restored: true, inSync: true };
  } catch (error) {
    let backedUp = false;
    try {
      await store.write(BROKEN_FILE_NAME, text);
      backedUp = true;
    } catch {
      // 退避に失敗しても、サンプルを出すこと自体は続ける
    }
    const backup = backedUp
      ? `\n元のファイルは ${BROKEN_FILE_NAME} に退避しました。`
      : "";
    return {
      score: sampleScore,
      restored: false,
      error: `保存された楽譜が壊れていたため、サンプルを表示しています。\n${describeError(error)}${backup}`,
      // 退避できなかったときは、編集されるまで元のファイルに触らない
      inSync: !backedUp,
    };
  }
}

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

/** 変更が落ち着いてから書き込むまでの待ち時間 */
const SAVE_DELAY_MS = 300;

/**
 * 楽譜が変わるたびに自動で保存する。
 *
 * baseline にはファイルに書かれていると分かっている楽譜を渡す (無ければ null)。
 * それと同じ内容のうちは書き込まない (起動しただけで保存が走らないように)。
 *
 * 書き込みは 1 本の列に並べて順に行う。前の書き込みが終わる前に次を
 * 始めると、遅れて終わった古い内容でファイルが上書きされうるため。
 */
export function useAutoSave(
  score: Score | null,
  baseline: Score | null,
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  // ファイルに書かれているはずの内容
  const savedRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // 最後に積んだ書き込みの番号。古い書き込みの結果で表示を戻さないため
  const seqRef = useRef(0);

  useEffect(() => {
    savedRef.current = baseline === null ? null : serializeScore(baseline);
  }, [baseline]);

  useEffect(() => {
    if (score === null) {
      return;
    }
    const text = serializeScore(score);

    const timer = window.setTimeout(() => {
      const seq = ++seqRef.current;
      const isLatest = () => seq === seqRef.current;

      queueRef.current = queueRef.current.then(async () => {
        if (text === savedRef.current) {
          if (isLatest()) {
            setStatus((s) => (s.state === "saving" ? { state: "saved" } : s));
          }
          return;
        }
        if (isLatest()) {
          setStatus({ state: "saving" });
        }
        try {
          await getTextStore().write(FILE_NAME, text);
          savedRef.current = text;
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
    }, SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [score]);

  return status;
}
