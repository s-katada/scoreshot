/**
 * 楽譜の画像から読み取る画面 (#2)。
 *
 * 画像ファイルを選び、画像のバイナリにして読み取り (readScoreFromImage)
 * に渡す。読み取りには 1 分ほどかかるので、
 * どこまで進んだかと経過時間を出し、途中でやめられるようにする。
 */

import { useEffect, useRef, useState } from "react";
import { OmrError, readScoreFromImage } from "../omr/client";
import type { OmrProgress, OmrStage } from "../omr/pipeline";
import type { Recognition } from "../omr/recognize";
import { imageType, openImage } from "../storage/userFiles";
import { describeError } from "../util/errors";
import { secondaryButtonClass } from "./styles";

interface OmrPanelProps {
  /** 読み取れたとき。name は元の画像の名前 (題名に使う) */
  onRecognized: (recognition: Recognition, name: string) => void;
  onClose: () => void;
}

type PanelState =
  | { kind: "idle"; error?: string }
  | { kind: "reading"; name: string; progress: OmrProgress; startedAt: number };

const STAGE_LABEL: Record<OmrStage, string> = {
  loading: "読み取りの準備をしています",
  staff: "五線を探しています",
  symbols: "音符や記号を探しています",
  recognizing: "楽譜に組み立てています",
};

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function OmrPanel({ onRecognized, onClose }: OmrPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // 閉じたら、途中の読み取りもやめる
  useEffect(() => () => abortRef.current?.abort(), []);

  const reading = state.kind === "reading";
  useEffect(() => {
    if (!reading) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [reading]);

  const read = async (image: Blob, name: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    setNow(startedAt);
    setState({ kind: "reading", name, progress: { stage: "loading", fraction: 0 }, startedAt });
    try {
      const recognition = await readScoreFromImage(image, {
        signal: controller.signal,
        onProgress: (progress) =>
          setState((s) => (s.kind === "reading" ? { ...s, progress } : s)),
      });
      setState({ kind: "idle" });
      onRecognized(recognition, name);
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ kind: "idle" });
        return;
      }
      const message =
        error instanceof OmrError ? error.message : `思わぬエラーです: ${describeError(error)}`;
      setState({ kind: "idle", error: `「${name}」を読み取れませんでした。\n${message}` });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const pickFile = async () => {
    let picked;
    try {
      picked = await openImage();
    } catch (error) {
      setState({ kind: "idle", error: `ファイルを開けませんでした。\n${describeError(error)}` });
      return;
    }
    if (picked !== null) {
      void read(new Blob([picked.bytes as BlobPart], { type: imageType(picked.name) }), baseName(picked.name));
    }
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
      aria-label="画像から読み取る"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">画像から読み取る</h2>
          <p className="opacity-60">
            楽譜の写真やスキャン画像から楽譜を読み取り、新しい楽譜として楽譜一覧に足します。
            読み取りは完全ではないので、再生して確かめ、違う所は編集で直してください。
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="閉じる">
          ✕
        </button>
      </div>

      {state.kind === "reading" && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p>
            「{state.name}」を読み取っています — {STAGE_LABEL[state.progress.stage]}…
            <span className="ml-2 tabular-nums opacity-60">
              {Math.round(state.progress.fraction * 100)}% / {Math.floor((now - state.startedAt) / 1000)} 秒
            </span>
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress.fraction * 100)}
          >
            <div
              className="h-full bg-neutral-900 transition-[width] duration-500 dark:bg-white"
              style={{ width: `${state.progress.fraction * 100}%` }}
            />
          </div>
          <p className="text-xs opacity-60">1 ページで 1 分ほどかかります。</p>
          <div>
            <button type="button" onClick={() => abortRef.current?.abort()} className={secondaryButtonClass}>
              中止
            </button>
          </div>
        </div>
      )}

      {state.kind === "idle" && (
        <>
          {state.error !== undefined && (
            <p role="alert" className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void pickFile()} className={secondaryButtonClass}>
              画像ファイルを選ぶ
            </button>
          </div>
          <p className="text-xs opacity-60">
            ピアノの大譜表 (上下 2 段) の、印刷された楽譜が対象です。1 回に 1 ページずつ読み取ります。
          </p>
        </>
      )}
    </section>
  );
}
