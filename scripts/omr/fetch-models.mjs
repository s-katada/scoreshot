/**
 * OMR (#2) のモデルを取ってきて public/models/ に置く。
 *
 *   pnpm omr:models
 *
 * モデルは oemer (MIT License) が GitHub のリリースで配っているものを
 * そのまま使う。合わせて 100MB を超えるので git には入れない。取ってきた
 * ファイルは SHA-256 で確かめ、1 つ目のモデルは今の onnxruntime で読める
 * よう直してから置く (patch-onnx.mjs)。
 *
 * 置いたモデルは Vite の public/ として配られ、ビルドするとアプリに
 * 同梱される (オフラインで動く)。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchNegativePads } from "./patch-onnx.mjs";

const RELEASE = "https://github.com/BreezeWhite/oemer/releases/download/checkpoints";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "public/models");

const MODELS = [
  {
    // 五線と、それ以外の記号を分ける (UNet、入力 256×256)
    source: "1st_model.onnx",
    sourceSha256: "37512e858731096439746f60b377c049f07055b4a23ec6eb9a178ce92cfba174",
    output: "oemer-staff.onnx",
    outputSha256: "f6c191907b037d6530824c4738dadec6323166df76f61d637059aa902b885c4f",
    patch: true,
  },
  {
    // 記号を 符幹・休符 / 符頭 / 音部記号・調号 に分ける (入力 288×288)
    source: "2nd_model.onnx",
    sourceSha256: "ed2e1a86ea75712ee6cdc740e96f7a36753543cf9bb980227c071c9256d9d82e",
    output: "oemer-symbols.onnx",
    outputSha256: "ed2e1a86ea75712ee6cdc740e96f7a36753543cf9bb980227c071c9256d9d82e",
    patch: false,
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} を取れませんでした (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

mkdirSync(outDir, { recursive: true });

for (const model of MODELS) {
  const outPath = join(outDir, model.output);
  if (existsSync(outPath) && sha256(readFileSync(outPath)) === model.outputSha256) {
    console.log(`${model.output}: 置いてあるのでそのまま使います`);
    continue;
  }

  const url = `${RELEASE}/${model.source}`;
  console.log(`${model.output}: ${url} を取ってきます…`);
  const source = await download(url);
  if (sha256(source) !== model.sourceSha256) {
    throw new Error(`${model.source} の中身が想定と違います (SHA-256 が一致しません)`);
  }

  const output = model.patch ? patchNegativePads(source).model : source;
  if (sha256(output) !== model.outputSha256) {
    throw new Error(`${model.output} を直した結果が想定と違います (SHA-256 が一致しません)`);
  }
  writeFileSync(outPath, output);
  console.log(`${model.output}: 置きました (${(output.length / 1024 / 1024).toFixed(1)} MB)`);
}
