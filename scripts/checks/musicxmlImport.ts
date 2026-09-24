import { readFileSync } from "node:fs";
import { join } from "node:path";
import { staffEvents, type StaffEvent } from "../../src/model/edit";
import { scoreToMusicXml } from "../../src/model/musicxml";
import { MusicXmlImportError, parseMusicXml } from "../../src/model/musicxmlImport";
import { readMusicXmlFile } from "../../src/model/musicxmlFile";
import { strToU8, zipSync } from "fflate";
import { blankScore } from "./scores";
import { sampleScore } from "../../src/model/sample";
import { pitchToName, type Score, type StaffNumber } from "../../src/model/score";
import { check, checkThrows, section } from "./harness";

section("MusicXML の読み込み");

function describeStaff(score: Score, measureIndex: number, staff: StaffNumber): string {
  return staffEvents(score.measures[measureIndex], staff)
    .map((e: StaffEvent) => {
      const names = e.notes.map((n) => (n.pitch ? pitchToName(n.pitch) : "rest")).join("+");
      const head = e.notes[0];
      return `${names}:${head.type}${head.dots ? ".".repeat(head.dots) : ""}@${e.onset}`;
    })
    .join(" ");
}

/** id を除いた楽譜の中身 */
function shape(score: Score): string {
  return JSON.stringify({
    ...score,
    measures: score.measures.map((_, i) =>
      [1, 2].map((staff) => describeStaff(score, i, staff as StaffNumber)),
    ),
  });
}

// 書き出したものを読み戻して同じ楽譜になるか
const roundTrip = parseMusicXml(scoreToMusicXml(sampleScore));
check("サンプルの往復", shape(roundTrip.score) === shape(sampleScore) && roundTrip.warnings.length === 0,
  roundTrip.warnings.join(" / "));

const custom = blankScore({ title: "臨時記号 & <記号>", tempo: 72, fifths: 3, time: { beats: 6, beatType: 8 }, measures: 2 });
const customXml = scoreToMusicXml({
  ...custom,
  measures: [
    // 6/8 に合う中身を直接組む
    {
      id: "a",
      notes: [
        { id: "a1", pitch: { step: "C", octave: 4, alter: 1 }, type: "quarter", dots: 1, staff: 1 },
        { id: "a2", pitch: { step: "E", octave: 4 }, type: "quarter", dots: 1, staff: 1, chord: true },
        { id: "a3", pitch: { step: "G", octave: 4, alter: -1 }, type: "eighth", staff: 1 },
        { id: "a4", pitch: null, type: "quarter", staff: 1 },
        { id: "a5", pitch: null, type: "half", dots: 1, staff: 2 },
      ],
    },
    custom.measures[1],
  ],
});
const customBack = parseMusicXml(customXml).score;
check("調号・拍子・テンポ・題名の往復", customBack.key.fifths === 3 && customBack.time.beats === 6 && customBack.time.beatType === 8 && customBack.tempo === 72 && customBack.title === "臨時記号 & <記号>",
  JSON.stringify({ key: customBack.key, time: customBack.time, tempo: customBack.tempo, title: customBack.title }));
check("付点・和音・臨時記号の往復", describeStaff(customBack, 0, 1) === "C#4+E4:quarter.@0 Gb4:eighth@1.5 rest:quarter@2", describeStaff(customBack, 0, 1));

// 他のソフトが書き出した形 (弱起・声部・タイなど) を読む
// pnpm check はリポジトリの直下で走る
const fixture = readFileSync(join(process.cwd(), "scripts/fixtures/musescore-like.musicxml"), "utf8");
const imported = parseMusicXml(fixture, "ファイル名");
const s = imported.score;
check("題名", s.title === "検証用のメヌエット");
check("調号・拍子・テンポ", s.key.fifths === -1 && s.time.beats === 3 && s.time.beatType === 4 && s.tempo === 90);
check("小節の数", s.measures.length === 3);
check("弱起は頭を休符で埋める", describeStaff(s, 0, 1) === "rest:half@0 C5:quarter@2", describeStaff(s, 0, 1));
check("装飾音は捨て、タイの音は別々に", describeStaff(s, 1, 1) === "F5:quarter@0 F5:eighth@1 E5:eighth@1.5 D5:quarter@2", describeStaff(s, 1, 1));
check("下段の和音 (声部 5)", describeStaff(s, 1, 2) === "F3+A3+C4:half.@0", describeStaff(s, 1, 2));
// 2 小節目の上段: 声部 1 = Bb4 B4 休符 / 声部 2 = G4 A4 F4 E4
// 1 拍目の G4 は Bb4 と同じ長さなので和音に、休符の所の E4 はそのまま置く
check("2 つ目の声部は重ねられる所だけ取り込む", describeStaff(s, 2, 1) === "G4+Bb4:quarter@0 B4:quarter@1 E4:quarter@2", describeStaff(s, 2, 1));
check("小節まるごとの休符", describeStaff(s, 2, 2) === "rest:half.@0", describeStaff(s, 2, 2));
const warned = (text: string) => imported.warnings.some((w) => w.includes(text));
check("注意: 弱起", warned("弱起"));
check("注意: タイ", warned("タイ"));
check("注意: 装飾音符", warned("装飾音符"));
check("注意: 声部を捨てた", warned("声部") && warned("2 小節目の上段"), imported.warnings.join(" / "));
check("注意: スラー・強弱記号", warned("スラー") && warned("強弱記号"));

// 読み込めないもの
const wrap = (body: string, parts = 1) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${
  Array.from({ length: parts }, (_, i) => `<score-part id="P${i + 1}"><part-name>x</part-name></score-part>`).join("")
}</part-list>${Array.from({ length: parts }, (_, i) => `<part id="P${i + 1}">${body}</part>`).join("")}</score-partwise>`;
const measure = (notes: string, attributes = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>") =>
  `<measure number="1">${attributes}${notes}</measure>`;
const quarterC = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>";

checkThrows("XML でない", () => parseMusicXml("<score-partwise"), "XML として読めません");
checkThrows("MusicXML でない", () => parseMusicXml("<html></html>"), "MusicXML の楽譜ではありません");
checkThrows("timewise", () => parseMusicXml("<score-timewise></score-timewise>"), "score-timewise");
checkThrows("複数パート", () => parseMusicXml(wrap(measure(quarterC), 2)), "楽器 (パート) が 2 つ");
checkThrows("3 段以上", () => parseMusicXml(wrap(measure(quarterC, "<attributes><divisions>1</divisions><staves>3</staves></attributes>"))), "3 段の楽譜");
checkThrows("連符", () => parseMusicXml(wrap(measure(
  "<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>"))), "連符");
checkThrows("途中で拍子が変わる", () => parseMusicXml(wrap(
  measure(quarterC.repeat(4)) + `<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${quarterC.repeat(3)}</measure>`)), "2 小節目: 途中で拍子が変わる");
checkThrows("小節より長い", () => parseMusicXml(wrap(measure(quarterC.repeat(5)))), "1 小節目: 拍子 (4/4) より長い");
checkThrows("ダブルシャープ", () => parseMusicXml(wrap(measure(
  "<note><pitch><step>C</step><alter>2</alter><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>"))), "ダブルシャープ");
check("MusicXmlImportError で投げる", (() => { try { parseMusicXml("<x/>"); } catch (e) { return e instanceof MusicXmlImportError; } return false; })());

const noTitle = parseMusicXml(wrap(measure(quarterC.repeat(4))), "ファイル名から");
check("題名が無ければファイル名", noTitle.score.title === "ファイル名から");
check("テンポが無ければ 120", noTitle.score.tempo === 120);
const oneStaffBass = parseMusicXml(wrap(measure(quarterC.repeat(4), "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>")));
check("1 段のヘ音記号の楽譜は下段へ", describeStaff(oneStaffBass.score, 0, 2).startsWith("C4:quarter@0") && describeStaff(oneStaffBass.score, 0, 1) === "rest:whole@0");
const noTime = parseMusicXml(wrap(`<measure number="1"><attributes><divisions>1</divisions></attributes>${quarterC.repeat(4)}</measure>`));
check("拍子が無ければ 4/4 として注意", noTime.score.time.beats === 4 && noTime.warnings.some((w) => w.includes("4/4")));

section("MusicXML のファイル");
{
  const xml = scoreToMusicXml(sampleScore);
  const plain = readMusicXmlFile("きらきら.musicxml", new TextEncoder().encode(xml));
  check("非圧縮", shape(plain.score) === shape(sampleScore));

  const container = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  const mxl = zipSync({ "META-INF/container.xml": strToU8(container), "score.xml": strToU8(xml), mimetype: strToU8("application/vnd.recordare.musicxml") });
  const compressed = readMusicXmlFile("きらきら.mxl", mxl);
  check("圧縮 (.mxl)", shape(compressed.score) === shape(sampleScore));
  const noContainer = readMusicXmlFile("x.mxl", zipSync({ "inner/song.musicxml": strToU8(xml) }));
  check("目録の無い .mxl", shape(noContainer.score) === shape(sampleScore));
  checkThrows("壊れた .mxl", () => readMusicXmlFile("x.mxl", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), ".mxl");

  // UTF-16 (BOM 付き) の MusicXML
  const utf16 = new Uint8Array(2 + xml.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let i = 0; i < xml.length; i++) {
    const code = xml.charCodeAt(i);
    utf16[2 + i * 2] = code & 0xff;
    utf16[3 + i * 2] = code >> 8;
  }
  check("UTF-16 の MusicXML", shape(readMusicXmlFile("u.musicxml", utf16).score) === shape(sampleScore));

  const untitled = scoreToMusicXml({ ...sampleScore, title: "" }).replace(/<work>[\s\S]*?<\/work>/, "");
  check("題名が無ければファイル名 (拡張子なし)", readMusicXmlFile("月の光.mxl.musicxml", strToU8(untitled)).score.title === "月の光.mxl");
}
