/**
 * OMR で使う画像分割モデル (oemer、public/models/NOTICE.md) の仕様と、
 * onnxruntime で動かすための包み。
 *
 * onnxruntime は、アプリでは onnxruntime-web (WebGPU か WASM)、Node の
 * 検証では同じ onnxruntime-web の Node 版を使う。どちらも同じ形の API
 * なので、呼び出し側から渡してもらう。
 */

import type * as Ort from "onnxruntime-web";
import type { SegmentationModel } from "./segment";

export interface ModelSpec {
  file: string;
  tileSize: number;
  classes: number;
}

/** 五線と、それ以外の記号を分ける。0 = 背景 / 1 = 五線 / 2 = 記号 */
export const STAFF_MODEL: ModelSpec = { file: "oemer-staff.onnx", tileSize: 256, classes: 3 };
export const STAFF_CLASS = { background: 0, staff: 1, symbol: 2 } as const;

/**
 * 記号を細かく分ける。0 = 背景 / 1 = 符幹・休符 (小節線もここに入る) /
 * 2 = 符頭 (白玉も塗りつぶして出る) / 3 = 音部記号・調号 (臨時記号も)
 */
export const SYMBOL_MODEL: ModelSpec = { file: "oemer-symbols.onnx", tileSize: 288, classes: 4 };
export const SYMBOL_CLASS = { background: 0, stemOrRest: 1, notehead: 2, clefOrKey: 3 } as const;

type OrtModule = Pick<typeof Ort, "InferenceSession" | "Tensor">;

export async function createOrtModel(
  ort: OrtModule,
  model: Uint8Array | string,
  spec: ModelSpec,
  executionProviders: string[],
): Promise<SegmentationModel & { release: () => Promise<void> }> {
  const session =
    typeof model === "string"
      ? await ort.InferenceSession.create(model, { executionProviders })
      : await ort.InferenceSession.create(model, { executionProviders });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const size = spec.tileSize;

  return {
    tileSize: spec.tileSize,
    classes: spec.classes,
    async run(tiles, count) {
      const input = new ort.Tensor("uint8", tiles, [count, size, size, 3]);
      const result = await session.run({ [inputName]: input });
      const output = result[outputName];
      const data = (await output.getData()) as Float32Array;
      output.dispose();
      return data;
    },
    release: () => session.release(),
  };
}
