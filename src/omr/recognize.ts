/**
 * 分けた画像 (ラベル画像) から楽譜を組み立てる。OMR の後処理の本体。
 *
 *   五線 → 段 (大譜表) → 小節線 → 符頭 → 和音・音価 → 休符
 *   → 音部記号・調号・臨時記号 → 小節ごとに並べて Score にする
 *
 * 1 つの段は 1 声部として読む (同じ段の中で同時に鳴り始める音は和音に
 * する)。拍子の数字は読まず、小節に入っている音の長さからいちばん多い
 * ものを拍子とする。どれも完全ではないので、読めなかった所や推し量った
 * 所は warnings で伝え、あとは編集で直してもらう。
 */

import {
  EditError,
  durationFromLength,
  durationLength,
  emptyMeasure,
  measureFromEvents,
  type Duration,
  type ImportedEvent,
} from "../model/edit";
import { keyAlter, pitchFromDiatonic, withAlter, diatonicNumber } from "../model/pitch";
import type { Measure, Pitch, Score, StaffNumber } from "../model/score";
import { measureBounds } from "./barlines";
import { buildChords, type Chord } from "./chords";
import { findNoteheads, type Notehead } from "./noteheads";
import type { Page } from "./page";
import { findRests, type Rest } from "./rests";
import { readSigns, type Clef } from "./signs";
import { findStaves, groupSystems } from "./staves";

export interface Recognition {
  score: Score;
  warnings: string[];
}

export class RecognitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecognitionError";
  }
}

/** 五線の上の線の高さ (幹音の通し番号)。ト音記号は F5、ヘ音記号は A3 */
const TOP_LINE: Record<Clef, number> = {
  treble: diatonicNumber({ step: "F", octave: 5 }),
  bass: diatonicNumber({ step: "A", octave: 3 }),
};

/** 小節の 1 段ぶんの中身 (位置の順) */
type Item =
  | { kind: "chord"; x: number; duration: Duration; pitches: Pitch[] }
  | { kind: "rest"; x: number; duration: Duration; wholeShape: boolean };

interface RawMeasure {
  staves: Record<StaffNumber, Item[]>;
}

function modeOf(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== null && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** 小節の長さ (四分音符単位) から拍子を決める */
function timeFromLength(length: number): Score["time"] {
  if (Number.isInteger(length) && length >= 1 && length <= 8) {
    return { beats: length, beatType: 4 };
  }
  if (Number.isInteger(length * 2) && length * 2 <= 16) {
    return { beats: length * 2, beatType: 8 };
  }
  return { beats: 4, beatType: 4 };
}

function itemLength(item: Item): number {
  return durationLength(item.duration);
}

/** 符頭の音高。臨時記号が無ければ、小節の中で先に付いたものか調号に従う */
function pitchOf(
  head: Notehead,
  clef: Clef,
  fifths: number,
  explicit: Pitch["alter"] | undefined,
  carried: Map<number, number>,
): Pitch {
  const diatonic = TOP_LINE[clef] - head.position;
  const base = pitchFromDiatonic(diatonic, 0);
  let alter: number;
  if (explicit !== undefined) {
    alter = explicit;
    carried.set(diatonic, explicit);
  } else {
    alter = carried.get(diatonic) ?? keyAlter(base.step, fifths);
  }
  return withAlter(base, alter as -1 | 0 | 1);
}

export function recognize(input: Page): Recognition {
  const warnings: string[] = [];
  const staves = findStaves(input.staffLabels, input.spacing);
  if (staves.length === 0) {
    throw new RecognitionError("五線が見つかりませんでした。楽譜全体が写るように撮り直してください。");
  }
  // 縮尺合わせに使った線の間隔は粗い見積もりなので、見つけた五線で測り直す
  const measured = [...staves.map((s) => s.spacing)].sort((a, b) => a - b)[Math.floor(staves.length / 2)];
  const page =
    measured > input.spacing * 0.7 && measured < input.spacing * 1.4 ? { ...input, spacing: measured } : input;
  const d = page.spacing;
  const systems = groupSystems(staves);
  if (systems.some((s) => s.staves.length === 1)) {
    warnings.push("大譜表 (上下 2 段の組) になっていない五線がありました。1 段として読んでいます。");
  }
  const headsBySystem = findNoteheads(page, systems);
  const detected = systems.map((system, i) => {
    const heads = headsBySystem[i];
    return {
      system,
      signs: readSigns(page, system, heads),
      chords: buildChords(page, system, heads),
      rests: findRests(page, system),
    };
  });

  // 調号は五線ごとの読みの多数決にする (1 か所の数え間違いに引きずられないように)
  const fifths = modeOf(detected.flatMap((s) => s.signs.staves.map((staff) => staff.fifths))) ?? 0;

  const raw: RawMeasure[] = [];
  for (const { system, signs, chords, rests } of detected) {
    // 段の中の五線を、楽譜の上段 (右手) と下段 (左手) に割り当てる
    const roleOf = (staffIndex: number): StaffNumber =>
      system.staves.length > 1
        ? ((Math.min(staffIndex, 1) + 1) as StaffNumber)
        : signs.staves[0].clef === "bass"
          ? 2
          : 1;

    for (const [start, end] of measureBounds(page, system)) {
      const measure: RawMeasure = { staves: { 1: [], 2: [] } };
      const inside = (x: number) => x >= start && x < end;
      // 臨時記号は小節の中で、同じ段・同じ高さの後ろの音にも効く
      const carried = system.staves.map(() => new Map<number, number>());
      for (const chord of chords.filter((c: Chord) => inside(c.x))) {
        const staffSigns = signs.staves[chord.staff];
        if (chord.x < staffSigns.contentStart) {
          continue;
        }
        const pitches = chord.heads.map((head) =>
          pitchOf(head, staffSigns.clef, fifths, signs.accidentals.get(head), carried[chord.staff]),
        );
        measure.staves[roleOf(chord.staff)].push({ kind: "chord", x: chord.x, duration: chord.duration, pitches });
      }
      for (const rest of rests.filter((r: Rest) => inside(r.x))) {
        if (rest.x < signs.staves[rest.staff].contentStart) {
          continue;
        }
        measure.staves[roleOf(rest.staff)].push({
          kind: "rest",
          x: rest.x,
          duration: { type: rest.type, dots: 0 },
          wholeShape: rest.wholeShape,
        });
      }
      raw.push(measure);
    }
  }

  // 拍子: 小節に入っている長さのうち、いちばん多いもの。同じ位置で鳴り
  // 始めるもの (和音) は、組み立てるときと同じく 1 つに数える。伸ばした音の
  // 下で別の旋律が動く所 (2 声) は 1 本に並べてしまい長く出るので、上下の
  // 段のうち短い方 (中身のある段) をその小節の長さとする
  const staffLength = (items: Item[]) => {
    let length = 0;
    let lastX = -Infinity;
    for (const item of [...items].sort((a, b) => a.x - b.x)) {
      if (item.kind === "rest" && item.wholeShape) {
        continue;
      }
      if (item.x - lastX >= d * 0.6) {
        length += itemLength(item);
      }
      lastX = item.x;
    }
    return length;
  };
  const lengths = raw
    .map((m) => {
      const filled = [staffLength(m.staves[1]), staffLength(m.staves[2])].filter((l) => l > 0);
      return filled.length === 0 ? 0 : Math.min(...filled);
    })
    .filter((length) => length > 0);
  const measureLength = modeOf(lengths) ?? 4;
  const time = timeFromLength(measureLength);
  warnings.push(`拍子は小節に入っている音の長さから ${time.beats}/${time.beatType} と推し量りました。違っていたら直してください。`);

  const measures: Measure[] = [];
  const overflow: number[] = [];
  raw.forEach((m, index) => {
    const staves: Record<StaffNumber, ImportedEvent[]> = { 1: [], 2: [] };
    for (const staff of [1, 2] as StaffNumber[]) {
      const items = [...m.staves[staff]].sort((a, b) => a.x - b.x);
      let onset = 0;
      let lastX = -Infinity;
      let lastOnset = 0;
      for (const item of items) {
        // 同じ位置 (同時に鳴り始める) のものは和音としてまとめる
        const same = item.x - lastX < d * 0.6;
        const at = same ? lastOnset : onset;
        if (item.kind === "rest" && item.wholeShape) {
          // 全休符の形は、小節まるごとの休み
          if (items.length === 1) {
            onset = measureLength;
          }
          continue;
        }
        let length = itemLength(item);
        let duration = item.duration;
        if (at + length > measureLength + 1e-9) {
          const rest = measureLength - at;
          const fitted = rest > 0 ? durationFromLength(rest) : null;
          if (fitted === null) {
            overflow.push(index + 1);
            break;
          }
          duration = fitted;
          length = rest;
          overflow.push(index + 1);
        }
        if (item.kind === "chord") {
          const previous = same ? staves[staff][staves[staff].length - 1] : undefined;
          if (previous !== undefined && previous.pitches !== null && previous.onset === at) {
            previous.pitches.push(...item.pitches);
          } else {
            staves[staff].push({ onset: at, duration, pitches: [...item.pitches] });
          }
        }
        if (!same) {
          lastOnset = at;
          onset = at + length;
        }
        lastX = item.x;
      }
    }
    // 読み違いで音が前の音と重なったり、小節からはみ出したりしたまま
    // 組み立てると小節ごと捨てることになるので、その音だけ落とすか縮める
    for (const staff of [1, 2] as StaffNumber[]) {
      const kept: ImportedEvent[] = [];
      let end = 0;
      for (const event of [...staves[staff]].sort((a, b) => a.onset - b.onset)) {
        if (event.onset < end - 1e-9 || event.onset >= measureLength - 1e-9) {
          overflow.push(index + 1);
          continue;
        }
        let duration = event.duration;
        if (event.onset + durationLength(duration) > measureLength + 1e-9) {
          const fitted = durationFromLength(measureLength - event.onset);
          if (fitted === null) {
            overflow.push(index + 1);
            continue;
          }
          duration = fitted;
          overflow.push(index + 1);
        }
        kept.push({ ...event, duration });
        end = event.onset + durationLength(duration);
      }
      staves[staff] = kept;
    }
    try {
      measures.push(measureFromEvents(time, staves));
    } catch (error) {
      if (!(error instanceof EditError)) {
        throw error;
      }
      warnings.push(`${index + 1} 小節目は組み立てられなかったため、空にしました (${error.message})。`);
      measures.push(emptyMeasure(time));
    }
  });
  if (overflow.length > 0) {
    const list = [...new Set(overflow)].slice(0, 8).join("・");
    warnings.push(`${list} 小節目は、読んだ音が小節に収まらなかったため、はみ出した所を切りました。`);
  }
  if (measures.length === 0) {
    throw new RecognitionError("小節が読み取れませんでした。");
  }

  return {
    score: {
      title: "読み取った楽譜",
      tempo: 100,
      key: { fifths },
      time,
      measures,
    },
    warnings,
  };
}
