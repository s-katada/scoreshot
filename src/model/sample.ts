/**
 * 動作確認用のサンプル楽譜。
 *
 * ハ長調 4/4 の「きらきら星」冒頭 4 小節。右手が旋律、左手が全音符の和音で、
 * 大譜表・和音・複数の音価がひととおり登場する。
 */

import type {
  Alter,
  Measure,
  Note,
  NoteType,
  Pitch,
  Score,
  StaffNumber,
  Step,
} from "./score";

/** "C4" / "F#4" / "Bb3" のような文字列を Pitch にする */
function parsePitch(name: string): Pitch {
  const matched = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!matched) {
    throw new Error(`音名として解釈できない: ${name}`);
  }
  const [, step, accidental, octave] = matched;
  const alter: Alter = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return {
    step: step as Step,
    octave: Number(octave),
    ...(alter === 0 ? {} : { alter }),
  };
}

/** 小節ごとに連番を振るので、再読み込みしても id が変わらない */
function makeIdFactory(measureIndex: number) {
  let seq = 0;
  return () => `m${measureIndex + 1}-n${++seq}`;
}

interface Builder {
  /** 単音または休符。name に null を渡すと休符 */
  note(name: string | null, type: NoteType, staff: StaffNumber): void;
  /** 和音。2 つ目以降に chord フラグを立てる */
  chord(names: string[], type: NoteType, staff: StaffNumber): void;
}

function buildMeasure(
  index: number,
  build: (b: Builder) => void,
): Measure {
  const nextId = makeIdFactory(index);
  const notes: Note[] = [];

  build({
    note(name, type, staff) {
      notes.push({
        id: nextId(),
        pitch: name === null ? null : parsePitch(name),
        type,
        staff,
      });
    },
    chord(names, type, staff) {
      names.forEach((name, i) => {
        notes.push({
          id: nextId(),
          pitch: parsePitch(name),
          type,
          staff,
          ...(i === 0 ? {} : { chord: true }),
        });
      });
    },
  });

  return { id: `m${index + 1}`, notes };
}

export const sampleScore: Score = {
  title: "きらきら星",
  tempo: 100,
  key: { fifths: 0 },
  time: { beats: 4, beatType: 4 },
  measures: [
    buildMeasure(0, (b) => {
      b.note("C4", "quarter", 1);
      b.note("C4", "quarter", 1);
      b.note("G4", "quarter", 1);
      b.note("G4", "quarter", 1);
      b.chord(["C3", "E3", "G3"], "whole", 2);
    }),
    buildMeasure(1, (b) => {
      b.note("A4", "quarter", 1);
      b.note("A4", "quarter", 1);
      b.note("G4", "half", 1);
      b.chord(["C3", "F3", "A3"], "whole", 2);
    }),
    buildMeasure(2, (b) => {
      b.note("F4", "quarter", 1);
      b.note("F4", "quarter", 1);
      b.note("E4", "quarter", 1);
      b.note("E4", "quarter", 1);
      b.chord(["C3", "F3", "A3"], "whole", 2);
    }),
    buildMeasure(3, (b) => {
      b.note("D4", "quarter", 1);
      b.note("D4", "quarter", 1);
      b.note("C4", "half", 1);
      b.chord(["C3", "E3", "G3"], "whole", 2);
    }),
  ],
};
