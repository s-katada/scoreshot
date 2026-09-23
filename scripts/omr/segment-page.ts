/**
 * 開発用: 楽譜の画像を縮尺合わせしてから 2 つのモデルに通し、ラベル画像を
 * 書き出す。後処理を詰めるときに、毎回モデルを走らせずに済むように。
 *
 *   pnpm omr:segment <入力.png> <出力ディレクトリ>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "fflate";
import { rgbaToGray } from "../../src/omr/image";
import { STAFF_MODEL, SYMBOL_MODEL, createOrtModel } from "../../src/omr/models";
import { prepareImage, segmentPage } from "../../src/omr/pipeline";
import { decodePng, encodePngRgb } from "./png";
import { loadNodeOrt } from "./nodeOrt";

const [input, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const png = decodePng(new Uint8Array(readFileSync(input)));
const { image: scaled, spacing, scale } = prepareImage(rgbaToGray(png.data, png.width, png.height));
console.log(`入力 ${png.width}×${png.height} / 線の間隔 ${spacing.lineDistance} 太さ ${spacing.lineThickness} → 倍率 ${scale.toFixed(3)} → ${scaled.width}×${scaled.height}`);
writeFileSync(join(outDir, "gray.u8.gz"), gzipSync(scaled.data));
writeFileSync(join(outDir, "meta.json"), JSON.stringify({ width: scaled.width, height: scaled.height, scale, spacing }));

const ort = await loadNodeOrt();
const load = async (spec: typeof STAFF_MODEL) =>
  createOrtModel(ort, new Uint8Array(readFileSync(join("public/models", spec.file))), spec, ["wasm"]);
const staffModel = await load(STAFF_MODEL);
const symbolModel = await load(SYMBOL_MODEL);
const started = { staff: 0, symbols: 0 };
const labels = await segmentPage(scaled, staffModel, symbolModel, (stage, done, total) => {
  if (done === 0) {
    started[stage] = performance.now();
  }
  process.stdout.write(`\r${stage}: ${done}/${total}`);
  if (done === total) {
    console.log(`  ${((performance.now() - started[stage]) / 1000).toFixed(1)} 秒`);
  }
});
await staffModel.release();
await symbolModel.release();

const palettes: Record<string, number[][]> = {
  staff: [[255, 255, 255], [0, 0, 255], [255, 0, 0]],
  symbols: [[255, 255, 255], [0, 160, 0], [255, 0, 0], [160, 0, 160]],
};
for (const [name, image] of [["staff", labels.staffLabels], ["symbols", labels.symbolLabels]] as const) {
  writeFileSync(join(outDir, `${name}.u8.gz`), gzipSync(image.data));
  const palette = palettes[name];
  const rgb = new Uint8Array(image.data.length * 3);
  image.data.forEach((c, i) => rgb.set(palette[c], i * 3));
  writeFileSync(join(outDir, `${name}.png`), encodePngRgb(image.width, image.height, rgb));
}
