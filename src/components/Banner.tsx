/**
 * 画面上部に出すお知らせ。エラーなど、見落とされると困るものに使う。
 */

import type { ReactNode } from "react";

interface BannerProps {
  tone: "error" | "info";
  children: ReactNode;
  /** 渡すと閉じるボタンが出る */
  onDismiss?: () => void;
}

const TONE_CLASS: Record<BannerProps["tone"], string> = {
  error:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
};

export function Banner({ tone, children, onDismiss }: BannerProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${TONE_CLASS[tone]}`}
    >
      <p className="flex-1 whitespace-pre-line">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label="閉じる"
        >
          ✕
        </button>
      )}
    </div>
  );
}
