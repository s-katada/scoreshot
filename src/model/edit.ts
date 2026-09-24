/**
 * 楽譜の編集操作。
 *
 * どれも Score を受け取って新しい Score を返す純関数で、元の Score は
 * 書き換えない。Undo/Redo は編集前後のスナップショットを持つだけで済む。
 *
 * 「各段は常に小節をちょうど埋めている」という約束 (validate.ts) を保つ。
 * 音符を置く・消す・長さを変えるときは、空いた所を休符で埋め、はみ出す所は
 * 上書きする (MuseScore の入力と同じ考え方)。小節からはみ出す操作は
 * エラーにする (小節線をまたぐ音は、分けて置いてタイでつなぐ)。
 */

import { createId } from "./id";
import { comparePitch, samePitch } from "./pitch";
import { tieTarget } from "./ties";
import {
  QUARTER_LENGTH,
  measureQuarterLength,
  noteQuarterLength,
  type Measure,
  type Note,
  type NoteType,
  type Pitch,
  type Score,
  type StaffNumber,
} from "./score";

/** 編集できなかった理由。メッセージはそのまま画面に出す */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

export interface Duration {
  type: NoteType;
  /** 付点の数 */
  dots: number;
}

/** 段の中の位置 */
export interface StaffPosition {
  measureIndex: number;
  staff: StaffNumber;
  /** 小節頭からの位置。四分音符を 1 とする */
  onset: number;
}

/**
 * 段の中で同時に鳴り始める音のまとまり。単音・和音・休符のいずれか。
 * 休符なら notes は 1 つだけで、その pitch が null。
 */
export interface StaffEvent {
  onset: number;
  length: number;
  notes: Note[];
}

const EPSILON = 1e-9;

export function durationLength(duration: Duration): number {
  return noteQuarterLength({
    id: "",
    pitch: null,
    type: duration.type,
    dots: duration.dots,
    staff: 1,
  });
}

export function noteDurationOf(note: Note): Duration {
  return { type: note.type, dots: note.dots ?? 0 };
}

/** 1 つの音価 (付点 1 つまで) で表せる長さなら、その音価を返す */
export function durationFromLength(length: number): Duration | null {
  for (const dots of [0, 1]) {
    for (const type of Object.keys(QUARTER_LENGTH) as NoteType[]) {
      const duration = { type, dots };
      if (Math.abs(durationLength(duration) - length) < EPSILON) {
        return duration;
      }
    }
  }
  return null;
}

export function isRestEvent(event: StaffEvent): boolean {
  return event.notes[0].pitch === null;
}

/** 小節の 1 段を、鳴り始めの位置ごとのまとまりに分ける */
export function staffEvents(measure: Measure, staff: StaffNumber): StaffEvent[] {
  const events: StaffEvent[] = [];
  let cursor = 0;
  for (const note of measure.notes) {
    if (note.staff !== staff) {
      continue;
    }
    const last = events[events.length - 1];
    if (note.chord && last !== undefined) {
      last.notes.push(note);
      continue;
    }
    const length = noteQuarterLength(note);
    events.push({ onset: cursor, length, notes: [note] });
    cursor += length;
  }
  return events;
}

function makeNote(
  id: string,
  pitch: Pitch | null,
  duration: Duration,
  staff: StaffNumber,
  chord: boolean,
): Note {
  const note: Note = { id, pitch, type: duration.type, staff };
  if (duration.dots > 0) {
    note.dots = duration.dots;
  }
  if (chord) {
    note.chord = true;
  }
  return note;
}

function isMultiple(position: number, unit: number): boolean {
  const ratio = position / unit;
  return Math.abs(ratio - Math.round(ratio)) < EPSILON;
}

/** 休符を詰めるときに試す音価。長い順 */
const REST_DURATIONS: Duration[] = (
  ["whole", "half", "quarter", "eighth", "16th", "32nd"] as NoteType[]
).map((type) => ({ type, dots: 0 }));

/** 複合拍子で先に試す音価 (付点 2 分・付点 4 分 = 2 拍・1 拍) */
const COMPOUND_REST_DURATIONS: Duration[] = [
  { type: "half", dots: 1 },
  { type: "quarter", dots: 1 },
];

/** 6/8 や 9/8 のような複合拍子か (1 拍が付点四分音符になる) */
function isCompound(time: Score["time"]): boolean {
  return time.beatType === 8 && time.beats % 3 === 0 && time.beats >= 6;
}

/**
 * start から end までを埋める休符を並べる。
 *
 * 長い休符から順に、その長さの倍数の位置 (拍の頭) に置けるものを選ぶ。
 * 4/4 で 2 拍目から空いていれば「4 分休符 + 2 分休符」になる。
 * 段がまるごと空なら、1 つの音価で表せる限り 1 つの休符にする
 * (3/4 なら付点 2 分休符)。
 */
export function restsBetween(
  start: number,
  end: number,
  time: Score["time"],
): Array<{ onset: number; duration: Duration }> {
  const measureLength = measureQuarterLength(time);
  if (start < EPSILON && Math.abs(end - measureLength) < EPSILON) {
    const whole = durationFromLength(measureLength);
    if (whole !== null) {
      return [{ onset: 0, duration: whole }];
    }
  }

  // 複合拍子では付点四分音符が 1 拍なので、それを優先して選ぶ
  const candidates = isCompound(time)
    ? [...COMPOUND_REST_DURATIONS, ...REST_DURATIONS]
    : REST_DURATIONS;

  const rests: Array<{ onset: number; duration: Duration }> = [];
  let position = start;
  while (end - position > EPSILON) {
    const fits = (d: Duration) => position + durationLength(d) <= end + EPSILON;
    const chosen =
      candidates.find((d) => fits(d) && isMultiple(position, durationLength(d))) ??
      // 拍の頭に揃わない位置からは、収まる最長のものを置く
      candidates.find(fits);
    if (chosen === undefined) {
      // 32 分休符より細かい隙間。今の音価の範囲では起こらない
      break;
    }
    rests.push({ onset: position, duration: chosen });
    position += durationLength(chosen);
  }
  return rests;
}

/**
 * 音の鳴るまとまり (休符以外) を並べ、隙間を休符で埋めた段を作る。
 * 休符は毎回作り直す (隣り合う休符をまとめ直すため)。
 */
function fillStaff(
  sounding: StaffEvent[],
  staff: StaffNumber,
  time: Score["time"],
): StaffEvent[] {
  const measureLength = measureQuarterLength(time);
  const sorted = [...sounding].sort((a, b) => a.onset - b.onset);
  const events: StaffEvent[] = [];
  const pushRests = (from: number, to: number) => {
    for (const rest of restsBetween(from, to, time)) {
      events.push({
        onset: rest.onset,
        length: durationLength(rest.duration),
        notes: [makeNote(createId(), null, rest.duration, staff, false)],
      });
    }
  };

  let cursor = 0;
  for (const event of sorted) {
    if (event.onset > cursor + EPSILON) {
      pushRests(cursor, event.onset);
    }
    events.push(event);
    cursor = event.onset + event.length;
  }
  if (measureLength - cursor > EPSILON) {
    pushRests(cursor, measureLength);
  }
  return events;
}

/** まとまりの並びを小節の notes に戻す。和音の構成音には chord を立てる */
function flatten(events: StaffEvent[]): Note[] {
  return events.flatMap((event) =>
    event.notes.map((note, i) =>
      makeNote(note.id, note.pitch, noteDurationOf(note), note.staff, i > 0),
    ),
  );
}

function withStaff(
  measure: Measure,
  staff: StaffNumber,
  events: StaffEvent[],
): Measure {
  const upper = staff === 1 ? flatten(events) : measure.notes.filter((n) => n.staff === 1);
  const lower = staff === 2 ? flatten(events) : measure.notes.filter((n) => n.staff === 2);
  return { ...measure, notes: [...upper, ...lower] };
}

function replaceMeasure(score: Score, index: number, measure: Measure): Score {
  const measures = score.measures.slice();
  measures[index] = measure;
  return { ...score, measures };
}

function measureAt(score: Score, index: number): Measure {
  const measure = score.measures[index];
  if (measure === undefined) {
    throw new EditError(`${index + 1} 小節目が見つかりません`);
  }
  return measure;
}

/**
 * 段の onset から、与えたまとまりで上書きする。
 *
 * - 範囲に掛かる音符は消える (はみ出した後ろの部分は休符になる)
 * - 範囲の手前から掛かっている音符があれば置けない (途中から切れないため)
 * - 小節からはみ出すなら置けない
 *
 * replacement に null を渡すと、範囲を休符にする。
 */
function overwrite(
  score: Score,
  position: StaffPosition,
  length: number,
  replacement: Note[] | null,
): Score {
  const measure = measureAt(score, position.measureIndex);
  const measureLength = measureQuarterLength(score.time);
  const start = position.onset;
  const end = start + length;
  if (start < -EPSILON || end > measureLength + EPSILON) {
    throw new EditError("小節に収まりません");
  }

  const events = staffEvents(measure, position.staff);
  const straddling = events.find(
    (e) =>
      !isRestEvent(e) &&
      e.onset < start - EPSILON &&
      e.onset + e.length > start + EPSILON,
  );
  if (straddling !== undefined) {
    throw new EditError("音符の途中には置けません");
  }

  const kept = events.filter(
    (e) =>
      !isRestEvent(e) &&
      (e.onset + e.length <= start + EPSILON || e.onset >= end - EPSILON),
  );
  const sounding =
    replacement === null
      ? kept
      : [...kept, { onset: start, length, notes: replacement }];
  const filled = fillStaff(sounding, position.staff, score.time);
  return replaceMeasure(
    score,
    position.measureIndex,
    withStaff(measure, position.staff, filled),
  );
}

export interface NoteLocation {
  measureIndex: number;
  staff: StaffNumber;
  event: StaffEvent;
  note: Note;
}

export function locateNote(score: Score, noteId: string): NoteLocation | null {
  for (const [measureIndex, measure] of score.measures.entries()) {
    const note = measure.notes.find((n) => n.id === noteId);
    if (note === undefined) {
      continue;
    }
    const event = staffEvents(measure, note.staff).find((e) =>
      e.notes.some((n) => n.id === noteId),
    );
    if (event === undefined) {
      return null;
    }
    return { measureIndex, staff: note.staff, event, note };
  }
  return null;
}

function mustLocate(score: Score, noteId: string): NoteLocation {
  const location = locateNote(score, noteId);
  if (location === null) {
    throw new EditError("音符が見つかりません");
  }
  return location;
}

/** 段の中で position を含むまとまり (休符がまとめ直されたあとの選択に使う) */
function eventContaining(
  score: Score,
  position: StaffPosition,
): StaffEvent | undefined {
  const measure = measureAt(score, position.measureIndex);
  return staffEvents(measure, position.staff).find(
    (e) =>
      e.onset <= position.onset + EPSILON &&
      position.onset < e.onset + e.length - EPSILON,
  );
}

/** 段の中で onset ちょうどに始まるまとまり */
function eventAt(
  score: Score,
  position: StaffPosition,
): StaffEvent | undefined {
  const measure = measureAt(score, position.measureIndex);
  return staffEvents(measure, position.staff).find(
    (e) => Math.abs(e.onset - position.onset) < EPSILON,
  );
}

function sortedUnique(pitches: Pitch[]): Pitch[] {
  const unique: Pitch[] = [];
  for (const pitch of [...pitches].sort(comparePitch)) {
    if (!unique.some((p) => samePitch(p, pitch))) {
      unique.push(pitch);
    }
  }
  return unique;
}

export interface EditResult {
  score: Score;
  /** 編集で置いた (または対象になった) 音符の id。選択の付け替えに使う */
  noteIds: string[];
}

/**
 * 音符 (または休符) を置く。範囲にあった音は上書きする。
 * pitches に null を渡すと休符を置く。
 */
export function placeNotes(
  score: Score,
  position: StaffPosition,
  pitches: Pitch[] | null,
  duration: Duration,
): EditResult {
  const length = durationLength(duration);
  if (pitches === null) {
    const next = overwrite(score, position, length, null);
    const rest = eventContaining(next, position);
    return { score: next, noteIds: rest ? [rest.notes[0].id] : [] };
  }
  const notes = sortedUnique(pitches).map((pitch, i) =>
    makeNote(createId(), pitch, duration, position.staff, i > 0),
  );
  return {
    score: overwrite(score, position, length, notes),
    noteIds: notes.map((n) => n.id),
  };
}

/**
 * 和音に音を足す。その位置に音符があれば同じ長さで重ね、休符なら
 * 新しく置く。同じ高さの音が既にあれば何もしない。
 */
export function addChordNote(
  score: Score,
  position: StaffPosition,
  pitch: Pitch,
  duration: Duration,
): EditResult {
  const event = eventAt(score, position);
  if (event === undefined || isRestEvent(event)) {
    return placeNotes(score, position, [pitch], duration);
  }
  const existing = event.notes.find((n) => n.pitch !== null && samePitch(n.pitch, pitch));
  if (existing !== undefined) {
    return { score, noteIds: [existing.id] };
  }
  const head = event.notes[0];
  const added = makeNote(createId(), pitch, noteDurationOf(head), position.staff, true);
  const notes = [...event.notes, added].sort((a, b) =>
    comparePitch(a.pitch as Pitch, b.pitch as Pitch),
  );
  return {
    score: overwrite(score, position, event.length, notes),
    noteIds: [added.id],
  };
}

/**
 * 音符を消す。和音の構成音ならその音だけ、単音なら休符にする。
 * 休符を消そうとしたときは何もしない。
 */
export function removeNote(score: Score, noteId: string): EditResult {
  const { measureIndex, staff, event } = mustLocate(score, noteId);
  if (isRestEvent(event)) {
    return { score, noteIds: [noteId] };
  }
  const position = { measureIndex, staff, onset: event.onset };
  const rest = event.notes.filter((n) => n.id !== noteId);
  if (rest.length > 0) {
    return {
      score: overwrite(score, position, event.length, rest),
      noteIds: [rest[0].id],
    };
  }
  const next = overwrite(score, position, event.length, null);
  const filled = eventContaining(next, position);
  return { score: next, noteIds: filled ? [filled.notes[0].id] : [] };
}

/**
 * 音高を変える。和音の中で他の音と同じ高さになったら 1 つにまとめる。
 */
export function setNotePitch(score: Score, noteId: string, pitch: Pitch): EditResult {
  const { measureIndex, staff, event, note } = mustLocate(score, noteId);
  if (note.pitch === null) {
    throw new EditError("休符には音高がありません");
  }
  const notes = event.notes
    .filter((n) => n.id === noteId || !samePitch(n.pitch as Pitch, pitch))
    .map((n) => (n.id === noteId ? { ...n, pitch } : n))
    .sort((a, b) => comparePitch(a.pitch as Pitch, b.pitch as Pitch));
  return {
    score: overwrite(score, { measureIndex, staff, onset: event.onset }, event.length, notes),
    noteIds: [noteId],
  };
}

/**
 * 音符 (和音なら全体) や休符の長さを変える。
 * 長くすると後ろの音を上書きし、短くすると空いた所が休符になる。
 */
export function setEventDuration(
  score: Score,
  noteId: string,
  duration: Duration,
): EditResult {
  const { measureIndex, staff, event } = mustLocate(score, noteId);
  const position = { measureIndex, staff, onset: event.onset };
  const length = durationLength(duration);
  if (isRestEvent(event)) {
    const rest = makeNote(noteId, null, duration, staff, false);
    const next = overwrite(score, position, length, [rest]);
    // 休符のまとまりとして置いたので、隣の休符とはまとめ直さない
    return { score: next, noteIds: [noteId] };
  }
  // 長さを変えてもタイの印は残す
  const notes = event.notes.map((n, i) => ({
    ...makeNote(n.id, n.pitch, duration, staff, i > 0),
    ...(n.tie ? { tie: true } : {}),
  }));
  return {
    score: overwrite(score, position, length, notes),
    noteIds: [noteId],
  };
}

/**
 * 休符と音符を入れ替える。長さはそのまま。
 * 休符を音符にするときの高さは pitch で渡す。
 */
export function toggleRest(score: Score, noteId: string, pitch: Pitch): EditResult {
  const { measureIndex, staff, event } = mustLocate(score, noteId);
  const position = { measureIndex, staff, onset: event.onset };
  if (isRestEvent(event)) {
    const note = makeNote(createId(), pitch, noteDurationOf(event.notes[0]), staff, false);
    return {
      score: overwrite(score, position, event.length, [note]),
      noteIds: [note.id],
    };
  }
  const rest = makeNote(createId(), null, noteDurationOf(event.notes[0]), staff, false);
  return {
    score: overwrite(score, position, event.length, [rest]),
    noteIds: [rest.id],
  };
}

/**
 * 音符に次の同じ高さの音へのタイを付ける。付いていれば外す。
 * つなぐ相手 (同じ段で次に鳴る同じ高さの音) が無ければ付けられない。
 */
export function toggleTie(score: Score, noteId: string): EditResult {
  const { measureIndex, note } = mustLocate(score, noteId);
  if (note.pitch === null) {
    throw new EditError("休符はタイでつなげません");
  }
  if (!note.tie && tieTarget(score, noteId) === null) {
    throw new EditError("次に鳴る音に同じ高さの音が無いので、タイでつなげません");
  }
  const measure = score.measures[measureIndex];
  const notes = measure.notes.map((n) => {
    if (n.id !== noteId) {
      return n;
    }
    const { tie, ...rest } = n;
    return tie ? rest : { ...rest, tie: true };
  });
  return { score: replaceMeasure(score, measureIndex, { ...measure, notes }), noteIds: [noteId] };
}

/** 両段とも休符だけの小節を作る */
export function emptyMeasure(time: Score["time"]): Measure {
  const measure: Measure = { id: createId(), notes: [] };
  const upper = fillStaff([], 1, time);
  const lower = fillStaff([], 2, time);
  return withStaff(withStaff(measure, 1, upper), 2, lower);
}

/** index の位置に空の小節を挟む (index が小節数なら末尾に足す) */
export function insertMeasure(score: Score, index: number): Score {
  if (index < 0 || index > score.measures.length) {
    throw new EditError("小節を挟む位置が範囲外です");
  }
  const measures = score.measures.slice();
  measures.splice(index, 0, emptyMeasure(score.time));
  return { ...score, measures };
}

export function removeMeasure(score: Score, index: number): Score {
  measureAt(score, index);
  if (score.measures.length === 1) {
    throw new EditError("最後の 1 小節は消せません");
  }
  const measures = score.measures.slice();
  measures.splice(index, 1);
  return { ...score, measures };
}

/**
 * 五線上のクリック位置 (小節頭からのおおよその時刻) を、音符を置ける
 * 位置に寄せる。
 *
 * 候補は「その段で既に何かが始まっている位置」と「grid の倍数」。
 * いちばん近い候補が音符の途中なら、その音符の頭に寄せる
 * (途中からは置けないため)。
 */
export function snapOnset(
  score: Score,
  measureIndex: number,
  staff: StaffNumber,
  time: number,
  grid: number,
): number {
  const measure = measureAt(score, measureIndex);
  const measureLength = measureQuarterLength(score.time);
  const events = staffEvents(measure, staff);

  const candidates = events.map((e) => e.onset);
  for (let t = 0; t < measureLength - EPSILON; t += grid) {
    candidates.push(t);
  }
  let best = 0;
  for (const candidate of candidates) {
    if (Math.abs(candidate - time) < Math.abs(best - time)) {
      best = candidate;
    }
  }

  const inside = events.find(
    (e) =>
      !isRestEvent(e) &&
      e.onset < best - EPSILON &&
      e.onset + e.length > best + EPSILON,
  );
  return inside === undefined ? best : inside.onset;
}

export function setTitle(score: Score, title: string): Score {
  return score.title === title ? score : { ...score, title };
}

/**
 * 調号を変える。移調ではないので、鳴る高さ (実音) はそのまま保つ。
 * どの音に臨時記号が要るかは書き出すときに調号から決まる。
 */
export function setKeySignature(score: Score, fifths: number): Score {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
    throw new EditError("調号は ♭7 つから ♯7 つまでです");
  }
  return score.key.fifths === fifths ? score : { ...score, key: { fifths } };
}

/**
 * 拍子を変える。
 *
 * 小節の中身はそのまま保ち、新しい小節の長さに合わせて末尾の休符を
 * 足すか削る。音符が新しい小節に収まらない小節があれば変えられない
 * (小節線をまたいで詰め直すにはタイが要るため)。
 */
export function setTimeSignature(score: Score, time: Score["time"]): Score {
  if (time.beats === score.time.beats && time.beatType === score.time.beatType) {
    return score;
  }
  const length = measureQuarterLength(time);
  const measures = score.measures.map((measure, index) => {
    let next = measure;
    for (const staff of [1, 2] as StaffNumber[]) {
      const sounding = staffEvents(measure, staff).filter((e) => !isRestEvent(e));
      const end = Math.max(0, ...sounding.map((e) => e.onset + e.length));
      if (end > length + EPSILON) {
        throw new EditError(
          `${index + 1} 小節目の音符が ${time.beats}/${time.beatType} 拍子の小節に収まりません`,
        );
      }
      next = withStaff(next, staff, fillStaff(sounding, staff, time));
    }
    return next;
  });
  return { ...score, time: { ...time }, measures };
}

/** 外から読み込んだ音 (MusicXML など)。pitches が null なら休符 */
export interface ImportedEvent {
  onset: number;
  duration: Duration;
  pitches: Pitch[] | null;
}

/**
 * 段ごとの音の並びから小節を組み立てる。休符は捨てて埋め直す。
 * 音が重なっていたり、小節からはみ出したりしていたら EditError を投げる。
 */
export function measureFromEvents(
  time: Score["time"],
  staves: Record<StaffNumber, ImportedEvent[]>,
): Measure {
  const measureLength = measureQuarterLength(time);
  let measure: Measure = { id: createId(), notes: [] };
  for (const staff of [1, 2] as StaffNumber[]) {
    const sounding: StaffEvent[] = [];
    const sorted = staves[staff]
      .filter((e) => e.pitches !== null && e.pitches.length > 0)
      .sort((a, b) => a.onset - b.onset);
    let previousEnd = 0;
    for (const event of sorted) {
      const length = durationLength(event.duration);
      if (event.onset < previousEnd - EPSILON) {
        throw new EditError(`${staff === 1 ? "上段" : "下段"}で音が重なっています`);
      }
      if (event.onset + length > measureLength + EPSILON) {
        throw new EditError(`${staff === 1 ? "上段" : "下段"}の音が小節からはみ出しています`);
      }
      const notes = sortedUnique(event.pitches as Pitch[]).map((pitch, i) =>
        makeNote(createId(), pitch, event.duration, staff, i > 0),
      );
      sounding.push({ onset: event.onset, length, notes });
      previousEnd = event.onset + length;
    }
    measure = withStaff(measure, staff, fillStaff(sounding, staff, time));
  }
  return measure;
}
