/**
 * 外から来たデータ (保存ファイルなど) を Score として検査する。
 *
 * 型だけでなく、描画・再生・編集が前提にしている約束事も確かめる:
 *
 * - 各段が小節をちょうど埋めている (足りない所も休符で埋まっている)
 * - 和音の構成音は直前の音と同じ長さで、休符を含まない
 * - id が楽譜全体で重複しない
 *
 * 壊れた楽譜を黙って読み込むより、読み込めないと言う方が後で困らない。
 */

import {
  NOTE_TYPES,
  STEPS,
  measureQuarterLength,
  staffQuarterLength,
  type Alter,
  type Measure,
  type Note,
  type NoteType,
  type Pitch,
  type Score,
  type StaffNumber,
  type Step,
} from "./score";

export class ScoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreValidationError";
  }
}

/** 受け付けるテンポの範囲 (四分音符あたりの BPM) */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 400;

/** 拍子の分母として受け付ける値 */
export const BEAT_TYPES = [1, 2, 4, 8, 16, 32] as const;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new ScoreValidationError(`${path}: ${message}`);
}

function readString(obj: Json, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    fail(`${path}.${key}`, "文字列ではない");
  }
  return value;
}

function readInteger(
  obj: Json,
  key: string,
  path: string,
  min: number,
  max: number,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${path}.${key}`, "整数ではない");
  }
  if (value < min || value > max) {
    fail(`${path}.${key}`, `${min}〜${max} の範囲外 (${value})`);
  }
  return value;
}

function readPitch(value: unknown, path: string): Pitch | null {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    fail(path, "音高でも null でもない");
  }
  const step = value.step;
  if (typeof step !== "string" || !STEPS.includes(step as Step)) {
    fail(`${path}.step`, `幹音名ではない (${String(step)})`);
  }
  const octave = readInteger(value, "octave", path, 0, 9);
  const pitch: Pitch = { step: step as Step, octave };
  if (value.alter !== undefined) {
    const alter = value.alter;
    if (alter !== -1 && alter !== 0 && alter !== 1) {
      fail(`${path}.alter`, `-1 / 0 / 1 のいずれでもない (${String(alter)})`);
    }
    if (alter !== 0) {
      pitch.alter = alter as Alter;
    }
  }
  return pitch;
}

function readNote(value: unknown, path: string): Note {
  if (!isObject(value)) {
    fail(path, "音符ではない");
  }
  const id = readString(value, "id", path);
  const pitch = readPitch(value.pitch, `${path}.pitch`);
  const type = value.type;
  if (typeof type !== "string" || !NOTE_TYPES.includes(type as NoteType)) {
    fail(`${path}.type`, `音価ではない (${String(type)})`);
  }
  const staff = value.staff;
  if (staff !== 1 && staff !== 2) {
    fail(`${path}.staff`, `1 か 2 ではない (${String(staff)})`);
  }

  const note: Note = { id, pitch, type: type as NoteType, staff };
  if (value.dots !== undefined) {
    const dots = readInteger(value, "dots", path, 0, 2);
    if (dots > 0) {
      note.dots = dots;
    }
  }
  if (value.chord !== undefined) {
    if (typeof value.chord !== "boolean") {
      fail(`${path}.chord`, "真偽値ではない");
    }
    if (value.chord) {
      note.chord = true;
    }
  }
  return note;
}

function readMeasure(value: unknown, path: string): Measure {
  if (!isObject(value)) {
    fail(path, "小節ではない");
  }
  const id = readString(value, "id", path);
  const notes = value.notes;
  if (!Array.isArray(notes)) {
    fail(`${path}.notes`, "配列ではない");
  }
  return {
    id,
    notes: notes.map((n, i) => readNote(n, `${path}.notes[${i}]`)),
  };
}

/**
 * 型は合っている楽譜について、約束事が守られているかを調べる。
 * 問題があれば人が読める説明を返す。空配列なら問題なし。
 */
export function scoreProblems(score: Score): string[] {
  const problems: string[] = [];

  if (score.measures.length === 0) {
    problems.push("小節が 1 つも無い");
  }

  const ids = new Set<string>();
  const measureIds = new Set<string>();
  const length = measureQuarterLength(score.time);

  score.measures.forEach((measure, index) => {
    const label = `${index + 1} 小節目`;
    if (measureIds.has(measure.id)) {
      problems.push(`${label}: 小節の id が重複している (${measure.id})`);
    }
    measureIds.add(measure.id);

    for (const note of measure.notes) {
      if (ids.has(note.id)) {
        problems.push(`${label}: 音符の id が重複している (${note.id})`);
      }
      ids.add(note.id);
    }

    for (const staff of [1, 2] as StaffNumber[]) {
      const staffLabel = `${label}の${staff === 1 ? "上段" : "下段"}`;
      const notes = measure.notes.filter((n) => n.staff === staff);

      notes.forEach((note, i) => {
        if (!note.chord) {
          return;
        }
        const head = notes[i - 1];
        if (head === undefined) {
          problems.push(`${staffLabel}: 先頭の音が和音の構成音になっている`);
          return;
        }
        if (note.pitch === null || head.pitch === null) {
          problems.push(`${staffLabel}: 休符が和音に含まれている`);
        }
        if (note.type !== head.type || (note.dots ?? 0) !== (head.dots ?? 0)) {
          problems.push(`${staffLabel}: 和音の構成音の長さが揃っていない`);
        }
      });

      const filled = staffQuarterLength(measure, staff);
      if (filled !== length) {
        problems.push(
          `${staffLabel}: 長さが小節と合わない (${filled} / ${length} 拍)`,
        );
      }
    }
  });

  return problems;
}

/**
 * 任意の値を検査して Score を組み立て直す。
 *
 * 知らないフィールドは捨てる。検査に通らなければ ScoreValidationError を投げる。
 */
export function validateScore(value: unknown): Score {
  if (!isObject(value)) {
    fail("score", "オブジェクトではない");
  }
  const title = readString(value, "title", "score");
  const tempo = value.tempo;
  if (typeof tempo !== "number" || !Number.isFinite(tempo)) {
    fail("score.tempo", "数値ではない");
  }
  if (tempo < TEMPO_MIN || tempo > TEMPO_MAX) {
    fail("score.tempo", `${TEMPO_MIN}〜${TEMPO_MAX} の範囲外 (${tempo})`);
  }

  const key = value.key;
  if (!isObject(key)) {
    fail("score.key", "オブジェクトではない");
  }
  const fifths = readInteger(key, "fifths", "score.key", -7, 7);

  const time = value.time;
  if (!isObject(time)) {
    fail("score.time", "オブジェクトではない");
  }
  const beats = readInteger(time, "beats", "score.time", 1, 32);
  const beatType = readInteger(time, "beatType", "score.time", 1, 32);
  if (!(BEAT_TYPES as readonly number[]).includes(beatType)) {
    fail("score.time.beatType", `拍子の分母として使えない (${beatType})`);
  }

  const measures = value.measures;
  if (!Array.isArray(measures)) {
    fail("score.measures", "配列ではない");
  }

  const score: Score = {
    title,
    tempo,
    key: { fifths },
    time: { beats, beatType },
    measures: measures.map((m, i) => readMeasure(m, `score.measures[${i}]`)),
  };

  const problems = scoreProblems(score);
  if (problems.length > 0) {
    throw new ScoreValidationError(problems.join("\n"));
  }
  return score;
}
