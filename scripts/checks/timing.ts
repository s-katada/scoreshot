import { sampleScore } from "../../src/model/sample";
import { scoreToMusicXml } from "../../src/model/musicxml";
import { staffQuarterLength } from "../../src/model/score";
import { notesFrom, scoreToTimedNotes, scoreQuarterLength } from "../../src/audio/player";
import { check, section } from "./harness";

section("楽譜モデルと再生時刻");

// 各小節が上下段とも 4 拍ぶん埋まっているか
for (const [i, m] of sampleScore.measures.entries()) {
  const up = staffQuarterLength(m, 1);
  const lo = staffQuarterLength(m, 2);
  check(`小節${i + 1} の拍数`, up === 4 && lo === 4, `上段 ${up} / 下段 ${lo}`);
}

const notes = scoreToTimedNotes(sampleScore);
check("曲の長さ", scoreQuarterLength(sampleScore) === 16, `${scoreQuarterLength(sampleScore)} 拍`);
check("鳴る音の数", notes.length === 26, `${notes.length} 個`);

// 1 小節目: 右手 C4 C4 G4 G4 が 0,1,2,3 拍、左手の和音 3 音が全部 0 拍
const m1 = notes.filter((n) => n.at < 4);
check("1小節目の右手の位置", JSON.stringify(m1.filter(n => n.name.endsWith("4")).map(n => [n.name, n.at])) === '[["C4",0],["C4",1],["G4",2],["G4",3]]',
  JSON.stringify(m1.filter(n => n.name.endsWith("4")).map(n => [n.name, n.at])));
const chord = m1.filter((n) => n.name.endsWith("3"));
check("1小節目の和音は同時刻", chord.length === 3 && chord.every((n) => n.at === 0 && n.length === 4),
  chord.map((n) => `${n.name}@${n.at}`).join(" "));

// 2 小節目の G4 は半音符 (2拍) で 6 拍目から
const g4 = notes.find((n) => n.name === "G4" && n.at === 6);
check("2小節目の半音符", g4?.length === 2, `length=${g4?.length}`);

// MusicXML の backup が上段の長さと一致しているか
const xml = scoreToMusicXml(sampleScore);
const backups = [...xml.matchAll(/<backup>\s*<duration>(\d+)<\/duration>/g)].map((m) => Number(m[1]));
check("backup の数と値", backups.length === 4 && backups.every((d) => d === 1920), backups.join(","));
check("staves 宣言", xml.includes("<staves>2</staves>"));
check("和音の chord 要素", (xml.match(/<chord\/>/g) ?? []).length === 8, `${(xml.match(/<chord\/>/g) ?? []).length} 個`);

// 途中からの再生 (#12)
{
  const from5 = notesFrom(sampleScore, 5);
  // 2 小節目の 2 拍目 (曲頭から 5 拍) からは A4 が 0 拍目、G4 が 1 拍目。
  // 4 拍目から鳴り続けている和音 (C3 F3 A3) は含めない
  check("途中から: 最初の音", JSON.stringify(from5.slice(0, 2).map((n) => [n.name, n.at])) === '[["A4",0],["G4",1]]',
    JSON.stringify(from5.slice(0, 2).map((n) => [n.name, n.at])));
  check("途中から: またぐ音は鳴らさない", !from5.some((n) => n.at < 0) && !from5.some((n) => n.name === "F3" && n.at === -1));
  check("途中から: 3 小節目の和音は 3 拍後", from5.filter((n) => n.at === 3).length === 4, from5.filter((n) => n.at === 3).map((n) => n.name).join(" "));
  check("頭からは全部", notesFrom(sampleScore, 0).length === 26);
}
