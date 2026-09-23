/**
 * OMR (#2) のうち、モデル (100MB) を使わずに確かめられる所。
 *
 * - 画像の下ごしらえ: 紙の地を白に揃える、線の間隔を測る
 * - タイルに分けた推論: 偽のモデルで、タイルの切れ目でも画素ごとに
 *   正しく戻るか、白紙のタイルや除いたタイルを通さないか
 * - 後処理: 本物のモデルの出力を段 1 つぶん保存したもの
 *   (scripts/fixtures/omr/、pnpm omr:fixture で作る) を読み、正解と
 *   突き合わせる。写真の傾きに付いていけるかは、それを傾けて確かめる
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, strFromU8 } from "fflate";
import { staffEvents } from "../../src/model/edit";
import { midiNumber } from "../../src/model/pitch";
import type { Score, StaffNumber } from "../../src/model/score";
import { flattenBackground, type GrayImage, type LabelImage } from "../../src/omr/image";
import { makePage } from "../../src/omr/page";
import { recognize } from "../../src/omr/recognize";
import { segment, type SegmentationModel } from "../../src/omr/segment";
import { TARGET_LINE_DISTANCE, estimateStaffSpacing, normalizingScale } from "../../src/omr/staffSpace";
import { check, section } from "./harness";

section("OMR: 画像の下ごしらえ");

{
  // 左上が明るく右下が暗い (照明のむら) 地に、黒い横線
  const width = 240;
  const height = 120;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const line = y >= 58 && y <= 60 && x >= 20 && x < 220;
      data[y * width + x] = line ? 30 : Math.round(225 - 100 * ((x / width) * 0.6 + (y / height) * 0.4));
    }
  }
  const flat = flattenBackground({ width, height, data });
  let paper = 255;
  let ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = flat.data[y * width + x];
      if (y >= 58 && y <= 60 && x >= 20 && x < 220) {
        ink = Math.max(ink, v);
      } else if (Math.abs(y - 59) > 3) {
        paper = Math.min(paper, v);
      }
    }
  }
  check("照明のむらがあっても紙の地が白に揃う", paper >= 235, `地のいちばん暗い所 ${paper}`);
  check("インクは暗いまま残る", ink <= 90, `線のいちばん明るい所 ${ink}`);
}

/** 線の間隔 spacing・太さ thickness の五線を縦に並べた画像 */
function staffImage(spacing: number, thickness: number): GrayImage {
  const width = 400;
  const height = 600;
  const data = new Uint8Array(width * height).fill(255);
  for (let top = 40; top + spacing * 4 < height; top += spacing * 10) {
    for (let line = 0; line < 5; line++) {
      for (let t = 0; t < thickness; t++) {
        data.fill(0, (top + line * spacing + t) * width, (top + line * spacing + t + 1) * width);
      }
    }
  }
  return { width, height, data };
}

{
  const spacing = estimateStaffSpacing(staffImage(20, 2));
  check(
    "五線の線の間隔と太さを測れる",
    spacing?.lineDistance === 20 && spacing.lineThickness === 2,
    JSON.stringify(spacing),
  );
  check("線の間隔が 13.5 画素になる倍率を選ぶ", Math.abs(normalizingScale(spacing) - 13.5 / 20) < 1e-9);
  const blank = { width: 100, height: 100, data: new Uint8Array(100 * 100).fill(255) };
  check("五線の無い画像では測れない (null)", estimateStaffSpacing(blank) === null);
}

section("OMR: タイルに分けた推論");

{
  // 暗い画素を 1、それ以外を 0 とする偽のモデル
  const tile = 32;
  let tilesRun = 0;
  const fake: SegmentationModel = {
    tileSize: tile,
    classes: 2,
    async run(tiles, count) {
      tilesRun += count;
      const out = new Float32Array(count * tile * tile * 2);
      for (let p = 0; p < count * tile * tile; p++) {
        const dark = tiles[p * 3] < 128;
        out[p * 2] = dark ? 0.1 : 0.9;
        out[p * 2 + 1] = dark ? 0.9 : 0.1;
      }
      return out;
    },
  };
  // 右の方は白紙。タイルの大きさで割り切れない幅と高さにする
  const width = 150;
  const height = 70;
  const data = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < 400; i++) {
    const x = (i * 37) % 90;
    const y = (i * 53) % height;
    data[y * width + x] = 0;
  }
  const image = { width, height, data };
  const labels = await segment(image, fake, { overlap: 0.25, batch: 3 });
  const wrong = data.filter((v, i) => (v < 128 ? 1 : 0) !== labels.data[i]).length;
  check("タイルの切れ目でも画素ごとに正しく戻る", wrong === 0 && labels.width === width, `違う画素 ${wrong}`);
  const withBlank = tilesRun;
  tilesRun = 0;
  await segment({ width, height, data: new Uint8Array(width * height) }, fake, { overlap: 0.25 });
  check("白紙のタイルはモデルに通さない", withBlank < tilesRun, `${withBlank} 枚 (白紙が無いと ${tilesRun} 枚)`);
  tilesRun = 0;
  const skipped = await segment(image, fake, { include: (left) => left < 40 });
  check(
    "除いたタイルは通さず背景にする",
    skipped.data.slice(0, width).every((v, x) => x < 64 || v === 0) && tilesRun > 0,
    `${tilesRun} 枚`,
  );
  const small = await segment({ width: 10, height: 12, data: new Uint8Array(120) }, fake);
  check("タイルより小さい画像も読める", small.width === 10 && small.height === 12 && small.data.every((v) => v === 1));
}

section("OMR: 後処理");

interface Fixture {
  score: Score;
  gray: GrayImage;
  staff: LabelImage;
  symbols: LabelImage;
}

function loadFixture(name: string): Fixture {
  const body = gunzipSync(new Uint8Array(readFileSync(join(process.cwd(), "scripts/fixtures/omr", name))));
  const headerLength = new DataView(body.buffer, body.byteOffset).getUint32(0);
  const header = JSON.parse(strFromU8(body.subarray(4, 4 + headerLength))) as {
    width: number;
    height: number;
    score: Score;
  };
  const { width, height } = header;
  const plane = (k: number) => ({
    width,
    height,
    data: body.slice(4 + headerLength + width * height * k, 4 + headerLength + width * height * (k + 1)),
  });
  return { score: header.score, gray: plane(0), staff: plane(1), symbols: plane(2) };
}

/** 中心で angle (度) 回す。ラベルは最も近い画素、濃淡は双線形で */
function rotate<T extends GrayImage | LabelImage>(image: T, degrees: number, nearest: boolean, fill: number): T {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const sx = cos * dx + sin * dy + width / 2;
      const sy = -sin * dx + cos * dy + height / 2;
      let value = fill;
      if (sx >= 0 && sy >= 0 && sx < width - 1 && sy < height - 1) {
        if (nearest) {
          value = data[Math.round(sy) * width + Math.round(sx)];
        } else {
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const tx = sx - x0;
          const ty = sy - y0;
          const p = (xx: number, yy: number) => data[yy * width + xx];
          value = Math.round(
            p(x0, y0) * (1 - tx) * (1 - ty) +
              p(x0 + 1, y0) * tx * (1 - ty) +
              p(x0, y0 + 1) * (1 - tx) * ty +
              p(x0 + 1, y0 + 1) * tx * ty,
          );
        }
      }
      out[y * width + x] = value;
    }
  }
  return { ...image, data: out };
}

interface NoteKey {
  measure: number;
  staff: StaffNumber;
  onset: number;
  midi: number;
  length: number;
}

function notes(score: Score): NoteKey[] {
  return score.measures.flatMap((measure, index) =>
    ([1, 2] as StaffNumber[]).flatMap((staff) =>
      staffEvents(measure, staff).flatMap((event) =>
        event.notes.flatMap((note) =>
          note.pitch === null
            ? []
            : [{ measure: index, staff, onset: event.onset, midi: midiNumber(note.pitch), length: event.length }],
        ),
      ),
    ),
  );
}

/** 正解の音のうち、高さ・時刻が合う音の数と、長さまで合う音の数 */
function compare(expected: Score, actual: Score): { found: number; exact: number; total: number; read: number } {
  const want = notes(expected);
  const pool = notes(actual);
  const read = pool.length;
  let found = 0;
  let exact = 0;
  for (const n of want) {
    const i = pool.findIndex(
      (p) => p.measure === n.measure && p.staff === n.staff && Math.abs(p.onset - n.onset) < 1e-6 && p.midi === n.midi,
    );
    if (i >= 0) {
      found++;
      if (Math.abs(pool[i].length - n.length) < 1e-6) {
        exact++;
      }
      pool.splice(i, 1);
    }
  }
  return { found, exact, total: want.length, read };
}

{
  const fixture = loadFixture("piece-01-system1.bin.gz");
  const { score } = recognize(makePage(fixture.gray, fixture.staff, fixture.symbols, TARGET_LINE_DISTANCE));
  const truth = fixture.score;
  check(
    "段の小節・調号・拍子を読める",
    score.measures.length === truth.measures.length &&
      score.key.fifths === truth.key.fifths &&
      score.time.beats === truth.time.beats &&
      score.time.beatType === truth.time.beatType,
    `小節 ${score.measures.length}/${truth.measures.length} 調号 ${score.key.fifths}/${truth.key.fifths} 拍子 ${score.time.beats}/${score.time.beatType}`,
  );
  const result = compare(truth, score);
  check(
    "きれいな画像の音をすべて、高さと長さまで読める",
    result.exact === result.total && result.read === result.total,
    `長さまで一致 ${result.exact}/${result.total} 読んだ音 ${result.read}`,
  );

  // 写真のように 1.5° 傾けても、五線と小節線を追えるか
  const tilted = recognize(
    makePage(
      rotate(fixture.gray, 1.5, false, 255),
      rotate(fixture.staff, 1.5, true, 0),
      rotate(fixture.symbols, 1.5, true, 0),
      TARGET_LINE_DISTANCE,
    ),
  ).score;
  const tiltedResult = compare(truth, tilted);
  check(
    "傾いた画像でも小節の区切りを読める",
    tilted.measures.length === truth.measures.length,
    `小節 ${tilted.measures.length}/${truth.measures.length}`,
  );
  check(
    "傾いた画像でも音の 95% 以上を読める",
    tiltedResult.found >= tiltedResult.total * 0.95,
    `${tiltedResult.found}/${tiltedResult.total} (長さまで一致 ${tiltedResult.exact})`,
  );
}
