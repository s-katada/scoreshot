/**
 * 楽譜の再生。
 *
 * 再生は MusicXML ではなくデータモデルから直接組み立てる。描画と再生が
 * 同じ真実の情報源を見ることになり、片方だけずれるのを防げる。
 */

import * as Tone from "tone";
import {
  measureQuarterLength,
  noteQuarterLength,
  pitchToName,
  type Score,
  type StaffNumber,
} from "../model/score";
import { tiePairs } from "../model/ties";

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
 * 同じ時刻に置かれる。タイでつながった音は弾き直さず、最初の音を
 * つながった先の終わりまで伸ばす。
 */
export function scoreToTimedNotes(score: Score): TimedNote[] {
  const out: (TimedNote & { id: string })[] = [];
  const measureLength = measureQuarterLength(score.time);
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
        out.push({ id: note.id, at, name: pitchToName(note.pitch), length });
      }
    }

    measureStart += measureLength;
  }

  out.sort((a, b) => a.at - b.at);
  const pairs = tiePairs(score);
  const byId = new Map(out.map((n) => [n.id, n]));
  /** つながった先の音の id → 鳴らす (伸ばす) 最初の音 */
  const heads = new Map<string, TimedNote>();
  for (const n of out) {
    const target = pairs.get(n.id);
    const next = target && byId.get(target.id);
    if (next !== undefined) {
      const head = heads.get(n.id) ?? n;
      head.length = next.at + next.length - head.at;
      heads.set(next.id, head);
    }
  }
  return out.filter((n) => !heads.has(n.id)).map(({ at, name, length }) => ({ at, name, length }));
}

/**
 * 開始位置 startAt (曲頭からの四分音符単位) から鳴らす音を並べる。
 * 時刻は開始位置を 0 とする。
 *
 * 開始位置より前から鳴り続けている音 (開始位置をまたぐ長い音) は含めない。
 * 途中から聴き始めるときに、弾き直していない音が急に鳴り出すのを避ける。
 */
export function notesFrom(score: Score, startAt: number): TimedNote[] {
  return scoreToTimedNotes(score)
    .filter((n) => n.at >= startAt - 1e-9)
    .map((n) => ({ ...n, at: n.at - startAt }));
}

/** 曲全体の長さ (四分音符単位) */
export function scoreQuarterLength(score: Score): number {
  return score.measures.length * measureQuarterLength(score.time);
}

/**
 * 音色。Salamander Grand Piano の実音サンプルを鳴らす。
 *
 * 88 鍵ぶんのファイルは持たず、短 3 度おきの 30 音だけを同梱している。
 * 間の音は Tone.Sampler が近いサンプルからピッチシフトで作るので、
 * 2MB 弱で全域が鳴り、オフラインでも動く。
 * 出典と license は public/samples/piano/NOTICE.md を参照。
 */
const SAMPLE_BASE_URL = "/samples/piano/";

/** ファイル名に # は使えないため Ds / Fs と綴られている */
const SAMPLE_URLS: Record<string, string> = {
  A0: "A0.mp3",
  C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", A1: "A1.mp3",
  C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
  C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
  C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
  C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
  C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", A6: "A6.mp3",
  C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", A7: "A7.mp3",
  C8: "C8.mp3",
};

let instrument: Tone.Sampler | null = null;
let instrumentLoading: Promise<Tone.Sampler> | null = null;

/**
 * 音源を読み込む。
 *
 * 音を鳴らすにはユーザー操作が要るが、読み込み自体には要らない。
 * 起動時に呼んでおけば最初の再生が待たされずに済む。
 */
export function loadInstrument(): Promise<Tone.Sampler> {
  if (instrumentLoading === null) {
    instrumentLoading = new Promise<Tone.Sampler>((resolve, reject) => {
      const sampler = new Tone.Sampler({
        urls: SAMPLE_URLS,
        baseUrl: SAMPLE_BASE_URL,
        // 鍵盤を離したあとの余韻
        release: 1,
        onload: () => resolve(sampler),
        onerror: (error) => reject(error),
      }).toDestination();
      sampler.volume.value = -4;
      instrument = sampler;
    });
  }
  return instrumentLoading;
}

/** Audio Session API (Safari / WKWebView 16.4 以降)。型定義はまだ標準に無い */
interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * AudioContext を起こす。ブラウザ/WebView はユーザー操作を起点にしか
 * 音を鳴らせないので、必ずクリック等のハンドラから呼ぶこと。
 *
 * あわせて、この音が「再生」(楽曲) であることをページから伝える。既定の
 * 「環境音」のままだと、iOS の消音スイッチが入っているときに鳴らない
 * (#8)。アプリ側でも AVAudioSession を再生にしている
 * (src-tauri/src/audio_session.rs) が、WebKit は Web Audio を鳴らすときに
 * セッションの種類を決め直すことがあるので、両方で揃えておく。
 */
export async function ensureAudioReady(): Promise<void> {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (session !== undefined) {
    session.type = "playback";
  }
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
let positionFrameId: number | null = null;

export interface PlayOptions {
  /** 曲頭からの開始位置 (四分音符単位)。省略すると頭から */
  startAt?: number;
  /** 最後の音が鳴り終わったときに呼ばれる */
  onEnded?: () => void;
  /**
   * 再生位置を曲頭からの四分音符単位で毎フレーム通知する。
   * 楽譜上のカーソルを追従させるために使う。
   */
  onPosition?: (quarterPosition: number) => void;
}

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
  if (positionFrameId !== null) {
    cancelAnimationFrame(positionFrameId);
    positionFrameId = null;
  }
  instrument?.releaseAll();
}

/**
 * 楽譜を再生する。startAt を渡すとその位置から始める。
 *
 * 一時停止は「止めて位置を覚えておき、次はそこから再生する」で実現する
 * (呼び出し側)。止めている間に楽譜が編集されても、再開したときは新しい
 * 楽譜を鳴らせる。
 */
export async function play(
  score: Score,
  options: PlayOptions = {},
): Promise<void> {
  await ensureAudioReady();
  stop();

  const transport = Tone.getTransport();
  transport.bpm.value = score.tempo;

  const synth = await loadInstrument();
  // テンポは曲中で変わらない前提。曲中のテンポ変更に対応するときは
  // ここを Tone の拍表記に置き換える。
  const secondsPerQuarter = 60 / score.tempo;
  const startAt = Math.max(0, options.startAt ?? 0);
  const notes = notesFrom(score, startAt);

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

  // 再生位置の通知。Transport の経過秒を拍に直し、開始位置を足す
  if (options.onPosition) {
    const report = options.onPosition;
    const tick = () => {
      report(startAt + transport.seconds / secondsPerQuarter);
      positionFrameId = requestAnimationFrame(tick);
    };
    positionFrameId = requestAnimationFrame(tick);
  }

  const totalSeconds =
    Math.max(0, scoreQuarterLength(score) - startAt) * secondsPerQuarter;
  endTimeoutId = window.setTimeout(() => {
    stop();
    options.onEnded?.();
  }, totalSeconds * 1000 + 300);
}

/**
 * 音符 1 つを単発で鳴らす (楽譜上のクリック用)。
 * "C4" のような音名と、周波数 (Hz) の数値のどちらでも受ける。
 */
export async function playNote(note: string | number): Promise<void> {
  const [sampler] = await Promise.all([loadInstrument(), ensureAudioReady()]);
  sampler.triggerAttackRelease(note, 1.2);
}
