import { scoreToTimedNotes } from "../../src/audio/player";
import { MIDI_PPQ, scoreToMidi } from "../../src/model/midi";
import { sampleScore } from "../../src/model/sample";
import { check, section } from "./harness";
import { tiedScore } from "./scores";

section("MIDI 書き出し");

interface ParsedEvent {
  track: number;
  tick: number;
  status: number;
  data: number[];
}

/** 検証用の小さな SMF 読み取り */
function parse(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  const header = { tag: tag(0), format: view.getUint16(8), tracks: view.getUint16(10), division: view.getUint16(12) };
  const events: ParsedEvent[] = [];
  let pos = 14;
  for (let track = 0; track < header.tracks; track++) {
    if (tag(pos) !== "MTrk") throw new Error(`MTrk が無い (${pos})`);
    const length = view.getUint32(pos + 4);
    let p = pos + 8;
    const end = p + length;
    let tick = 0;
    const readVar = () => { let v = 0; for (;;) { const b = bytes[p++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } };
    while (p < end) {
      tick += readVar();
      const status = bytes[p++];
      if (status === 0xff) {
        const type = bytes[p++];
        const len = readVar();
        events.push({ track, tick, status, data: [type, ...bytes.slice(p, p + len)] });
        p += len;
      } else {
        const size = (status & 0xf0) === 0xc0 ? 1 : 2;
        events.push({ track, tick, status, data: [...bytes.slice(p, p + size)] });
        p += size;
      }
    }
    pos = end;
  }
  return { header, events };
}

const midi = parse(scoreToMidi(sampleScore));
check("ヘッダ", midi.header.tag === "MThd" && midi.header.format === 1 && midi.header.tracks === 3 && midi.header.division === MIDI_PPQ,
  JSON.stringify(midi.header));

const tempo = midi.events.find((e) => e.status === 0xff && e.data[0] === 0x51);
const us = tempo ? (tempo.data[1] << 16) | (tempo.data[2] << 8) | tempo.data[3] : 0;
check("テンポ (100 BPM = 600000µs)", us === 600000, `${us}`);
const time = midi.events.find((e) => e.status === 0xff && e.data[0] === 0x58);
check("拍子 4/4", time?.data[1] === 4 && time?.data[2] === 2, JSON.stringify(time?.data));

const ons = midi.events.filter((e) => (e.status & 0xf0) === 0x90 && e.data[1] > 0);
const offs = midi.events.filter((e) => (e.status & 0xf0) === 0x80);
check("発音と消音の数", ons.length === 26 && offs.length === 26, `${ons.length} / ${offs.length}`);

// 再生用の時刻と同じ位置で鳴るか
const expected = scoreToTimedNotes(sampleScore).map((n) => n.at * MIDI_PPQ).sort((a, b) => a - b);
const actual = ons.map((e) => e.tick).sort((a, b) => a - b);
check("発音の時刻が再生と一致", JSON.stringify(expected) === JSON.stringify(actual));
check("右手と左手はチャンネルを分ける", ons.filter((e) => e.track === 1).every((e) => (e.status & 0x0f) === 0) && ons.filter((e) => e.track === 2).every((e) => (e.status & 0x0f) === 1));
const firstChord = ons.filter((e) => e.track === 2 && e.tick === 0).map((e) => e.data[0]);
check("左手の和音 C3 E3 G3", JSON.stringify(firstChord.sort()) === "[48,52,55]", JSON.stringify(firstChord));

{
  // タイでつながった音は 1 回だけ発音し、つながった先の終わりで消音する (#16)
  const tied = parse(scoreToMidi(tiedScore())).events.filter((e) => e.track === 1);
  const c4 = (status: number) =>
    tied.filter((e) => (e.status & 0xf0) === status && e.data[0] === 60 && (status === 0x80 || e.data[1] > 0)).map((e) => e.tick);
  check(
    "タイでつながった音は 1 つの音になる",
    JSON.stringify(c4(0x90)) === JSON.stringify([2 * MIDI_PPQ]) && JSON.stringify(c4(0x80)) === JSON.stringify([5 * MIDI_PPQ]),
    `発音 ${JSON.stringify(c4(0x90))} 消音 ${JSON.stringify(c4(0x80))}`,
  );
}
