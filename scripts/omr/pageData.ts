/**
 * 開発用: segment-page が書き出した縮尺合わせ済みの画像とラベル画像を読む。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "fflate";
import type { GrayImage, LabelImage } from "../../src/omr/image";

export interface PageData {
  gray: GrayImage;
  staff: LabelImage;
  symbols: LabelImage;
}

export function loadPageData(dir: string): PageData {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { width: number; height: number };
  const read = (name: string) => gunzipSync(new Uint8Array(readFileSync(join(dir, name))));
  const { width, height } = meta;
  return {
    gray: { width, height, data: read("gray.u8.gz") },
    staff: { width, height, data: read("staff.u8.gz") },
    symbols: { width, height, data: read("symbols.u8.gz") },
  };
}
