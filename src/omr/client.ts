/**
 * 画面から OMR を使う入口。
 *
 * 画像ファイルも、カメラで撮った写真も、画像のバイナリ (Blob) として
 * readScoreFromImage に渡す (入口を 1 つに揃えておけば、PDF も後から
 * ラスタライズする段を足すだけで読める)。画素に広げるところまでを
 * ここで行い、重い処理は Worker (omr.worker.ts) に任せる。
 */

import type { OmrProgress } from "./pipeline";
import type { OmrRequest, OmrResponse } from "./protocol";
import type { Recognition } from "./recognize";

/** 利用者にそのまま見せられる理由を持つ、読み取りの失敗 */
export class OmrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmrError";
  }
}

/**
 * 長い辺をこれより大きくはしない (メモリを食いすぎないように)。
 * スマートフォンの写真 (4032×3024 など) はそのまま使える
 */
const MAX_SIDE = 5000;

interface Pixels {
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

async function decode(image: Blob): Promise<Pixels> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new OmrError("画像を読めませんでした。PNG か JPEG の画像を使ってください。");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    bitmap.close();
    throw new OmrError("画像を読めませんでした。");
  }
  // 透明な所は白い紙として扱う
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  // canvas の画素の領域を早めに手放す (Safari は大きな canvas を溜めると落ちる)
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, rgba: data.buffer };
}

let worker: Worker | null = null;

function startWorker(): Worker {
  worker ??= new Worker(new URL("./omr.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Worker を止める。読み込んだモデルも捨てるので、次は読み込みからやり直す */
function stopWorker(): void {
  worker?.terminate();
  worker = null;
}

export interface ReadImageOptions {
  onProgress?: (progress: OmrProgress) => void;
  /** 中止すると AbortError で終わる */
  signal?: AbortSignal;
}

/**
 * 楽譜の画像を読み取る。読めなかったときは OmrError (理由をそのまま
 * 見せてよい)、中止したときは name が "AbortError" のエラーで終わる。
 * 一度に 1 つずつ呼ぶこと。
 */
export async function readScoreFromImage(
  image: Blob,
  options: ReadImageOptions = {},
): Promise<Recognition> {
  const { signal } = options;
  const aborted = () => new DOMException("読み取りを中止しました。", "AbortError");
  if (signal?.aborted) {
    throw aborted();
  }
  const pixels = await decode(image);
  if (signal?.aborted) {
    throw aborted();
  }

  const current = startWorker();
  return new Promise<Recognition>((resolve, reject) => {
    const finish = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<OmrResponse>) => {
      const response = event.data;
      if (response.type === "progress") {
        options.onProgress?.(response.progress);
        return;
      }
      finish();
      if (response.type === "done") {
        resolve(response.recognition);
      } else if (response.expected) {
        reject(new OmrError(response.message));
      } else {
        reject(new OmrError(`読み取りの途中で思わぬエラーが起きました。\n${response.message}`));
      }
    };
    const onError = (event: ErrorEvent) => {
      finish();
      stopWorker();
      reject(
        new OmrError(
          `読み取りの準備ができませんでした。\n${event.message || "Worker を起動できませんでした"}`,
        ),
      );
    };
    const onAbort = () => {
      finish();
      // 推論は途中で止められないので、Worker ごと止める
      stopWorker();
      reject(aborted());
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    const request: OmrRequest = { type: "read", ...pixels };
    current.postMessage(request, [pixels.rgba]);
  });
}
