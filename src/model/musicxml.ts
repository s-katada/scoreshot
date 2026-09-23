/**
 * データモデルを MusicXML に書き出す。
 *
 * MusicXML を全レイヤ共通の交換形式にしているので、ここが描画 (OSMD) と
 * 外部への書き出しの両方の入口になる。
 */

import { measureAccidentals, type AccidentalMark } from "./accidentals";
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

function noteToXml(
  note: Note,
  level: number,
  accidental: AccidentalMark | undefined,
): string {
  const pad = indent(level);
  const inner = indent(level + 1);
  const lines: string[] = [`${pad}<note>`];

  // MusicXML は要素の順序が決まっている:
  // chord -> pitch/rest -> duration -> voice -> type -> dot -> accidental -> staff
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
  lines.push(`${pad}</note>`);
  return lines.join("\n");
}

function staffNotesToXml(
  measure: Measure,
  staff: StaffNumber,
  level: number,
  accidentals: Map<string, AccidentalMark>,
): string[] {
  return measure.notes
    .filter((n) => n.staff === staff)
    .map((n) => noteToXml(n, level, accidentals.get(n.id)));
}

function measureToXml(
  measure: Measure,
  index: number,
  score: Score,
  level: number,
): string {
  const pad = indent(level);
  const inner = indent(level + 1);
  const lines: string[] = [`${pad}<measure number="${index + 1}">`];

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
  lines.push(...staffNotesToXml(measure, 1, level + 1, accidentals));

  const upperLength = staffQuarterLength(measure, 1);
  const hasLower = measure.notes.some((n) => n.staff === 2);
  if (upperLength > 0 && hasLower) {
    const backup = Math.round(upperLength * DIVISIONS);
    lines.push(`${inner}<backup>`);
    lines.push(`${indent(level + 2)}<duration>${backup}</duration>`);
    lines.push(`${inner}</backup>`);
  }

  lines.push(...staffNotesToXml(measure, 2, level + 1, accidentals));
  lines.push(`${pad}</measure>`);
  return lines.join("\n");
}

/** Score を MusicXML 4.0 (partwise) の文字列にする */
export function scoreToMusicXml(score: Score): string {
  const measures = score.measures
    .map((m, i) => measureToXml(m, i, score, 2))
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
