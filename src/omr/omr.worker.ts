/**
 * OMR を画面の裏で動かす Web Worker。
 *
 * 画像分割には数十秒かかり、onnxruntime-web の推論は呼んだスレッドを
 * 塞ぐので、画面のスレッドでは動かさない。モデル (合わせて 100MB ほど) は
 * 初めて使うときに読み込み、この Worker が生きている間は使い回す。
 *
 * onnxruntime-web は WASM で動かす。WebGPU の方が速くなりうるが、WKWebView
 * で使えるかどうかと、このモデルで結果が変わらないかを確かめられていない。
 */

import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { rgbaToGray } from "./image";
import { createOrtModel, type ModelSpec } from "./models";
import { readScoreFromGray } from "./pipeline";
import type { OmrRequest, OmrResponse } from "./protocol";
import { RecognitionError } from "./recognize";
import type { SegmentationModel } from "./segment";

// DOM の型しか読み込んでいないので、Worker として使う所だけ型を当てる
const scope = self as unknown as {
  postMessage(message: OmrResponse): void;
  onmessage: ((event: MessageEvent<OmrRequest>) => void) | null;
};

type Ort = typeof import("onnxruntime-web/wasm");

let ortModule: Promise<Ort> | null = null;
const models = new Map<string, Promise<SegmentationModel>>();

function loadOrt(): Promise<Ort> {
  ortModule ??= import("onnxruntime-web/wasm").then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    // 複数のスレッドで動かすには cross-origin isolation (COOP/COEP の
    // ヘッダ) が要る。無ければ 1 スレッドで動かす (4 倍ほど遅い)
    ort.env.wasm.numThreads = crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;
    return ort;
  });
  return ortModule;
}

async function fetchModel(file: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}models/${file}`);
  } catch {
    response = new Response(null, { status: 404 });
  }
  if (!response.ok) {
    throw new Error(
      `読み取りに使うモデル (${file}) がアプリに入っていません。pnpm omr:models で取ってきてからビルドしてください。`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function loadModel(spec: ModelSpec): Promise<SegmentationModel> {
  let model = models.get(spec.file);
  if (model === undefined) {
    model = Promise.all([loadOrt(), fetchModel(spec.file)]).then(([ort, bytes]) =>
      createOrtModel(ort, bytes, spec, ["wasm"]),
    );
    // 失敗したものは覚えておかず、次に読み直す
    model.catch(() => models.delete(spec.file));
    models.set(spec.file, model);
  }
  return model;
}

scope.onmessage = (event) => {
  const { width, height, rgba } = event.data;
  const gray = rgbaToGray(new Uint8ClampedArray(rgba), width, height);
  readScoreFromGray(
    gray,
    { load: loadModel },
    { onProgress: (progress) => scope.postMessage({ type: "progress", progress }) },
  )
    .then((recognition) => scope.postMessage({ type: "done", recognition }))
    .catch((error: unknown) =>
      scope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        expected: error instanceof RecognitionError,
      }),
    );
};
