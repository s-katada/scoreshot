import { measureAccidentals } from "../../src/model/accidentals";
import { emptyMeasure, placeNotes, type Duration } from "../../src/model/edit";
import { scoreToMusicXml } from "../../src/model/musicxml";
import { sampleScore } from "../../src/model/sample";
import type { Pitch, Score, StaffNumber } from "../../src/model/score";
import { check, section } from "./harness";

section("臨時記号");

const quarter: Duration = { type: "quarter", dots: 0 };

/** 1 小節目の上段 (または下段) に 4 分音符を順に並べた楽譜 */
function build(fifths: number, bars: Pitch[][], staff: StaffNumber = 1): Score {
  let score: Score = {
    ...sampleScore,
    key: { fifths },
    measures: bars.map(() => emptyMeasure(sampleScore.time)),
  };
  bars.forEach((pitches, measureIndex) => {
    pitches.forEach((pitch, i) => {
      score = placeNotes(score, { measureIndex, staff, onset: i }, [pitch], quarter).score;
    });
  });
  return score;
}

/** 小節ごとに、上段の音符に付く記号を並べる ("-" は無し) */
function marks(score: Score, staff: StaffNumber = 1): string {
  return score.measures
    .map((m) => {
      const found = measureAccidentals(m, score.key.fifths);
      return m.notes
        .filter((n) => n.staff === staff && n.pitch !== null)
        .map((n) => found.get(n.id) ?? "-")
        .join(" ");
    })
    .join(" | ");
}

const F4 = { step: "F", octave: 4 } as const;
const Fs4 = { step: "F", octave: 4, alter: 1 } as const;
const Fs5 = { step: "F", octave: 5, alter: 1 } as const;
const B4 = { step: "B", octave: 4 } as const;
const Bb4 = { step: "B", octave: 4, alter: -1 } as const;
const Cs4 = { step: "C", octave: 4, alter: 1 } as const;

const g = build(1, [[Fs4, F4, F4, Fs4], [Fs4]]);
check("ト長調の F♯ には付けない / F は ♮ / 戻すときは ♯", marks(g) === "- natural - sharp | -", marks(g));
const f = build(-1, [[Bb4, B4, Bb4]]);
check("ヘ長調の B♭ には付けない / B は ♮", marks(f) === "- natural flat", marks(f));
const c = build(0, [[Cs4, Cs4], [Cs4]]);
check("臨時記号は小節の終わりまで効く", marks(c) === "sharp - | sharp", marks(c));
const octaves = build(0, [[Fs4, Fs5]]);
check("オクターブ違いには効かない", marks(octaves) === "sharp sharp", marks(octaves));
const lower = build(1, [[{ step: "F", octave: 3 }]], 2);
check("下段も調号で決める", marks(lower, 2) === "natural", marks(lower, 2));

const xml = scoreToMusicXml(g);
const written = [...xml.matchAll(/<accidental>(\w+)<\/accidental>/g)].map((m) => m[1]);
check("MusicXML に書く記号", written.join(",") === "natural,sharp", written.join(","));
check("鳴る高さは alter に残す", (xml.match(/<alter>1<\/alter>/g) ?? []).length === 3);
