import {
  EditError,
  addChordNote,
  emptyMeasure,
  insertMeasure,
  placeNotes,
  removeMeasure,
  removeNote,
  setEventDuration,
  setNotePitch,
  snapOnset,
  staffEvents,
  toggleRest,
  type StaffEvent,
} from "../../src/model/edit";
import { pitchToName, type Score, type StaffNumber } from "../../src/model/score";
import { sampleScore } from "../../src/model/sample";
import { scoreProblems } from "../../src/model/validate";
import { check, checkThrows, section } from "./harness";

section("編集操作");

/** 段の中身を "C4:quarter@0 rest:half@2" のような文字列にする */
function describeStaff(score: Score, measureIndex: number, staff: StaffNumber): string {
  return staffEvents(score.measures[measureIndex], staff)
    .map((e: StaffEvent) => {
      const names = e.notes.map((n) => (n.pitch ? pitchToName(n.pitch) : "rest")).join("+");
      const head = e.notes[0];
      return `${names}:${head.type}${head.dots ? "." : ""}@${e.onset}`;
    })
    .join(" ");
}

function checkStaff(label: string, score: Score, measureIndex: number, staff: StaffNumber, expected: string) {
  const actual = describeStaff(score, measureIndex, staff);
  const problems = scoreProblems(score);
  check(label, actual === expected && problems.length === 0,
    actual === expected ? problems.join(" / ") : `期待 "${expected}" / 実際 "${actual}"`);
}

const C4 = { step: "C", octave: 4 } as const;
const E4 = { step: "E", octave: 4 } as const;
const G4 = { step: "G", octave: 4 } as const;
const quarter = { type: "quarter", dots: 0 } as const;
const half = { type: "half", dots: 0 } as const;

const empty44: Score = { ...sampleScore, measures: [emptyMeasure({ beats: 4, beatType: 4 })] };
checkStaff("空の 4/4 は全休符", empty44, 0, 1, "rest:whole@0");
const empty34: Score = { ...sampleScore, time: { beats: 3, beatType: 4 }, measures: [emptyMeasure({ beats: 3, beatType: 4 })] };
checkStaff("空の 3/4 は付点 2 分休符", empty34, 0, 2, "rest:half.@0");
const empty68: Score = { ...sampleScore, time: { beats: 6, beatType: 8 }, measures: [emptyMeasure({ beats: 6, beatType: 8 })] };
checkStaff("空の 6/8 は付点 2 分休符", empty68, 0, 1, "rest:half.@0");

const placed = placeNotes(empty44, { measureIndex: 0, staff: 1, onset: 0 }, [C4], quarter);
checkStaff("頭に 4 分音符を置く", placed.score, 0, 1, "C4:quarter@0 rest:quarter@1 rest:half@2");
check("置いた音符の id を返す", placed.noteIds.length === 1 && placed.score.measures[0].notes[0].id === placed.noteIds[0]);
checkStaff("4 拍目に置く", placeNotes(empty44, { measureIndex: 0, staff: 1, onset: 3 }, [C4], quarter).score, 0, 1,
  "rest:half@0 rest:quarter@2 C4:quarter@3");
checkStaff("下段は触らない", placed.score, 0, 2, "rest:whole@0");

// サンプル 1 小節目の上段は C4 C4 G4 G4
checkStaff("2 分音符で 2 音を上書き", placeNotes(sampleScore, { measureIndex: 0, staff: 1, onset: 1 }, [E4], half).score, 0, 1,
  "C4:quarter@0 E4:half@1 G4:quarter@3");
checkStaff("和音を置く", placeNotes(empty44, { measureIndex: 0, staff: 1, onset: 0 }, [G4, C4, E4], half).score, 0, 1,
  "C4+E4+G4:half@0 rest:half@2");
checkStaff("休符を置く", placeNotes(sampleScore, { measureIndex: 0, staff: 1, onset: 2 }, null, half).score, 0, 1,
  "C4:quarter@0 C4:quarter@1 rest:half@2");
checkThrows("はみ出す", () => placeNotes(sampleScore, { measureIndex: 0, staff: 1, onset: 3 }, [C4], half), "小節に収まりません");
// 2 小節目は A4 A4 G4(2分)。3 拍目からの 2 分音符の途中には置けない
checkThrows("音符の途中", () => placeNotes(sampleScore, { measureIndex: 1, staff: 1, onset: 3 }, [C4], quarter), "音符の途中には置けません");
check("EditError で投げる", (() => { try { placeNotes(sampleScore, { measureIndex: 0, staff: 1, onset: 3.5 }, [C4], half); } catch (e) { return e instanceof EditError; } return false; })());

const chord = addChordNote(sampleScore, { measureIndex: 0, staff: 1, onset: 0 }, E4, half);
checkStaff("和音に音を足す (長さは元の音に合わせる)", chord.score, 0, 1, "C4+E4:quarter@0 C4:quarter@1 G4:quarter@2 G4:quarter@3");
check("足した音は chord 付き", chord.score.measures[0].notes.find((n) => n.id === chord.noteIds[0])?.chord === true);
check("同じ音は足さない", addChordNote(chord.score, { measureIndex: 0, staff: 1, onset: 0 }, E4, half).score === chord.score);
checkStaff("休符の位置なら新しく置く", addChordNote(empty44, { measureIndex: 0, staff: 1, onset: 2 }, E4, half).score, 0, 1,
  "rest:half@0 E4:half@2");

const lowerChord = sampleScore.measures[0].notes.filter((n) => n.staff === 2);
checkStaff("和音から 1 音消す", removeNote(sampleScore, lowerChord[1].id).score, 0, 2, "C3+G3:whole@0");
const upper = sampleScore.measures[0].notes.filter((n) => n.staff === 1);
const removed = removeNote(removeNote(sampleScore, upper[3].id).score, upper[2].id);
checkStaff("消した所の休符はまとめ直す", removed.score, 0, 1, "C4:quarter@0 C4:quarter@1 rest:half@2");
check("消したあとは休符を選ぶ", removed.noteIds.length === 1 && removed.score.measures[0].notes.find((n) => n.id === removed.noteIds[0])?.pitch === null);

checkStaff("長くすると後ろを上書き", setEventDuration(sampleScore, upper[0].id, half).score, 0, 1, "C4:half@0 G4:quarter@2 G4:quarter@3");
const m2 = sampleScore.measures[1].notes.filter((n) => n.staff === 1);
checkStaff("短くすると休符が入る", setEventDuration(sampleScore, m2[2].id, quarter).score, 1, 1, "A4:quarter@0 A4:quarter@1 G4:quarter@2 rest:quarter@3");
checkStaff("和音はまとめて長さが変わる", setEventDuration(sampleScore, lowerChord[0].id, half).score, 0, 2, "C3+E3+G3:half@0 rest:half@2");
checkThrows("長くしてはみ出す", () => setEventDuration(sampleScore, upper[3].id, half), "小節に収まりません");

const toRest = toggleRest(sampleScore, upper[1].id, C4);
checkStaff("音符を休符に", toRest.score, 0, 1, "C4:quarter@0 rest:quarter@1 G4:quarter@2 G4:quarter@3");
checkStaff("休符を音符に", toggleRest(toRest.score, toRest.noteIds[0], E4).score, 0, 1, "C4:quarter@0 E4:quarter@1 G4:quarter@2 G4:quarter@3");

checkStaff("音高を変える", setNotePitch(sampleScore, upper[0].id, E4).score, 0, 1, "E4:quarter@0 C4:quarter@1 G4:quarter@2 G4:quarter@3");
checkStaff("和音の中で重なったら 1 つにする", setNotePitch(sampleScore, lowerChord[0].id, { step: "E", octave: 3 }).score, 0, 2, "E3+G3:whole@0");
checkThrows("休符に音高は無い", () => setNotePitch(toRest.score, toRest.noteIds[0], C4), "休符には音高がありません");

const inserted = insertMeasure(sampleScore, 1);
check("小節を挟む", inserted.measures.length === 5 && describeStaff(inserted, 1, 1) === "rest:whole@0" && scoreProblems(inserted).length === 0);
check("末尾に足す", insertMeasure(sampleScore, 4).measures.length === 5);
check("小節を消す", removeMeasure(sampleScore, 0).measures[0].id === sampleScore.measures[1].id);
checkThrows("最後の 1 小節は消せない", () => removeMeasure(empty44, 0), "最後の 1 小節は消せません");

check("何も無い小節は grid に寄せる", snapOnset(empty44, 0, 1, 2.9, 1) === 3);
check("音符の途中は頭に寄せる", snapOnset(sampleScore, 1, 1, 2.6, 1) === 2);
check("既にある音の位置に寄せる", snapOnset(placeNotes(empty44, { measureIndex: 0, staff: 1, onset: 0 }, [C4], { type: "eighth", dots: 0 }).score, 0, 1, 0.6, 1) === 0.5);

check("元の楽譜は書き換えない", JSON.stringify(sampleScore.measures[0].notes.filter((n) => n.staff === 1).map((n) => n.pitch && pitchToName(n.pitch))) === '["C4","C4","G4","G4"]');
