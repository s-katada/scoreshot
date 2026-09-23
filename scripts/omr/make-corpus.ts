/**
 * 開発用: OMR の認識率を測るための楽譜を作る。
 *
 *   pnpm omr:corpus <出力ディレクトリ> <曲数> [乱数の種]
 *
 * ピアノ曲らしい楽譜 (右手は旋律と時々の和音・休符・臨時記号、左手は
 * 和音や分散和音) をランダムに作り、正解の Score (JSON) と MusicXML を
 * 書き出す。MusicXML は MuseScore で画像にする (scripts/omr/README.md)。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyMeasure,
  measureFromEvents,
  type Duration,
  type ImportedEvent,
} from "../../src/model/edit";
import { scoreToMusicXml } from "../../src/model/musicxml";
import { diatonicNumber, pitchFromDiatonic, withAlter } from "../../src/model/pitch";
import type { Pitch, Score, StaffNumber } from "../../src/model/score";

const [outDir, countText, seedText] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

// 再現できるよう、種から決まる乱数を使う (mulberry32)
let seed = Number(seedText ?? 1) >>> 0;
function random(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

const d = (type: Duration["type"], dots = 0): Duration => ({ type, dots });

/** 拍子ごとの右手のリズム (1 小節ぶん) */
const RIGHT_PATTERNS: Record<string, Duration[][]> = {
  "4/4": [
    [d("quarter"), d("quarter"), d("quarter"), d("quarter")],
    [d("half"), d("quarter"), d("quarter")],
    [d("quarter"), d("eighth"), d("eighth"), d("quarter"), d("quarter")],
    [d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("half")],
    [d("quarter", 1), d("eighth"), d("half")],
    [d("half"), d("half")],
    [d("whole")],
    [d("16th"), d("16th"), d("16th"), d("16th"), d("quarter"), d("half")],
    [d("half", 1), d("quarter")],
    [d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth")],
  ],
  "3/4": [
    [d("quarter"), d("quarter"), d("quarter")],
    [d("half"), d("quarter")],
    [d("quarter"), d("eighth"), d("eighth"), d("quarter")],
    [d("half", 1)],
    [d("quarter", 1), d("eighth"), d("quarter")],
    [d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("quarter")],
  ],
  "2/4": [
    [d("quarter"), d("quarter")],
    [d("half")],
    [d("eighth"), d("eighth"), d("quarter")],
    [d("quarter", 1), d("eighth")],
    [d("16th"), d("16th"), d("16th"), d("16th"), d("quarter")],
  ],
};

const LEFT_PATTERNS: Record<string, Duration[][]> = {
  "4/4": [[d("whole")], [d("half"), d("half")], [d("quarter"), d("quarter"), d("quarter"), d("quarter")], [d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth"), d("eighth")]],
  "3/4": [[d("half", 1)], [d("quarter"), d("quarter"), d("quarter")], [d("half"), d("quarter")]],
  "2/4": [[d("half")], [d("quarter"), d("quarter")], [d("eighth"), d("eighth"), d("eighth"), d("eighth")]],
};

function length(duration: Duration): number {
  const base = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125 }[duration.type];
  return duration.dots ? base * 1.5 : base;
}

function makeScore(index: number): Score {
  const timeKey = pick(["4/4", "3/4", "2/4", "4/4"]);
  const [beats, beatType] = timeKey.split("/").map(Number);
  const time = { beats, beatType };
  const fifths = pick([-3, -2, -1, 0, 0, 1, 2, 3]);
  const measureCount = pick([6, 8, 8, 12]);

  // 旋律は幹音で上下に歩かせる
  let melody = diatonicNumber({ step: "E", octave: 5 });
  let bass = diatonicNumber({ step: "C", octave: 3 });
  const measures = [];
  for (let m = 0; m < measureCount; m++) {
    const right: ImportedEvent[] = [];
    let onset = 0;
    for (const duration of pick(RIGHT_PATTERNS[timeKey])) {
      if (random() < 0.08) {
        right.push({ onset, duration, pitches: null });
      } else {
        melody = Math.min(diatonicNumber({ step: "A", octave: 5 }), Math.max(diatonicNumber({ step: "C", octave: 4 }), melody + pick([-2, -1, -1, 0, 1, 1, 2, 3, -3])));
        let pitch: Pitch = pitchFromDiatonic(melody, fifths);
        if (random() < 0.06) {
          // 調から外れる音 (臨時記号)
          const alter = pitch.alter ?? 0;
          pitch = withAlter(pitch, (alter === 0 ? pick([1, -1]) : 0) as -1 | 0 | 1);
        }
        const pitches = [pitch];
        if (random() < 0.15) {
          pitches.push(pitchFromDiatonic(melody - 2, fifths));
        }
        right.push({ onset, duration, pitches });
      }
      onset += length(duration);
    }

    const left: ImportedEvent[] = [];
    onset = 0;
    const leftPattern = pick(LEFT_PATTERNS[timeKey]);
    bass = Math.min(diatonicNumber({ step: "E", octave: 3 }), Math.max(diatonicNumber({ step: "E", octave: 2 }), bass + pick([-3, -1, 0, 1, 3, 4, -4])));
    for (const [i, duration] of leftPattern.entries()) {
      const root = pitchFromDiatonic(bass, fifths);
      if (leftPattern.length <= 2) {
        // 和音
        left.push({ onset, duration, pitches: [root, pitchFromDiatonic(bass + 2, fifths), pitchFromDiatonic(bass + 4, fifths)] });
      } else {
        // 分散和音
        left.push({ onset, duration, pitches: [pitchFromDiatonic(bass + [0, 4, 2, 4][i % 4], fifths)] });
      }
      onset += length(duration);
    }

    measures.push(measureFromEvents(time, { 1: right, 2: left } as Record<StaffNumber, ImportedEvent[]>));
  }
  return {
    title: `OMR 試験 ${index + 1}`,
    tempo: 100,
    key: { fifths },
    time,
    measures: measures.length > 0 ? measures : [emptyMeasure(time)],
  };
}

const count = Number(countText ?? 10);
for (let i = 0; i < count; i++) {
  const score = makeScore(i);
  const name = `piece-${String(i + 1).padStart(2, "0")}`;
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(score, null, 1));
  writeFileSync(join(outDir, `${name}.musicxml`), scoreToMusicXml(score));
}
console.log(`${count} 曲を ${outDir} に書き出しました`);
