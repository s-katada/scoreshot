import { scoreToTimedNotes } from "../../src/audio/player";
import { measureAccidentals } from "../../src/model/accidentals";
import { EditError, placeNotes, transpose } from "../../src/model/edit";
import {
  keyAlter,
  midiNumber,
  transposePitch,
  transposedFifths,
  transposedSteps,
} from "../../src/model/pitch";
import { pitchToName, STEPS, type Pitch, type Score } from "../../src/model/score";
import { tiePairs } from "../../src/model/ties";
import { scoreProblems } from "../../src/model/validate";
import { check, checkThrows, section } from "./harness";
import { blankScore, tiedScore } from "./scores";

section("移調");

/** 1 小節目の上段に 4 分音符を順に並べた楽譜 */
function build(fifths: number, pitches: Pitch[]): Score {
  let score = blankScore({ title: "移調", tempo: 120, fifths, time: { beats: 4, beatType: 4 }, measures: 1 });
  pitches.forEach((pitch, i) => {
    score = placeNotes(score, { measureIndex: 0, staff: 1, onset: i }, [pitch], { type: "quarter", dots: 0 }).score;
  });
  return score;
}

/** 上段の音の名前を並べる */
function names(score: Score): string {
  return score.measures
    .flatMap((m) => m.notes)
    .filter((n) => n.staff === 1 && n.pitch !== null)
    .map((n) => pitchToName(n.pitch!))
    .join(" ");
}

const C4 = { step: "C", octave: 4 } as const;
const Cs4 = { step: "C", octave: 4, alter: 1 } as const;
const E4 = { step: "E", octave: 4 } as const;
const F4 = { step: "F", octave: 4 } as const;
const G4 = { step: "G", octave: 4 } as const;

const c = build(0, [C4, E4, G4, Cs4]);

const up2 = transpose(c, 2);
check("ハ長調を長 2 度上げるとニ長調", up2.key.fifths === 2, String(up2.key.fifths));
check("音程どおりに綴る (C♯ は D♯)", names(up2) === "D4 F#4 A4 D#4", names(up2));

const up1 = transpose(c, 1);
check("半音上は ♭5 つの変ニ長調 (♯7 つの嬰ハ長調ではなく)", up1.key.fifths === -5, String(up1.key.fifths));
check("変ニ長調での綴り", names(up1) === "Db4 F4 Ab4 D4", names(up1));

const down1 = transpose(c, -1);
check("半音下はロ長調", down1.key.fifths === 5, String(down1.key.fifths));
// C♯ を短 2 度下げた音は、音程どおりなら C ではなく B♯
check("ロ長調での綴り", names(down1) === "B3 D#4 F#4 B#3", names(down1));

// C♯ を増 4 度上げると F𝄪 になるが、モデルでは持てないので G と綴る
const tritone = transpose(c, 6);
check("増 4 度上は嬰ヘ長調", tritone.key.fifths === 6, String(tritone.key.fifths));
check("♯♯ になる音は異名同音で綴る (F𝄪 → G)", names(tritone) === "F#4 A#4 C#5 G4", names(tritone));
check("変ロ長調の増 4 度上はホ長調 (変ヘ長調は ♭8 つで書けない)", transposedFifths(-2, 6) === 4, String(transposedFifths(-2, 6)));
check("♯♭ が同じ数なら元の調号と同じ側 (変ホ長調の短 3 度上は嬰ヘではなく変ト長調)", transposedFifths(-3, 3) === -6, String(transposedFifths(-3, 3)));
check("♯ の調からなら嬰ヘ長調 (イ長調の短 3 度下)", transposedFifths(3, -3) === 6, String(transposedFifths(3, -3)));

const octave = transpose(c, 12);
check("1 オクターブ上げても調号は同じ", octave.key.fifths === 0);
check("1 オクターブ上の綴り", names(octave) === "C5 E5 G5 C#5", names(octave));
check("1 オクターブ下", names(transpose(c, -12)) === "C3 E3 G3 C#3", names(transpose(c, -12)));

check("上げて下げると元に戻る", names(transpose(transpose(c, 5), -5)) === names(c));
check("0 なら同じ楽譜を返す", transpose(c, 0) === c);
check("移調しても楽譜の約束を守る", scoreProblems(tritone).length === 0, scoreProblems(tritone).join(" / "));

// 全部の調と全部の幅で、主音が行き先の主音に移り、鳴る高さがちょうど半音の数だけ動くこと
let keyMoves = 0;
const wrongKeys: string[] = [];
for (let fifths = -7; fifths <= 7; fifths++) {
  for (let semitones = -12; semitones <= 12; semitones++) {
    const to = transposedFifths(fifths, semitones);
    const steps = transposedSteps(fifths, to, semitones);
    const tonicIndex = (((fifths * 4) % 7) + 7) % 7;
    const step = STEPS[tonicIndex];
    const tonic: Pitch = { step, octave: 4, alter: keyAlter(step, fifths) };
    const moved = transposePitch(tonic, semitones, steps, to);
    const ok =
      to >= -7 &&
      to <= 7 &&
      midiNumber(moved) - midiNumber(tonic) === semitones &&
      (moved.alter ?? 0) === keyAlter(moved.step, to);
    if (ok) {
      keyMoves++;
    } else {
      wrongKeys.push(`${fifths}+${semitones}→${to} ${pitchToName(moved)}`);
    }
  }
}
check("どの調でも主音は行き先の主音に移る", wrongKeys.length === 0, `${keyMoves} 通り ${wrongKeys.slice(0, 3).join(", ")}`);

// 調の中の音は、移調しても臨時記号が要らない
const scale = build(0, [C4, { step: "D", octave: 4 }, E4, F4]);
const scaleUp = transpose(scale, 3);
const scaleMarks = measureAccidentals(scaleUp.measures[0], scaleUp.key.fifths);
check("調の中の音には移調しても臨時記号が付かない", scaleMarks.size === 0, `${scaleUp.key.fifths} ${names(scaleUp)}`);

// タイの楽譜は C4+E4 の 2 分音符と 4 分音符で、C4 だけをつないでいる
const tied = transpose(tiedScore(), 4);
check("タイはつながったまま", tiePairs(tied).size === 1 && tiePairs(tiedScore()).size === 1);
const timed = (score: Score) =>
  scoreToTimedNotes(score)
    .map((n) => `${n.name}:${n.length}@${n.at}`)
    .join(" ");
check(
  "再生では長 3 度上の E4 がつながって鳴る",
  timed(tied) === "E4:3@2 G#4:2@2 G#4:1@4",
  timed(tied),
);

const top = build(0, [{ step: "C", octave: 8 }]);
checkThrows("C8 は上げられない", () => transpose(top, 1), "鍵盤から外れる");
const bottom = build(0, [{ step: "A", octave: 0 }]);
checkThrows("A0 は下げられない", () => transpose(bottom, -1), "鍵盤から外れる");
checkThrows("1 オクターブより大きくは移調しない", () => transpose(c, 13), "1 オクターブ");
check("鍵盤から外れるときの例外は EditError", (() => {
  try {
    transpose(top, 1);
  } catch (error) {
    return error instanceof EditError;
  }
  return false;
})());
