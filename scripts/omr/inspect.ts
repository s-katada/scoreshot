/**
 * 開発用: 後処理の途中経過を確かめる。
 *
 *   pnpm omr:inspect <segment-page の出力ディレクトリ>
 *
 * 見つけた五線・段・小節と、段ごとの和音 (符頭の位置・黒玉か白玉か・
 * 符幹・連桁の数・付点・音価) を書き出す。あわせて、濃淡画像の上に五線
 * (赤)・小節線 (緑)・符頭 (黒玉は青、白玉は水色) を描いた inspect.png を
 * 同じディレクトリに置く。
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureBounds } from "../../src/omr/barlines";
import { buildChords } from "../../src/omr/chords";
import { findNoteheads } from "../../src/omr/noteheads";
import { makePage } from "../../src/omr/page";
import { TARGET_LINE_DISTANCE } from "../../src/omr/staffSpace";
import { findStaves, groupSystems, lineY } from "../../src/omr/staves";
import { encodePngRgb } from "./png";
import { loadPageData } from "./pageData";

const dir = process.argv[2];
const data = loadPageData(dir);
const initial = makePage(data.gray, data.staff, data.symbols, TARGET_LINE_DISTANCE);
const staves = findStaves(initial.staffLabels, initial.spacing);
// recognize と同じく、見つけた五線で線の間隔を測り直す
const spacing = [...staves.map((s) => s.spacing)].sort((a, b) => a - b)[Math.floor(staves.length / 2)] ?? TARGET_LINE_DISTANCE;
const page = { ...initial, spacing };
const systems = groupSystems(staves);
console.log(`五線 ${staves.length} 本 / 段 ${systems.length} / 線の間隔 ${spacing.toFixed(2)}`);
staves.forEach((s, i) =>
  console.log(
    `  五線 ${i}: x ${s.left.toFixed(0)}〜${s.right.toFixed(0)} 上の線 y ${lineY(s, 0, s.left).toFixed(0)}〜${lineY(s, 0, s.right).toFixed(0)} 間隔 ${s.spacing.toFixed(2)} 標本 ${s.samples.length}`,
  ),
);

const { width, height } = page;
const rgb = new Uint8Array(width * height * 3);
for (let i = 0; i < width * height; i++) {
  const v = 128 + (page.gray.data[i] >> 1);
  rgb.set([v, v, v], i * 3);
}
const plot = (x: number, y: number, color: number[]) => {
  const xx = Math.round(x);
  const yy = Math.round(y);
  if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
    rgb.set(color, (yy * width + xx) * 3);
  }
};

const heads = findNoteheads(page, systems);
systems.forEach((system, index) => {
  const bounds = measureBounds(page, system);
  console.log(
    `\n段 ${index} (五線 ${system.staves.length} 本) 小節 ${bounds.length}: ${bounds.map(([a, b]) => `${a.toFixed(0)}〜${b.toFixed(0)}`).join(" ")}`,
  );
  for (const chord of buildChords(page, system, heads[index])) {
    const stem = chord.stem ? `${chord.stem.x.toFixed(0)}:${chord.stem.top}〜${chord.stem.bottom}` : "-";
    console.log(
      `  x ${chord.x.toFixed(0)} 五線 ${chord.staff} 位置 [${chord.heads.map((h) => h.position).join(",")}] 黒玉 ${chord.heads.map((h) => (h.filled ? 1 : 0)).join("")} 符幹 ${stem} 連桁 ${chord.beams} 付点 ${chord.dots} → ${chord.duration.type}${".".repeat(chord.duration.dots)}`,
    );
  }
  for (const staff of system.staves) {
    for (let x = Math.round(staff.left); x <= staff.right; x++) {
      for (let line = 0; line < 5; line++) {
        plot(x, lineY(staff, line, x), [255, 0, 0]);
      }
    }
  }
  const first = system.staves[0];
  const last = system.staves[system.staves.length - 1];
  for (const [, end] of bounds) {
    for (let y = lineY(first, 0, end); y <= lineY(last, 4, end); y++) {
      plot(end, y, [0, 180, 0]);
    }
  }
  for (const head of heads[index]) {
    const color = head.filled ? [0, 0, 255] : [0, 200, 255];
    for (let x = head.left; x <= head.right; x++) {
      plot(x, head.y - spacing / 2, color);
      plot(x, head.y + spacing / 2, color);
    }
  }
});
writeFileSync(join(dir, "inspect.png"), encodePngRgb(width, height, rgb));
