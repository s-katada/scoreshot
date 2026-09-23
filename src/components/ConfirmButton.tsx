/**
 * 押すと確認を挟んでから実行するボタン。
 *
 * window.confirm は WebView によっては出ない (WKWebView は UI 側の実装が
 * 要る) ため、ボタン自身を「本当に？」の表示に切り替えて確認する。
 */

import { useState, type ReactNode } from "react";
import { secondaryButtonClass } from "./styles";

interface ConfirmButtonProps {
  children: ReactNode;
  onConfirm: () => void;
  /** 確認中に出す実行ボタンの文言 */
  confirmLabel: string;
  /** 確認中に添える説明 */
  message?: string;
  disabled?: boolean;
}

export function ConfirmButton({
  children,
  onConfirm,
  confirmLabel,
  message = "今の楽譜は失われます。",
  disabled,
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={disabled}
        className={secondaryButtonClass}
      >
        {children}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="opacity-70">{message}</span>
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className={secondaryButtonClass}
      >
        やめる
      </button>
    </span>
  );
}
