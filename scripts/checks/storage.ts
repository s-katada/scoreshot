import { sampleScore } from "../../src/model/sample";
import type { Score } from "../../src/model/score";
import { scoreProblems, validateScore } from "../../src/model/validate";
import { parseScoreFile, serializeScore } from "../../src/storage/scoreFile";
import { check, checkThrows, section } from "./harness";

section("保存形式");

const text = serializeScore(sampleScore);
check("version を持つ", JSON.parse(text).version === 1);
check(
  "往復して同じ楽譜になる",
  JSON.stringify(parseScoreFile(text)) === JSON.stringify(sampleScore),
);
check("サンプルは約束事を満たす", scoreProblems(sampleScore).length === 0, scoreProblems(sampleScore).join(" / "));

checkThrows("JSON でない", () => parseScoreFile("{"), "JSON として読めない");
checkThrows("version が無い", () => parseScoreFile(JSON.stringify({ score: sampleScore })), "バージョン番号が無い");
checkThrows("未知の version", () => parseScoreFile(JSON.stringify({ version: 2, score: sampleScore })), "未知のバージョン (2)");
checkThrows("中身が無い", () => parseScoreFile(JSON.stringify({ version: 1 })), "楽譜の中身が壊れている");

/** サンプルを複製して一部を壊す */
function broken(edit: (score: Score) => void): string {
  const score = structuredClone(sampleScore);
  edit(score);
  return JSON.stringify({ version: 1, score });
}

checkThrows("小節の長さが合わない", () =>
  parseScoreFile(broken((s) => { s.measures[0].notes.splice(3, 1); })), "1 小節目の上段: 長さが小節と合わない");
checkThrows("音符の id が重複", () =>
  parseScoreFile(broken((s) => { s.measures[1].notes[0].id = s.measures[0].notes[0].id; })), "音符の id が重複");
checkThrows("先頭が和音の構成音", () =>
  parseScoreFile(broken((s) => { s.measures[0].notes[0].chord = true; })), "先頭の音が和音の構成音");
checkThrows("和音の長さが揃わない", () =>
  parseScoreFile(broken((s) => { s.measures[0].notes[5].type = "half"; })), "和音の構成音の長さが揃っていない");
checkThrows("音価でない", () =>
  parseScoreFile(broken((s) => { (s.measures[0].notes[0] as { type: string }).type = "long"; })), "音価ではない");
checkThrows("テンポが範囲外", () =>
  parseScoreFile(broken((s) => { s.tempo = 1000; })), "score.tempo");
checkThrows("拍子の分母が不正", () =>
  parseScoreFile(broken((s) => { s.time.beatType = 3; })), "拍子の分母");

const extra = validateScore({ ...structuredClone(sampleScore), extra: 1 });
check("知らないフィールドは捨てる", !("extra" in extra));
