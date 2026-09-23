/**
 * 開発用: Node で onnxruntime-web (WASM) を読み込む。アプリと同じ実装で
 * モデルを動かせる。
 */
import type * as Ort from "onnxruntime-web";
import { cpus } from "node:os";

export async function loadNodeOrt(): Promise<typeof Ort> {
  // package.json の exports の "node" 条件で Node 版 (WASM) が選ばれる
  const ort = (await import("onnxruntime-web")) as typeof Ort;
  ort.env.wasm.numThreads = Math.max(1, Math.min(8, cpus().length));
  return ort;
}
