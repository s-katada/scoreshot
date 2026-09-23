/**
 * カメラで楽譜を撮る (#2)。
 *
 * getUserMedia で映像を出し、撮影ボタンでその瞬間の 1 枚を画像にする。
 * 撮った写真を確かめてから読み取りに回す (読み取りに 1 分ほどかかるので、
 * ぶれた写真で待たされないように)。
 *
 * カメラの許可は OS が出す (macOS はシステム設定、iOS は設定アプリ)。
 * WebView 側の許可は wry が自動で与える。拒否されていたら、どこで許可
 * するかを案内する。
 */

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "./styles";

interface CameraCaptureProps {
  onCapture: (photo: Blob) => void;
  onCancel: () => void;
}

type CameraState =
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "captured"; photo: Blob; url: string }
  | { kind: "error"; message: string };

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS の Safari は Mac を名乗るので、タッチの有無で見分ける
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** カメラの許可をどこで出すか */
function permissionHint(): string {
  if (isIOS()) {
    return "設定アプリの「プライバシーとセキュリティ」→「カメラ」で scoreshot をオンにしてから、もう一度お試しください。";
  }
  if (isTauri() && navigator.userAgent.includes("Macintosh")) {
    return "システム設定の「プライバシーとセキュリティ」→「カメラ」で scoreshot をオンにしてから、もう一度お試しください (オンにしたあと、アプリを開き直す必要があることがあります)。";
  }
  return "ブラウザのサイトの設定でカメラを許可してから、もう一度お試しください。";
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return `カメラの使用が許可されていません。${permissionHint()}`;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "カメラが見つかりませんでした。";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "カメラを起動できませんでした。ほかのアプリがカメラを使っていたら閉じてから、もう一度お試しください。";
    default:
      return `カメラを起動できませんでした (${name || String(error)})。`;
  }
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>({ kind: "starting" });
  // 増やすとカメラを起動し直す
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState({ kind: "starting" });
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ kind: "error", message: "この環境ではカメラを使えません。" });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // スマートフォンでは背面のカメラ。解像度は高いほど細かい記号が読める
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setState({ kind: "live" });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: "error", message: cameraErrorMessage(error) });
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [attempt]);

  // 撮った写真のプレビューの URL を片付ける
  const capturedUrl = state.kind === "captured" ? state.url : null;
  useEffect(
    () => () => {
      if (capturedUrl !== null) {
        URL.revokeObjectURL(capturedUrl);
      }
    },
    [capturedUrl],
  );

  const shoot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (photo) => {
        if (photo) {
          setState({ kind: "captured", photo, url: URL.createObjectURL(photo) });
        }
      },
      "image/jpeg",
      0.95,
    );
  };

  return (
    <div className="flex flex-col gap-3" aria-label="カメラ">
      {state.kind === "error" ? (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <p>{state.message}</p>
          <p className="opacity-80">撮った写真を「画像ファイルを選ぶ」から読み込むこともできます。</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={secondaryButtonClass}>
              もう一度試す
            </button>
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              やめる
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-md bg-black">
            {/* 映像は撮り直しのために止めずに出し続け、撮った写真を上に重ねる */}
            <video ref={videoRef} playsInline muted className="block max-h-[60vh] w-full object-contain" />
            {state.kind === "captured" && (
              <img
                src={state.url}
                alt="撮った写真"
                className="absolute inset-0 h-full w-full bg-black object-contain"
              />
            )}
            {state.kind === "starting" && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                カメラを起動しています…
              </p>
            )}
          </div>
          <p className="text-xs opacity-60">
            楽譜の 1 ページ全体が収まるように、なるべく真上から、明るい所で撮ってください。
          </p>
          <div className="flex flex-wrap gap-2">
            {state.kind === "captured" ? (
              <>
                <button type="button" onClick={() => onCapture(state.photo)} className={primaryButtonClass}>
                  この写真で読み取る
                </button>
                <button type="button" onClick={() => setState({ kind: "live" })} className={secondaryButtonClass}>
                  撮り直す
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={shoot}
                disabled={state.kind !== "live"}
                className={primaryButtonClass}
              >
                撮影
              </button>
            )}
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              やめる
            </button>
          </div>
        </>
      )}
    </div>
  );
}
