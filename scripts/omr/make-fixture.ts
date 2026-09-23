/**
 * 開発用: segment-page の出力から段を 1 つ切り出して、pnpm check で使う
 * 後処理の検証用の材料 (scripts/fixtures/omr/) を作る。モデルを通さずに
 * 後処理だけを確かめられるように、モデルの出力ごと保存しておく。
 *
 *   pnpm omr:fixture <segment-page の出力> <正解の JSON> <段の番号> <出力.bin.gz>
 *
 * 正解は、その段に入っている小節だけを切り出して入れる。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, strToU8 } from "fflate";
import { measureBounds } from "../../src/omr/barlines";
import { makePage } from "../../src/omr/page";
import { TARGET_LINE_DISTANCE } from "../../src/omr/staffSpace";
import { findStaves, groupSystems, lineY } from "../../src/omr/staves";
import type { Score } from "../../src/model/score";
import { loadPageData } from "./pageData";

const [dir, truthPath, systemText, output] = process.argv.slice(2);
const data = loadPageData(dir);
const initial = makePage(data.gray, data.staff, data.symbols, TARGET_LINE_DISTANCE);
const staves = findStaves(initial.staffLabels, initial.spacing);
// recognize と同じく、見つけた五線で線の間隔を測り直す
const spacing = [...staves.map((s) => s.spacing)].sort((a, b) => a - b)[Math.floor(staves.length / 2)];
const page = { ...initial, spacing };
const systems = groupSystems(staves);
const index = Number(systemText);
const system = systems[index];
const d = page.spacing;

// 段の上下に、加線の上の音符や符幹が入るだけの余白を付けて切る
const first = system.staves[0];
const last = system.staves[system.staves.length - 1];
const top = Math.max(0, Math.floor(Math.min(lineY(first, 0, system.left), lineY(first, 0, system.right)) - d * 7));
const bottom = Math.min(page.height, Math.ceil(Math.max(lineY(last, 4, system.left), lineY(last, 4, system.right)) + d * 7));
const crop = (plane: Uint8Array) => plane.slice(top * page.width, bottom * page.width);

// 正解: この段より前の段の小節の数だけ飛ばす
const before = systems.slice(0, index).reduce((n, s) => n + measureBounds(page, s).length, 0);
const count = measureBounds(page, system).length;
const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Score;
const expected: Score = { ...truth, measures: truth.measures.slice(before, before + count) };

// 形式: [見出しの長さ (4 バイト)] [見出し (JSON)] [濃淡] [1 つ目のモデル] [2 つ目のモデル] を gzip
const height = bottom - top;
const header = strToU8(JSON.stringify({ width: page.width, height, score: expected }));
const size = page.width * height;
const body = new Uint8Array(4 + header.length + size * 3);
new DataView(body.buffer).setUint32(0, header.length);
body.set(header, 4);
body.set(crop(data.gray.data), 4 + header.length);
body.set(crop(data.staff.data), 4 + header.length + size);
body.set(crop(data.symbols.data), 4 + header.length + size * 2);
writeFileSync(output, gzipSync(body, { level: 9 }));
console.log(`${output}: ${page.width}×${height} 小節 ${before + 1}〜${before + count}`);
