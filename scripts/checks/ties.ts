/**
 * タイ (#16)。つなぐ相手の求め方、付け外しの編集、再生、MusicXML、保存形式。
 */

import { notesFrom, scoreToTimedNotes } from "../../src/audio/player";
import { placeNotes, setEventDuration, setNotePitch, toggleTie } from "../../src/model/edit";
import { scoreToMusicXml } from "../../src/model/musicxml";
import { tiePairs } from "../../src/model/ties";
import { validateScore } from "../../src/model/validate";
import { check, checkThrows, section } from "./harness";
import { tiedScore } from "./scores";

section("タイ");

const score = tiedScore();
const [first, second] = score.measures;
const c4Start = first.notes.find((n) => n.pitch?.step === "C")!;
const c4End = second.notes.find((n) => n.pitch?.step === "C")!;

{
  const pairs = tiePairs(score);
  check(
    "小節線をまたいで、次に鳴る同じ高さの音へつながる",
    pairs.size === 1 && pairs.get(c4Start.id)?.id === c4End.id,
    JSON.stringify([...pairs].map(([k, v]) => [k, v.id])),
  );
  const again = toggleTie(score, c4Start.id).score;
  check("もう一度付け外すと外れる", tiePairs(again).size === 0 && again.measures[0].notes.every((n) => !n.tie));
  check("元の楽譜は変えない", c4Start.tie === true);
}

{
  // 休符 (1 小節目の頭) と、次に同じ高さの音が無い音 (2 小節目の C4) はつなげない
  const rest = first.notes.find((n) => n.pitch === null && n.staff === 1)!;
  checkThrows("休符はつなげない", () => toggleTie(score, rest.id), "休符");
  checkThrows("次に同じ高さの音が無ければつなげない", () => toggleTie(score, c4End.id), "同じ高さ");
}

{
  // 先の音の高さを変えると、印は残ってもつながらない (相手が無い印は無視する)
  const moved = setNotePitch(score, c4End.id, { step: "D", octave: 4 }).score;
  check("相手の高さが変わるとつながらない", tiePairs(moved).size === 0);
  const back = setNotePitch(moved, c4End.id, { step: "C", octave: 4 }).score;
  check("高さを戻すとまたつながる", tiePairs(back).size === 1);
  const longer = setEventDuration(score, c4Start.id, { type: "half", dots: 0 }).score;
  check("長さを変えても印は残る", tiePairs(longer).size === 1);
  const placed = placeNotes(score, { measureIndex: 0, staff: 1, onset: 0 }, [{ step: "G", octave: 4 }], {
    type: "quarter",
    dots: 0,
  }).score;
  check("同じ段のほかの所を編集しても印は残る", tiePairs(placed).size === 1);
}

{
  const timed = scoreToTimedNotes(score).map((n) => `${n.name}@${n.at}+${n.length}`);
  check(
    "つながった音は弾き直さず、1 つの長い音として鳴る",
    JSON.stringify(timed) === JSON.stringify(["C4@2+3", "E4@2+2", "E4@4+1"]),
    JSON.stringify(timed),
  );
  const from = notesFrom(score, 4).map((n) => `${n.name}@${n.at}`);
  check("つながった先から再生すると、そこから弾き始めた音だけが鳴る", JSON.stringify(from) === JSON.stringify(["E4@0"]), JSON.stringify(from));
}

{
  const xml = scoreToMusicXml(score);
  const count = (pattern: RegExp) => (xml.match(pattern) ?? []).length;
  check(
    "MusicXML に <tie> と <tied> を始まりと終わりで書く",
    count(/<tie type="start"\/>/g) === 1 &&
      count(/<tie type="stop"\/>/g) === 1 &&
      count(/<tied type="start"\/>/g) === 1 &&
      count(/<tied type="stop"\/>/g) === 1,
  );
  // 要素の順序: duration の直後に tie、staff の後に notations
  check(
    "MusicXML の要素の順序を守る",
    /<\/duration>\s*<tie type="start"\/>\s*<voice>/.test(xml) && /<staff>1<\/staff>\s*<notations>\s*<tied type="start"\/>/.test(xml),
  );
}

{
  const loaded = validateScore(JSON.parse(JSON.stringify(score)));
  check("保存した楽譜からタイを読み込める", tiePairs(loaded).size === 1);
  checkThrows(
    "タイが真偽値でなければ読み込まない",
    () => {
      const broken = JSON.parse(JSON.stringify(score));
      broken.measures[0].notes.find((n: { id: string }) => n.id === c4Start.id).tie = "yes";
      validateScore(broken);
    },
    "tie",
  );
}
