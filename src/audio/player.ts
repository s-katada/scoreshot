/**
 * 楽譜の再生。
 *
 * 再生は MusicXML ではなくデータモデルから直接組み立てる。描画と再生が
 * 同じ真実の情報源を見ることになり、片方だけずれるのを防げる。
 */

import * as Tone from "tone";
import {
  noteQuarterLength,
  pitchToName,
  type Score,
  type StaffNumber,
} from "../model/score";

/** 時刻を解決した 1 音 */
export interface TimedNote {
  /** 曲頭からの位置。四分音符を 1 とする */
  at: number;
  /** "C4" / "F#4" 形式 */
  name: string;
  /** 長さ。四分音符を 1 とする */
  length: number;
}

/**
 * 楽譜を時刻つきの音の列に展開する。
 *
 * 段ごとに独立して時間が進む。和音の構成音は時間を進めず、直前の音と
 * 同じ時刻に置かれる。
 */
export function scoreToTimedNotes(score: Score): TimedNote[] {
  const out: TimedNote[] = [];
  // 拍子から 1 小節の長さを四分音符単位で求める (6/8 なら 3)
  const measureLength = (score.time.beats * 4) / score.time.beatType;
  let measureStart = 0;

  for (const measure of score.measures) {
    const cursor: Record<StaffNumber, number> = {
      1: measureStart,
      2: measureStart,
    };
    const lastOnset: Record<StaffNumber, number> = {
      1: measureStart,
      2: measureStart,
    };

    for (const note of measure.notes) {
      const staff = note.staff;
      const length = noteQuarterLength(note);
      let at: number;

      if (note.chord) {
        at = lastOnset[staff];
      } else {
        at = cursor[staff];
        lastOnset[staff] = at;
        cursor[staff] = at + length;
      }

      if (note.pitch !== null) {
        out.push({ at, name: pitchToName(note.pitch), length });
      }
    }

    measureStart += measureLength;
  }

  return out.sort((a, b) => a.at - b.at);
}

/** 曲全体の長さ (四分音符単位) */
export function scoreQuarterLength(score: Score): number {
  const measureLength = (score.time.beats * 4) / score.time.beatType;
  return score.measures.length * measureLength;
}

/**
 * 音色。
 *
 * Phase 1 は合成音で鳴らしている。サンプル音源 (Salamander など) に
 * 差し替える余地を残すため、楽器の生成をここに閉じ込めて外には
 * Tone の型を出していない。
 */
let instrument: Tone.PolySynth | null = null;

function getInstrument(): Tone.PolySynth {
  if (instrument === null) {
    instrument = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0.15, release: 1.4 },
    }).toDestination();
    instrument.volume.value = -8;
  }
  return instrument;
}

/**
 * AudioContext を起こす。ブラウザ/WebView はユーザー操作を起点にしか
 * 音を鳴らせないので、必ずクリック等のハンドラから呼ぶこと。
 */
export async function ensureAudioReady(): Promise<void> {
  await Tone.start();
}

/** Tone.Part に渡す 1 件。Part は time を持つオブジェクトの配列を要求する */
interface ScheduledNote {
  time: number;
  name: string;
  duration: number;
}

let currentPart: Tone.Part<ScheduledNote> | null = null;
let endTimeoutId: number | null = null;

/** 再生中のものがあれば止めて、後始末する */
export function stop(): void {
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  if (currentPart !== null) {
    currentPart.dispose();
    currentPart = null;
  }
  if (endTimeoutId !== null) {
    clearTimeout(endTimeoutId);
    endTimeoutId = null;
  }
  instrument?.releaseAll();
}

/**
 * 楽譜を頭から再生する。
 *
 * @param onEnded 最後の音が鳴り終わったときに呼ばれる
 */
export async function play(score: Score, onEnded?: () => void): Promise<void> {
  await ensureAudioReady();
  stop();

  const transport = Tone.getTransport();
  transport.bpm.value = score.tempo;

  const synth = getInstrument();
  // テンポは曲中で変わらない前提。曲中のテンポ変更に対応するときは
  // ここを Tone の拍表記に置き換える。
  const secondsPerQuarter = 60 / score.tempo;
  const notes = scoreToTimedNotes(score);

  currentPart = new Tone.Part<ScheduledNote>(
    (time, note) => {
      synth.triggerAttackRelease(note.name, note.duration, time);
    },
    notes.map((n) => ({
      time: n.at * secondsPerQuarter,
      name: n.name,
      duration: n.length * secondsPerQuarter,
    })),
  );

  currentPart.start(0);
  transport.start();

  const totalSeconds = scoreQuarterLength(score) * secondsPerQuarter;
  endTimeoutId = window.setTimeout(() => {
    stop();
    onEnded?.();
  }, totalSeconds * 1000 + 300);
}

/**
 * 音符 1 つを単発で鳴らす (楽譜上のクリック用)。
 * "C4" のような音名と、周波数 (Hz) の数値のどちらでも受ける。
 */
export async function playNote(note: string | number): Promise<void> {
  await ensureAudioReady();
  getInstrument().triggerAttackRelease(note, 0.6);
}
