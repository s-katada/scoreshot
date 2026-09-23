/**
 * 画面と OMR の Worker (omr.worker.ts) の間でやりとりするメッセージ。
 */

import type { OmrProgress } from "./pipeline";
import type { Recognition } from "./recognize";

export interface OmrRequest {
  type: "read";
  width: number;
  height: number;
  /** RGBA の画素 (canvas の ImageData と同じ並び)。所有権ごと渡す */
  rgba: ArrayBuffer;
}

export type OmrResponse =
  | { type: "progress"; progress: OmrProgress }
  | { type: "done"; recognition: Recognition }
  /** expected は、画像のせいで読めなかった (撮り直せば読めるかもしれない) こと */
  | { type: "error"; message: string; expected: boolean };
