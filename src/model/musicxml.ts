/**
 * データモデルを MusicXML に書き出す。
 *
 * MusicXML を全レイヤ共通の交換形式にしているので、ここが描画 (OSMD) と
 * 外部への書き出しの両方の入口になる。
 */

import { measureAccidentals, type AccidentalMark } from "./accidentals";
import { tiePairs } from "./ties";
import {
  DIVISIONS,
  noteDuration,
  staffQuarterLength,
  type Measure,
  type Note,
  type Score,
  type StaffNumber,
} from "./score";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

/** タイの始まりの音と終わりの音の id */
interface Ties {
  starts: Set<string>;
  stops: Set<string>;
}

function noteToXml(
  note: Note,
  level: number,
  accidental: AccidentalMark | undefined,
  ties: Ties,
): string {
  const pad = indent(level);
  const inner = indent(level + 1);
  const lines: string[] = [`${pad}<note>`];

  // MusicXML は要素の順序が決まっている:
  // chord -> pitch/rest -> duration -> tie -> voice -> type -> dot -> accidental
  // -> staff -> notations
  if (note.chord) {
    lines.push(`${inner}<chord/>`);
  }

  if (note.pitch === null) {
    lines.push(`${inner}<rest/>`);
  } else {
    const { step, octave, alter } = note.pitch;
    lines.push(`${inner}<pitch>`);
    lines.push(`${indent(level + 2)}<step>${step}</step>`);
    if (alter) {
      lines.push(`${indent(level + 2)}<alter>${alter}</alter>`);
    }
    lines.push(`${indent(level + 2)}<octave>${octave}</octave>`);
    lines.push(`${inner}</pitch>`);
  }

  lines.push(`${inner}<duration>${noteDuration(note)}</duration>`);
  // <tie> は鳴り方、<notations><tied> は描く弧。両方書く
  const tieTypes = [
    ...(ties.stops.has(note.id) ? ["stop"] : []),
    ...(ties.starts.has(note.id) ? ["start"] : []),
  ];
  for (const type of tieTypes) {
    lines.push(`${inner}<tie type="${type}"/>`);
  }
  // 段ごとに声部を分ける。大譜表の標準的な割り当て
  lines.push(`${inner}<voice>${note.staff}</voice>`);
  lines.push(`${inner}<type>${note.type}</type>`);
  for (let i = 0; i < (note.dots ?? 0); i++) {
    lines.push(`${inner}<dot/>`);
  }
  // 鳴る高さは <alter> が決め、<accidental> は楽譜に書く記号だけを表す。
  // 調号と小節内の直前の記号から導いたものを書く (accidentals.ts)
  if (accidental !== undefined) {
    lines.push(`${inner}<accidental>${accidental}</accidental>`);
  }
  lines.push(`${inner}<staff>${note.staff}</staff>`);
  if (tieTypes.length > 0) {
    lines.push(`${inner}<notations>`);
    for (const type of tieTypes) {
      lines.push(`${indent(level + 2)}<tied type="${type}"/>`);
    }
    lines.push(`${inner}</notations>`);
  }
  lines.push(`${pad}</note>`);
  return lines.join("\n");
}

function staffNotesToXml(
  measure: Measure,
  staff: StaffNumber,
  level: number,
  accidentals: Map<string, AccidentalMark>,
  ties: Ties,
): string[] {
  return measure.notes
    .filter((n) => n.staff === staff)
    .map((n) => noteToXml(n, level, accidentals.get(n.id), ties));
}

function measureToXml(
  measure: Measure,
  index: number,
  score: Score,
  level: number,
  ties: Ties,
): string {
  const pad = indent(level);
  const inner = indent(level + 1);
  const lines: string[] = [`${pad}<measure number="${index + 1}">`];
  // 改段 (#18)。小節の中身より前に書く
  if (measure.newSystem && index > 0) {
    lines.push(`${inner}<print new-system="yes"/>`);
  }

  // 調号・拍子・段数・音部記号は最初の小節でのみ宣言する
  if (index === 0) {
    lines.push(`${inner}<attributes>`);
    lines.push(`${indent(level + 2)}<divisions>${DIVISIONS}</divisions>`);
    lines.push(`${indent(level + 2)}<key>`);
    lines.push(`${indent(level + 3)}<fifths>${score.key.fifths}</fifths>`);
    lines.push(`${indent(level + 2)}</key>`);
    lines.push(`${indent(level + 2)}<time>`);
    lines.push(`${indent(level + 3)}<beats>${score.time.beats}</beats>`);
    lines.push(
      `${indent(level + 3)}<beat-type>${score.time.beatType}</beat-type>`,
    );
    lines.push(`${indent(level + 2)}</time>`);
    lines.push(`${indent(level + 2)}<staves>2</staves>`);
    lines.push(`${indent(level + 2)}<clef number="1">`);
    lines.push(`${indent(level + 3)}<sign>G</sign>`);
    lines.push(`${indent(level + 3)}<line>2</line>`);
    lines.push(`${indent(level + 2)}</clef>`);
    lines.push(`${indent(level + 2)}<clef number="2">`);
    lines.push(`${indent(level + 3)}<sign>F</sign>`);
    lines.push(`${indent(level + 3)}<line>4</line>`);
    lines.push(`${indent(level + 2)}</clef>`);
    lines.push(`${inner}</attributes>`);

    lines.push(`${inner}<direction placement="above">`);
    lines.push(`${indent(level + 2)}<direction-type>`);
    lines.push(`${indent(level + 3)}<metronome>`);
    lines.push(`${indent(level + 4)}<beat-unit>quarter</beat-unit>`);
    lines.push(`${indent(level + 4)}<per-minute>${score.tempo}</per-minute>`);
    lines.push(`${indent(level + 3)}</metronome>`);
    lines.push(`${indent(level + 2)}</direction-type>`);
    lines.push(`${indent(level + 2)}<sound tempo="${score.tempo}"/>`);
    lines.push(`${inner}</direction>`);
  }

  const accidentals = measureAccidentals(measure, score.key.fifths);

  // 上段 -> backup -> 下段。MusicXML では小節内の時間が一方向にしか
  // 進まないので、段を移るには backup で巻き戻す必要がある。
  lines.push(...staffNotesToXml(measure, 1, level + 1, accidentals, ties));

  const upperLength = staffQuarterLength(measure, 1);
  const hasLower = measure.notes.some((n) => n.staff === 2);
  if (upperLength > 0 && hasLower) {
    const backup = Math.round(upperLength * DIVISIONS);
    lines.push(`${inner}<backup>`);
    lines.push(`${indent(level + 2)}<duration>${backup}</duration>`);
    lines.push(`${inner}</backup>`);
  }

  lines.push(...staffNotesToXml(measure, 2, level + 1, accidentals, ties));
  lines.push(`${pad}</measure>`);
  return lines.join("\n");
}

/** Score を MusicXML 4.0 (partwise) の文字列にする */
export function scoreToMusicXml(score: Score): string {
  const pairs = tiePairs(score);
  const ties: Ties = {
    starts: new Set(pairs.keys()),
    stops: new Set([...pairs.values()].map((n) => n.id)),
  };
  const measures = score.measures
    .map((m, i) => measureToXml(m, i, score, 2, ties))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${escapeXml(score.title)}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
        <instrument-sound>keyboard.piano</instrument-sound>
      </score-instrument>
      <midi-instrument id="P1-I1">
        <midi-channel>1</midi-channel>
        <midi-program>1</midi-program>
      </midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${measures}
  </part>
</score-partwise>
`;
}
