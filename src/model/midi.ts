/**
 * 楽譜を Standard MIDI File (SMF) に書き出す。
 *
 * フォーマット 1 で、1 本目のトラックにテンポ・拍子・調号を、2 本目と
 * 3 本目に右手 (上段)・左手 (下段) を置く。DAW などで手ごとに分けて
 * 扱えるよう、チャンネルも分けている (どちらもピアノの音色)。
 *
 * 時刻は再生と同じく Score から直接組み立てる。
 */

import { isRestEvent, staffEvents } from "./edit";
import { midiNumber } from "./pitch";
import { tiePairs } from "./ties";
import {
  DIVISIONS,
  measureQuarterLength,
  type Pitch,
  type Score,
  type StaffNumber,
} from "./score";

/** 四分音符あたりの tick 数。MusicXML の divisions と揃えておく */
export const MIDI_PPQ = DIVISIONS;

const VELOCITY = 80;
const PIANO_PROGRAM = 0;

interface TrackEvent {
  tick: number;
  /** 同じ tick の中での並び順。小さいほど先 (消音を発音より先にする) */
  order: number;
  bytes: number[];
}

/** 可変長の数値 (デルタタイムなどに使う) */
function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function text(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

function meta(tick: number, type: number, data: number[]): TrackEvent {
  return { tick, order: 0, bytes: [0xff, type, ...variableLength(data.length), ...data] };
}

function chunk(events: TrackEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const event of sorted) {
    body.push(...variableLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  const end = meta(last, 0x2f, []);
  body.push(...variableLength(0), ...end.bytes);
  return [...text("MTrk"), ...uint32(body.length), ...body];
}

function conductorTrack(score: Score): number[] {
  const microsecondsPerQuarter = Math.round(60_000_000 / score.tempo);
  const beatTypePower = Math.round(Math.log2(score.time.beatType));
  return chunk([
    meta(0, 0x03, text(score.title)),
    meta(0, 0x51, [
      (microsecondsPerQuarter >> 16) & 0xff,
      (microsecondsPerQuarter >> 8) & 0xff,
      microsecondsPerQuarter & 0xff,
    ]),
    // 拍子: 分子, 分母の 2 の指数, メトロノーム 1 拍あたりの MIDI クロック, 32 分音符の数
    meta(0, 0x58, [score.time.beats, beatTypePower, 24, 8]),
    // 調号: ♯ の数 (♭ は負) を符号付き 1 バイトで, 長調
    meta(0, 0x59, [score.key.fifths & 0xff, 0]),
  ]);
}

function staffTrack(score: Score, staff: StaffNumber): number[] {
  const channel = staff - 1;
  const measureTicks = measureQuarterLength(score.time) * MIDI_PPQ;
  const events: TrackEvent[] = [
    // MIDI の文字列には文字コードの決まりが無く、日本語は化けやすいので英語にする
    meta(0, 0x03, text(staff === 1 ? "Piano (right hand)" : "Piano (left hand)")),
    { tick: 0, order: 0, bytes: [0xc0 | channel, PIANO_PROGRAM] },
  ];

  // タイでつながった音は弾き直さない: 始まりの音は消音せず、つながった先は発音しない
  const pairs = tiePairs(score);
  const continued = new Set([...pairs.values()].map((n) => n.id));

  score.measures.forEach((measure, index) => {
    const start = index * measureTicks;
    for (const event of staffEvents(measure, staff)) {
      if (isRestEvent(event)) {
        continue;
      }
      const on = Math.round(start + event.onset * MIDI_PPQ);
      const off = Math.round(start + (event.onset + event.length) * MIDI_PPQ);
      for (const note of event.notes) {
        const key = midiNumber(note.pitch as Pitch);
        if (!continued.has(note.id)) {
          events.push({ tick: on, order: 2, bytes: [0x90 | channel, key, VELOCITY] });
        }
        if (!pairs.has(note.id)) {
          events.push({ tick: off, order: 1, bytes: [0x80 | channel, key, 0] });
        }
      }
    }
  });
  return chunk(events);
}

export function scoreToMidi(score: Score): Uint8Array {
  const header = [
    ...text("MThd"),
    ...uint32(6),
    0, 1, // フォーマット 1
    0, 3, // トラック数
    (MIDI_PPQ >> 8) & 0xff,
    MIDI_PPQ & 0xff,
  ];
  return new Uint8Array([
    ...header,
    ...conductorTrack(score),
    ...staffTrack(score, 1),
    ...staffTrack(score, 2),
  ]);
}
