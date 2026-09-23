/**
 * MusicXML を読み込んで Score にする。
 *
 * MusicXML は表現の幅が広く、他のソフトが書き出したファイルは Score
 * (ピアノの大譜表 2 段) に収まらないことがある。収まらないものは黙って
 * 捨てず、次のどちらかで伝える:
 *
 * - 楽譜として成り立たなくなるもの (複数の楽器、連符、途中の拍子変更など)
 *   → MusicXmlImportError で読み込み自体を断る
 * - 捨てても音の並びは保てるもの (タイ、装飾音、スラーや強弱記号など)
 *   → 読み込んだうえで warnings に理由を並べる
 *
 * 小節内の時間は MusicXML では一方向にしか進まず、大譜表では上段を書いた
 * あと <backup> で巻き戻して下段を書く。書き出し (musicxml.ts) と同じく
 * この規則を前提に、<backup> / <forward> で位置を追いながら読む。
 */

import {
  EditError,
  durationFromLength,
  durationLength,
  measureFromEvents,
  type Duration,
  type ImportedEvent,
} from "./edit";
import { comparePitch } from "./pitch";
import {
  NOTE_TYPES,
  STEPS,
  measureQuarterLength,
  type Alter,
  type Measure,
  type NoteType,
  type Pitch,
  type Score,
  type StaffNumber,
  type Step,
} from "./score";
import { BEAT_TYPES, TEMPO_MAX, TEMPO_MIN, scoreProblems } from "./validate";

export class MusicXmlImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicXmlImportError";
  }
}

export interface ImportResult {
  score: Score;
  /** 読み込めなかったもの・変えて読み込んだものの説明 */
  warnings: string[];
}

/** MusicXML で書かれていなかったときのテンポ (MusicXML の既定) */
const DEFAULT_TEMPO = 120;

// --- DOM の小道具。xmldom でも動くよう、DOM Level 1 の範囲だけを使う ---

function childElements(parent: Element): Element[] {
  const out: Element[] = [];
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === 1) {
      out.push(node as Element);
    }
  }
  return out;
}

function child(parent: Element, name: string): Element | null {
  return childElements(parent).find((e) => e.nodeName === name) ?? null;
}

function children(parent: Element, name: string): Element[] {
  return childElements(parent).filter((e) => e.nodeName === name);
}

function childText(parent: Element, name: string): string | null {
  const element = child(parent, name);
  return element === null ? null : (element.textContent ?? "").trim();
}

function childNumber(parent: Element, name: string): number | null {
  const value = childText(parent, name);
  if (value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasDescendant(parent: Element, name: string): boolean {
  return parent.getElementsByTagName(name).length > 0;
}

/** getElementsByTagName の結果を配列にする (xmldom の NodeList は for-of で回せない) */
function descendants(parent: Element, name: string): Element[] {
  const list = parent.getElementsByTagName(name);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i] as Element);
  }
  return out;
}

/** 小節の番号。number 属性が無ければ並び順 */
function measureLabel(measure: Element, index: number): string {
  const number = measure.getAttribute("number");
  return `${number && number.trim() !== "" ? number : index + 1} 小節目`;
}

// --- 読み込みの途中で集める情報 ---

/** 声部ごと・段ごとに集めた音 */
interface RawNote {
  onset: number;
  duration: Duration;
  pitch: Pitch | null;
  voice: string;
  staff: StaffNumber;
}

/** 同じ理由の注意をまとめて数える */
class Warnings {
  private readonly counts = new Map<string, number>();
  private readonly places = new Map<string, Set<string>>();

  add(message: string, place?: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
    if (place !== undefined) {
      const set = this.places.get(message) ?? new Set();
      set.add(place);
      this.places.set(message, set);
    }
  }

  list(): string[] {
    return [...this.counts.keys()].map((message) => {
      const places = this.places.get(message);
      if (places === undefined || places.size === 0) {
        return message;
      }
      const shown = [...places].slice(0, 5).join("、");
      return `${message} (${shown}${places.size > 5 ? " ほか" : ""})`;
    });
  }
}

const NOTE_TYPE_SET = new Set<string>(NOTE_TYPES);

function readPitch(note: Element, place: string): Pitch {
  const pitch = child(note, "pitch") as Element;
  const step = childText(pitch, "step");
  const octave = childNumber(pitch, "octave");
  if (step === null || !STEPS.includes(step as Step) || octave === null) {
    throw new MusicXmlImportError(`${place}: 音高が読めません`);
  }
  const alter = childNumber(pitch, "alter") ?? 0;
  if (!Number.isInteger(alter)) {
    throw new MusicXmlImportError(`${place}: 微分音 (alter=${alter}) には対応していません`);
  }
  if (alter < -1 || alter > 1) {
    throw new MusicXmlImportError(
      `${place}: ダブルシャープ・ダブルフラットには対応していません`,
    );
  }
  const result: Pitch = { step: step as Step, octave };
  if (alter !== 0) {
    result.alter = alter as Alter;
  }
  return result;
}

/** 音価を読む。<type> が無ければ長さから決める */
function readDuration(
  note: Element,
  lengthInQuarters: number,
  place: string,
): Duration {
  const typeText = childText(note, "type");
  const dots = children(note, "dot").length;
  if (typeText !== null) {
    if (!NOTE_TYPE_SET.has(typeText)) {
      throw new MusicXmlImportError(`${place}: ${typeText} の音価には対応していません`);
    }
    if (dots > 2) {
      throw new MusicXmlImportError(`${place}: 付点が 3 つ以上の音符には対応していません`);
    }
    return { type: typeText as NoteType, dots };
  }
  const fromLength = durationFromLength(lengthInQuarters);
  if (fromLength === null) {
    throw new MusicXmlImportError(`${place}: 音の長さ (${lengthInQuarters} 拍) を音価にできません`);
  }
  return fromLength;
}

/** 位置を 1/64 拍に丸める。divisions の割り算で出る誤差を消す */
function roundTime(value: number): number {
  return Math.round(value * 64) / 64;
}

/** メトロノーム記号を四分音符あたりの BPM にする */
function metronomeTempo(metronome: Element): number | null {
  const unit = childText(metronome, "beat-unit");
  const perMinute = childNumber(metronome, "per-minute");
  if (unit === null || perMinute === null || !NOTE_TYPE_SET.has(unit)) {
    return null;
  }
  const dots = children(metronome, "beat-unit-dot").length;
  return perMinute * durationLength({ type: unit as NoteType, dots });
}

function readTitle(root: Element, fallback: string): string {
  const work = child(root, "work");
  const title =
    (work && childText(work, "work-title")) || childText(root, "movement-title");
  if (title) {
    return title;
  }
  for (const credit of children(root, "credit")) {
    const type = childText(credit, "credit-type");
    const words = childText(credit, "credit-words");
    if (type === "title" && words) {
      return words;
    }
  }
  return fallback;
}

/**
 * 1 つの段の音を、声部を 1 つにまとめた並びにする。
 *
 * 大譜表の各段は 1 声部だけを持てる。最初に出てきた声部を主とし、
 * 他の声部の音は次のときだけ取り込む:
 * - 主の声部と同じ時刻・同じ長さの音 → 和音として重ねる
 * - 主の声部が休んでいる所に収まる音 → そのまま置く
 * それ以外 (リズムの違う音が重なる) は捨てて、そのことを伝える。
 */
function mergeVoices(
  notes: RawNote[],
  warnings: Warnings,
  place: string,
): ImportedEvent[] {
  const voices: string[] = [];
  for (const note of notes) {
    if (!voices.includes(note.voice)) {
      voices.push(note.voice);
    }
  }

  const events: ImportedEvent[] = [];
  const same = (a: ImportedEvent, onset: number, duration: Duration) =>
    Math.abs(a.onset - onset) < 1e-9 &&
    Math.abs(durationLength(a.duration) - durationLength(duration)) < 1e-9;
  const overlaps = (onset: number, length: number) =>
    events.some(
      (e) =>
        e.pitches !== null &&
        e.onset < onset + length - 1e-9 &&
        onset < e.onset + durationLength(e.duration) - 1e-9,
    );

  voices.forEach((voice, index) => {
    // 同じ時刻の音 (和音) をまとめる
    const groups: ImportedEvent[] = [];
    for (const note of notes.filter((n) => n.voice === voice)) {
      const group = groups.find((g) => same(g, note.onset, note.duration));
      if (group && note.pitch !== null && group.pitches !== null) {
        group.pitches.push(note.pitch);
      } else if (!group) {
        groups.push({
          onset: note.onset,
          duration: note.duration,
          pitches: note.pitch === null ? null : [note.pitch],
        });
      }
    }

    for (const group of groups) {
      if (index === 0) {
        events.push(group);
        continue;
      }
      if (group.pitches === null) {
        continue;
      }
      const target = events.find((e) => e.pitches !== null && same(e, group.onset, group.duration));
      if (target) {
        target.pitches = [...(target.pitches as Pitch[]), ...group.pitches].sort(comparePitch);
      } else if (!overlaps(group.onset, durationLength(group.duration))) {
        events.push(group);
      } else {
        warnings.add("リズムの違う声部が重なる所は、2 つ目以降の声部の音を捨てました", place);
      }
    }
  });
  return events;
}

interface PartState {
  divisions: number;
  staves: number;
  /** 各段の音部記号。1 段の楽譜で、ヘ音記号なら下段へ入れるのに使う */
  clefs: Map<number, string>;
  fifths: number | null;
  time: Score["time"] | null;
  tempo: number | null;
}

function readAttributes(
  attributes: Element,
  state: PartState,
  warnings: Warnings,
  place: string,
): void {
  const divisions = childNumber(attributes, "divisions");
  if (divisions !== null) {
    if (divisions <= 0) {
      throw new MusicXmlImportError(`${place}: divisions が不正です (${divisions})`);
    }
    state.divisions = divisions;
  }

  const staves = childNumber(attributes, "staves");
  if (staves !== null) {
    if (staves > 2) {
      throw new MusicXmlImportError(
        `${staves} 段の楽譜には対応していません (ピアノの大譜表 2 段まで)`,
      );
    }
    state.staves = staves;
  }

  for (const clef of children(attributes, "clef")) {
    const number = Number(clef.getAttribute("number") ?? "1");
    const sign = childText(clef, "sign") ?? "G";
    if (state.clefs.has(number) && state.clefs.get(number) !== sign) {
      warnings.add("途中の音部記号の変更は読み込めないため、ト音記号・ヘ音記号のままにしました", place);
    }
    if (!state.clefs.has(number)) {
      state.clefs.set(number, sign);
    }
  }

  const key = child(attributes, "key");
  if (key !== null) {
    const fifths = childNumber(key, "fifths");
    if (fifths === null) {
      warnings.add("特殊な調号は読み込めないため、ハ長調として読み込みました", place);
    } else if (state.fifths === null) {
      state.fifths = fifths;
    } else if (state.fifths !== fifths) {
      warnings.add("途中の調号の変更は読み込めないため、最初の調号のままにしました (音の高さは保っています)", place);
    }
  }

  const time = child(attributes, "time");
  if (time !== null) {
    if (child(time, "senza-misura") !== null) {
      throw new MusicXmlImportError(`${place}: 拍子の無い楽譜には対応していません`);
    }
    const beatsText = childText(time, "beats") ?? "";
    const beats = beatsText
      .split("+")
      .map((b) => Number(b))
      .reduce((sum, b) => sum + b, 0);
    const beatType = childNumber(time, "beat-type");
    if (
      !Number.isInteger(beats) ||
      beats < 1 ||
      beats > 32 ||
      beatType === null ||
      !(BEAT_TYPES as readonly number[]).includes(beatType)
    ) {
      throw new MusicXmlImportError(`${place}: ${beatsText}/${beatType ?? "?"} 拍子には対応していません`);
    }
    if (state.time === null) {
      state.time = { beats, beatType };
    } else if (state.time.beats !== beats || state.time.beatType !== beatType) {
      throw new MusicXmlImportError(`${place}: 途中で拍子が変わる楽譜には対応していません`);
    }
  }

  if (child(attributes, "transpose") !== null) {
    warnings.add("移調楽器の指定は読み込んでいません (書かれた音の高さで読み込みました)", place);
  }
}

function readTempo(element: Element, state: PartState, warnings: Warnings, place: string) {
  const found: number[] = [];
  const sounds = element.nodeName === "sound" ? [element] : descendants(element, "sound");
  for (const sound of sounds) {
    const tempo = Number(sound.getAttribute("tempo"));
    if (sound.hasAttribute("tempo") && Number.isFinite(tempo) && tempo > 0) {
      found.push(tempo);
    }
  }
  if (found.length === 0) {
    for (const metronome of descendants(element, "metronome")) {
      const tempo = metronomeTempo(metronome);
      if (tempo !== null) {
        found.push(tempo);
      }
    }
  }
  for (const tempo of found) {
    if (state.tempo === null) {
      state.tempo = tempo;
    } else if (Math.abs(state.tempo - tempo) > 1e-6) {
      warnings.add("途中のテンポの変更は読み込めないため、最初のテンポのままにしました", place);
    }
  }
}

/** 楽譜の飾りのうち、読み込まないもの。音の並びには関わらない */
const DECORATIONS: Array<[string, string]> = [
  ["slur", "スラー"],
  ["dynamics", "強弱記号"],
  ["wedge", "クレッシェンド・デクレッシェンド"],
  ["articulations", "アーティキュレーション"],
  ["ornaments", "装飾記号"],
  ["fermata", "フェルマータ"],
  ["pedal", "ペダル記号"],
  ["lyric", "歌詞"],
  ["harmony", "コードネーム"],
  ["words", "文字の指示"],
];

function reportDecorations(element: Element, warnings: Warnings): void {
  for (const [tag, label] of DECORATIONS) {
    if (element.nodeName === tag || hasDescendant(element, tag)) {
      warnings.add(`${label}は読み込んでいません`);
    }
  }
}

function readPart(part: Element, warnings: Warnings) {
  const state: PartState = {
    divisions: 1,
    staves: 1,
    clefs: new Map(),
    fifths: null,
    time: null,
    tempo: null,
  };
  const measures: Array<{ element: Element; place: string; notes: RawNote[]; end: number }> = [];

  children(part, "measure").forEach((measureElement, index) => {
    const place = measureLabel(measureElement, index);
    const notes: RawNote[] = [];
    let cursor = 0;
    let end = 0;
    let lastOnset = 0;

    for (const element of childElements(measureElement)) {
      switch (element.nodeName) {
        case "attributes":
          readAttributes(element, state, warnings, place);
          break;
        case "direction":
        case "sound":
          readTempo(element, state, warnings, place);
          reportDecorations(element, warnings);
          break;
        case "backup":
          cursor = Math.max(0, cursor - (childNumber(element, "duration") ?? 0));
          break;
        case "forward":
          cursor += childNumber(element, "duration") ?? 0;
          end = Math.max(end, cursor);
          break;
        case "barline":
          if (child(element, "repeat") !== null || child(element, "ending") !== null) {
            warnings.add("反復記号は読み込めないため、書かれた順に 1 回ずつ並べました", place);
          }
          break;
        case "note": {
          if (child(element, "grace") !== null) {
            warnings.add("装飾音符は読み込めないため捨てました", place);
            break;
          }
          if (child(element, "cue") !== null) {
            break;
          }
          if (child(element, "time-modification") !== null) {
            throw new MusicXmlImportError(`${place}: 3 連符などの連符には対応していません`);
          }
          if (child(element, "unpitched") !== null) {
            throw new MusicXmlImportError(`${place}: 打楽器の楽譜には対応していません`);
          }

          const isChord = child(element, "chord") !== null;
          const divisionsLength = childNumber(element, "duration") ?? 0;
          const onsetDivisions = isChord ? lastOnset : cursor;
          if (!isChord) {
            lastOnset = cursor;
            cursor += divisionsLength;
            end = Math.max(end, cursor);
          }
          const onset = roundTime(onsetDivisions / state.divisions);
          const length = roundTime(divisionsLength / state.divisions);

          const staffNumber = Number(childText(element, "staff") ?? "1");
          let staff: StaffNumber;
          if (state.staves === 1) {
            // 1 段の楽譜は音部記号で入れる段を決める
            staff = state.clefs.get(1) === "F" ? 2 : 1;
          } else {
            staff = staffNumber === 2 ? 2 : 1;
          }

          if (child(element, "tie") !== null || hasDescendant(element, "tied")) {
            warnings.add("タイは読み込めないため、つながった音は別々の音にしました", place);
          }
          reportDecorations(element, warnings);

          const isRest = child(element, "rest") !== null;
          if (!isRest && child(element, "pitch") === null) {
            throw new MusicXmlImportError(`${place}: 音高の無い音符があります`);
          }
          // 小節まるごとの休符は <type> を持たないことがあり、長さも音価で
          // 表せないことがある。休符は後で埋め直すので長さだけ見ておく
          if (isRest && childText(element, "type") === null) {
            break;
          }
          const duration = readDuration(element, length, place);
          notes.push({
            onset,
            duration,
            pitch: isRest ? null : readPitch(element, place),
            voice: `${staff}:${childText(element, "voice") ?? "1"}`,
            staff,
          });
          break;
        }
        default:
          reportDecorations(element, warnings);
      }
    }

    measures.push({
      element: measureElement,
      place,
      notes,
      end: roundTime(end / state.divisions),
    });
  });

  return { state, measures };
}

/** 文字列の MusicXML (非圧縮) を読み込む */
export function parseMusicXml(text: string, fallbackTitle = "無題"): ImportResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch {
    // ブラウザは parsererror 要素で知らせるが、例外を投げる実装もある
    throw new MusicXmlImportError("XML として読めません");
  }
  const root = doc.documentElement;
  if (
    root === null ||
    doc.getElementsByTagName("parsererror").length > 0 ||
    root.nodeName === "parsererror"
  ) {
    throw new MusicXmlImportError("XML として読めません");
  }
  if (root.nodeName === "score-timewise") {
    throw new MusicXmlImportError("score-timewise 形式の MusicXML には対応していません");
  }
  if (root.nodeName !== "score-partwise") {
    throw new MusicXmlImportError("MusicXML の楽譜ではありません");
  }

  const parts = children(root, "part");
  if (parts.length === 0) {
    throw new MusicXmlImportError("楽譜に音が 1 つもありません");
  }
  if (parts.length > 1) {
    throw new MusicXmlImportError(
      `楽器 (パート) が ${parts.length} つある楽譜には対応していません。ピアノ 1 台の楽譜だけを読み込めます`,
    );
  }

  const warnings = new Warnings();
  const { state, measures } = readPart(parts[0], warnings);
  if (measures.length === 0) {
    throw new MusicXmlImportError("楽譜に小節が 1 つもありません");
  }

  if (state.time === null) {
    warnings.add("拍子が書かれていないため、4/4 拍子として読み込みました");
  }
  const time = state.time ?? { beats: 4, beatType: 4 };
  const measureLength = measureQuarterLength(time);

  let tempo = state.tempo ?? DEFAULT_TEMPO;
  if (tempo < TEMPO_MIN || tempo > TEMPO_MAX) {
    warnings.add(`テンポ ${tempo} は扱える範囲 (${TEMPO_MIN}〜${TEMPO_MAX}) の外なので、範囲に収めました`);
    tempo = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, tempo));
  }
  tempo = Math.round(tempo * 100) / 100;

  const built: Measure[] = measures.map((measure, index) => {
    let notes = measure.notes;
    // 休符の音価は小節まるごとの休符 (3/4 でも全休符) のことがあるので、
    // 長さは位置の進み具合と、音符の終わりから測る
    const content = Math.max(
      measure.end,
      ...notes
        .filter((n) => n.pitch !== null)
        .map((n) => n.onset + durationLength(n.duration)),
    );
    if (content > measureLength + 1e-9) {
      throw new MusicXmlImportError(
        `${measure.place}: 拍子 (${time.beats}/${time.beatType}) より長い小節があります`,
      );
    }
    // 弱起の小節は、足りないぶんを頭の休符で埋めて小節線に揃える
    const pickup =
      index === 0 &&
      content < measureLength - 1e-9 &&
      (measure.element.getAttribute("implicit") === "yes" ||
        measure.element.getAttribute("number") === "0");
    if (pickup) {
      const shift = measureLength - content;
      notes = notes.map((n) => ({ ...n, onset: roundTime(n.onset + shift) }));
      warnings.add("弱起の小節は、足りないぶんを頭の休符で埋めました");
    }

    const staves: Record<StaffNumber, ImportedEvent[]> = {
      1: mergeVoices(notes.filter((n) => n.staff === 1), warnings, `${measure.place}の上段`),
      2: mergeVoices(notes.filter((n) => n.staff === 2), warnings, `${measure.place}の下段`),
    };
    try {
      return measureFromEvents(time, staves);
    } catch (error) {
      if (error instanceof EditError) {
        throw new MusicXmlImportError(`${measure.place}: ${error.message}`);
      }
      throw error;
    }
  });

  const score: Score = {
    title: readTitle(root, fallbackTitle),
    tempo,
    key: { fifths: Math.max(-7, Math.min(7, state.fifths ?? 0)) },
    time,
    measures: built,
  };

  const problems = scoreProblems(score);
  if (problems.length > 0) {
    // ここまでの組み立てで起きないはずだが、壊れた楽譜は渡さない
    throw new MusicXmlImportError(`読み込んだ楽譜が壊れています\n${problems.join("\n")}`);
  }
  return { score, warnings: warnings.list() };
}
