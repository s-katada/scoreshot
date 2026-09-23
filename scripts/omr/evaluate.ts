/**
 * 開発用: OMR の後処理の認識率を測る。
 *
 *   pnpm omr:evaluate <正解の JSON があるディレクトリ> <segment-page の出力を並べたディレクトリ> [詳しく見る曲]
 *
 * 曲ごとに、正解の楽譜と読み取った楽譜を「何小節目・どちらの段・いつ・
 * どの高さ」で突き合わせ、音の適合率・再現率と、長さまで合っている割合を
 * 出す。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { staffEvents } from "../../src/model/edit";
import { midiNumber } from "../../src/model/pitch";
import { pitchToName, type Score, type StaffNumber } from "../../src/model/score";
import { makePage } from "../../src/omr/page";
import { recognize } from "../../src/omr/recognize";
import { TARGET_LINE_DISTANCE } from "../../src/omr/staffSpace";
import { loadPageData } from "./pageData";

const [truthDir, segDir, focus] = process.argv.slice(2);

interface NoteKey {
  measure: number;
  staff: StaffNumber;
  onset: number;
  midi: number;
  length: number;
}

function notes(score: Score): NoteKey[] {
  const out: NoteKey[] = [];
  score.measures.forEach((measure, index) => {
    for (const staff of [1, 2] as StaffNumber[]) {
      for (const event of staffEvents(measure, staff)) {
        for (const note of event.notes) {
          if (note.pitch !== null) {
            out.push({ measure: index, staff, onset: event.onset, midi: midiNumber(note.pitch), length: event.length });
          }
        }
      }
    }
  });
  return out;
}

function describe(score: Score, measure: number, staff: StaffNumber): string {
  const m = score.measures[measure];
  if (!m) return "(なし)";
  return staffEvents(m, staff)
    .map((e) => `${e.notes.map((n) => (n.pitch ? pitchToName(n.pitch) : "r")).join("+")}:${e.length}@${e.onset}`)
    .join(" ");
}

let totalTruth = 0;
let totalPred = 0;
let totalMatch = 0;
let totalExact = 0;
const rows: string[] = [];
for (const name of readdirSync(segDir).sort()) {
  const truthPath = join(truthDir, `${name}.json`);
  if (!existsSync(join(segDir, name, "symbols.u8.gz")) || !existsSync(truthPath)) {
    continue;
  }
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Score;
  const data = loadPageData(join(segDir, name));
  let score: Score;
  let warnings: string[] = [];
  try {
    const result = recognize(makePage(data.gray, data.staff, data.symbols, TARGET_LINE_DISTANCE));
    score = result.score;
    warnings = result.warnings;
  } catch (error) {
    rows.push(`${name}: 失敗 ${(error as Error).message}`);
    continue;
  }

  const expected = notes(truth);
  const actual = notes(score);
  const pool = [...actual];
  let match = 0;
  let exact = 0;
  for (const n of expected) {
    const i = pool.findIndex((p) => p.measure === n.measure && p.staff === n.staff && Math.abs(p.onset - n.onset) < 1e-6 && p.midi === n.midi);
    if (i >= 0) {
      match++;
      if (Math.abs(pool[i].length - n.length) < 1e-6) {
        exact++;
      }
      pool.splice(i, 1);
    }
  }
  totalTruth += expected.length;
  totalPred += actual.length;
  totalMatch += match;
  totalExact += exact;
  const pct = (a: number, b: number) => (b === 0 ? "-" : `${((a / b) * 100).toFixed(1)}%`);
  rows.push(
    `${name}: 小節 ${score.measures.length}/${truth.measures.length} 調号 ${score.key.fifths}/${truth.key.fifths} 拍子 ${score.time.beats}/${score.time.beatType} (正 ${truth.time.beats}/${truth.time.beatType}) 再現 ${pct(match, expected.length)} 適合 ${pct(match, actual.length)} 長さ ${pct(exact, match)}`,
  );

  if (focus === name) {
    console.log(warnings.join("\n"));
    for (let m = 0; m < Math.max(truth.measures.length, score.measures.length); m++) {
      for (const staff of [1, 2] as StaffNumber[]) {
        const want = describe(truth, m, staff);
        const got = describe(score, m, staff);
        console.log(`${want === got ? "  " : "✗ "}${m + 1}-${staff} 正: ${want}\n     読: ${got}`);
      }
    }
  }
}
console.log(rows.join("\n"));
console.log(`\n合計 再現 ${((totalMatch / totalTruth) * 100).toFixed(1)}% 適合 ${((totalMatch / totalPred) * 100).toFixed(1)}% 長さまで一致 ${((totalExact / totalTruth) * 100).toFixed(1)}%`);
