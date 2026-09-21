import { sampleScore } from "../src/model/sample";
import { scoreToMusicXml } from "../src/model/musicxml";
import { staffQuarterLength } from "../src/model/score";
import { scoreToTimedNotes, scoreQuarterLength } from "../src/audio/player";

let ng = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) ng++;
  console.log(`${ok ? "OK  " : "NG  "} ${label}${detail ? "  " + detail : ""}`);
};

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

console.log(ng === 0 ? "\n全項目 OK" : `\n${ng} 件 NG`);
