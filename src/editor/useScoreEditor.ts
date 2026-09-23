/**
 * 楽譜の編集の状態と操作。
 *
 * 2 つのモードを持つ (#3 の決定事項):
 *
 * - 入力モード: パレットで音価を選び、五線上をタップして置く
 * - 選択モード: 既存の音符をタップして選び、音高・音価を変える / 消す
 *
 * 選択はどちらのモードにもある。入力モードで置いた音は選択された状態に
 * なるので、そのまま高さを直したり消したりできる。
 *
 * 編集そのものは model/edit.ts の純関数に任せ、ここでは画面の操作を
 * それに結びつけることと、Undo/Redo の履歴に積むことだけをする。
 */

import { useCallback, useMemo, useState } from "react";
import type { GhostNote, ScoreHit } from "../components/ScoreView";
import {
  EditError,
  addChordNote,
  durationLength,
  insertMeasure,
  locateNote,
  placeNotes,
  removeMeasure,
  removeNote,
  setEventDuration,
  setNotePitch,
  snapOnset,
  staffEvents,
  toggleRest,
  type EditResult,
  type StaffPosition,
} from "../model/edit";
import {
  PIANO_HIGHEST,
  PIANO_LOWEST,
  diatonicNumber,
  keyAlter,
  pitchFromDiatonic,
  withAlter,
} from "../model/pitch";
import {
  measureQuarterLength,
  pitchToName,
  type Alter,
  type NoteType,
  type Pitch,
  type Score,
  type StaffNumber,
  type Step,
} from "../model/score";
import type { History } from "../state/useHistory";

export type EditMode = "input" | "select";

export interface Palette {
  type: NoteType;
  dots: number;
  /** 入力モードで休符を置く */
  rest: boolean;
  /** 入力モードで、既にある音に重ねて和音にする */
  chord: boolean;
}

/** 休符を音符に変えるときの高さ。各段の真ん中の線 */
const MIDDLE_LINE: Record<StaffNumber, number> = {
  1: diatonicNumber({ step: "B", octave: 4 }),
  2: diatonicNumber({ step: "D", octave: 3 }),
};

function clampDiatonic(value: number): number {
  return Math.min(PIANO_HIGHEST, Math.max(PIANO_LOWEST, value));
}

function staffName(staff: StaffNumber): string {
  return staff === 1 ? "上段" : "下段";
}

/** 小節内の位置を「3 拍目」「2.5 拍目」のように言う */
function beatLabel(onset: number, beatType: number): string {
  const beat = (onset * beatType) / 4 + 1;
  return `${Number.isInteger(beat) ? beat : beat.toFixed(2).replace(/0+$/, "")} 拍目`;
}

/**
 * 幹音名 step の音のうち、reference にいちばん近いもの (キーボード入力用)。
 * 高さの変化は調号に従わせる。
 */
function pitchNear(step: Step, reference: Pitch, fifths: number): Pitch {
  const base = diatonicNumber(reference);
  let best = diatonicNumber({ step, octave: reference.octave });
  for (const octave of [reference.octave - 1, reference.octave + 1]) {
    const candidate = diatonicNumber({ step, octave });
    if (Math.abs(candidate - base) < Math.abs(best - base)) {
      best = candidate;
    }
  }
  return pitchFromDiatonic(clampDiatonic(best), fifths);
}

/** 幹音名 step の音のうち、reference より上でいちばん近いもの (和音を積む用) */
function pitchAbove(step: Step, reference: Pitch, fifths: number): Pitch {
  let candidate = diatonicNumber({ step, octave: reference.octave });
  while (candidate <= diatonicNumber(reference)) {
    candidate += 7;
  }
  return pitchFromDiatonic(clampDiatonic(candidate), fifths);
}

/**
 * position から length だけ進んだ位置。小節の終わりに届いたら次の小節の頭
 * (最後の小節なら、まだ無い次の小節を指す。そこへ置くときに小節を足す)
 */
function positionAfter(score: Score, position: StaffPosition, length: number): StaffPosition {
  const end = position.onset + length;
  if (end < measureQuarterLength(score.time) - 1e-9) {
    return { ...position, onset: end };
  }
  return { measureIndex: position.measureIndex + 1, staff: position.staff, onset: 0 };
}

interface Options {
  history: History<Score>;
  /** 置いた音・選んだ音を鳴らす */
  onSound?: (name: string) => void;
}

export function useScoreEditor({ history, onSound }: Options) {
  const score = history.value;
  const [mode, setMode] = useState<EditMode>("input");
  const [palette, setPalette] = useState<Palette>({
    type: "quarter",
    dots: 0,
    rest: false,
    chord: false,
  });
  const [selection, setSelection] = useState<string | null>(null);
  /**
   * キーボードで音を置く位置 (入力カーソル)。音符をタップして選ぶとその
   * 音の位置に、音を置くと置いた音の後ろに移る (MuseScore と同じ)
   */
  const [cursor, setCursor] = useState<StaffPosition | null>(null);
  /** 最後に置いた・選んだ音。キーボードで置く音のオクターブを決めるのに使う */
  const [lastPitch, setLastPitch] = useState<Pitch | null>(null);
  const [hover, setHover] = useState<ScoreHit | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 元に戻したあとなどで、選んでいた音が楽譜から消えていることがある
  const selected = useMemo(
    () => (selection === null ? null : locateNote(score, selection)),
    [score, selection],
  );

  const sound = useCallback(
    (pitch: Pitch | null) => {
      if (pitch !== null) {
        onSound?.(pitchToName(pitch));
        setLastPitch(pitch);
      }
    },
    [onSound],
  );

  /**
   * 編集を 1 手として積む。できなかったら理由を出して null を返す。
   * 置いた音符などの id が返ってくる編集なら、それを選択にする。
   */
  const apply = useCallback(
    (edit: (current: Score) => EditResult) => {
      try {
        const result = edit(score);
        history.update(() => result.score);
        if (result.noteIds.length > 0) {
          setSelection(result.noteIds[0]);
        }
        setMessage(null);
        return result;
      } catch (error) {
        if (error instanceof EditError) {
          setMessage(error.message);
          return null;
        }
        throw error;
      }
    },
    [score, history],
  );

  /** 選択とは関係のない編集 (タイトルや拍子など)。変えられたら true */
  const editScore = useCallback(
    (edit: (current: Score) => Score) =>
      apply((current) => ({ score: edit(current), noteIds: [] })) !== null,
    [apply],
  );

  /**
   * 音符を選ぶ。パレットの音価も選んだ音に揃え (長さを変えるときの起点に
   * なる)、入力カーソルを選んだ音の位置に置く (キーボードで上書きできる)。
   */
  const select = useCallback(
    (noteId: string | null) => {
      setSelection(noteId);
      const location = noteId === null ? null : locateNote(score, noteId);
      if (location !== null) {
        const { type, dots } = location.note;
        setPalette((p) => ({ ...p, type, dots: dots ?? 0 }));
        setCursor({
          measureIndex: location.measureIndex,
          staff: location.staff,
          onset: location.event.onset,
        });
      }
      return location;
    },
    [score],
  );

  /** 選択と入力カーソルを捨てる (楽譜を丸ごと差し替えたときなど) */
  const clearSelection = useCallback(() => {
    setSelection(null);
    setCursor(null);
  }, []);

  /** 置いた音の後ろに入力カーソルを進める */
  const advanceCursor = useCallback((result: EditResult) => {
    const location = result.noteIds[0] && locateNote(result.score, result.noteIds[0]);
    if (location) {
      const at = { measureIndex: location.measureIndex, staff: location.staff, onset: location.event.onset };
      setCursor(positionAfter(result.score, at, location.event.length));
    }
  }, []);

  /** 五線上の点を、音符を置く位置と高さに直す */
  const target = useCallback(
    (hit: ScoreHit): { position: StaffPosition; pitch: Pitch } | null => {
      if (hit.point === null) {
        return null;
      }
      const { measureIndex, staff, time, diatonic } = hit.point;
      // 寄せる刻みは選んでいる音価 (ただし 1 拍より粗くはしない)
      const grid = Math.min(durationLength({ type: palette.type, dots: 0 }), 1);
      const onset = snapOnset(score, measureIndex, staff, time, grid);
      return {
        position: { measureIndex, staff, onset },
        pitch: pitchFromDiatonic(clampDiatonic(diatonic), score.key.fifths),
      };
    },
    [score, palette.type],
  );

  const handleHit = useCallback(
    (hit: ScoreHit) => {
      if (mode === "select") {
        const location = select(hit.noteId);
        setMessage(null);
        sound(location?.note.pitch ?? null);
        return;
      }

      const place = target(hit);
      if (place === null) {
        return;
      }
      const { position, pitch } = place;
      const duration = { type: palette.type, dots: palette.dots };
      const result = apply((current) =>
        palette.rest
          ? placeNotes(current, position, null, duration)
          : palette.chord
            ? addChordNote(current, position, pitch, duration)
            : placeNotes(current, position, [pitch], duration),
      );
      if (result !== null) {
        advanceCursor(result);
        if (!palette.rest) {
          sound(pitch);
        }
      }
    },
    [mode, palette, target, apply, select, sound, advanceCursor],
  );

  /** 入力カーソルの位置。無ければ選んでいる音、それも無ければ曲の頭 */
  const inputPosition = useCallback((): StaffPosition => {
    if (cursor !== null) {
      return cursor;
    }
    if (selected !== null) {
      return { measureIndex: selected.measureIndex, staff: selected.staff, onset: selected.event.onset };
    }
    return { measureIndex: 0, staff: 1, onset: 0 };
  }, [cursor, selected]);

  /**
   * 入力カーソルの位置に音 (pitch が null なら休符) を置き、カーソルを進める。
   * カーソルが最後の小節の後ろを指していたら小節を足す。
   */
  const placeAtCursor = useCallback(
    (pitch: Pitch | null) => {
      const position = inputPosition();
      const duration = { type: palette.type, dots: palette.dots };
      const result = apply((current) => {
        const base =
          position.measureIndex >= current.measures.length
            ? insertMeasure(current, current.measures.length)
            : current;
        return placeNotes(base, position, pitch === null ? null : [pitch], duration);
      });
      if (result !== null) {
        advanceCursor(result);
        sound(pitch);
      }
    },
    [inputPosition, palette.type, palette.dots, apply, advanceCursor, sound],
  );

  /**
   * キーボードの音名 (A〜G) で音を置く。オクターブは直前の音にいちばん近い
   * ものを選ぶ (MuseScore と同じ)。asChord なら選んでいる音の上に和音を積む。
   */
  const typeNote = useCallback(
    (step: Step, asChord: boolean) => {
      if (asChord) {
        if (selected === null || selected.note.pitch === null) {
          return;
        }
        const top = selected.event.notes
          .map((n) => n.pitch as Pitch)
          .reduce((a, b) => (diatonicNumber(b) > diatonicNumber(a) ? b : a));
        const pitch = pitchAbove(step, top, score.key.fifths);
        const position = { measureIndex: selected.measureIndex, staff: selected.staff, onset: selected.event.onset };
        const duration = { type: selected.note.type, dots: selected.note.dots ?? 0 };
        const result = apply((current) => addChordNote(current, position, pitch, duration));
        if (result !== null) {
          sound(pitch);
        }
        return;
      }
      const position = inputPosition();
      const reference =
        lastPitch ?? pitchFromDiatonic(MIDDLE_LINE[position.staff], score.key.fifths);
      placeAtCursor(pitchNear(step, reference, score.key.fifths));
    },
    [selected, score.key.fifths, apply, sound, inputPosition, lastPitch, placeAtCursor],
  );

  const typeRest = useCallback(() => placeAtCursor(null), [placeAtCursor]);

  /** 同じ段の前後の音 (休符含む) へ選択を動かす。小節をまたいで動く */
  const moveSelectionSideways = useCallback(
    (delta: number) => {
      const staff = selected?.staff ?? cursor?.staff ?? 1;
      const events = score.measures.flatMap((measure, measureIndex) =>
        staffEvents(measure, staff).map((event) => ({ measureIndex, event })),
      );
      if (events.length === 0) {
        return;
      }
      const index =
        selected === null
          ? -1
          : events.findIndex((e) => e.event.notes.some((n) => n.id === selected.note.id));
      const nextIndex =
        index === -1 ? (delta > 0 ? 0 : events.length - 1) : index + delta;
      const next = events[Math.max(0, Math.min(events.length - 1, nextIndex))];
      const location = select(next.event.notes[0].id);
      setMessage(null);
      sound(location?.note.pitch ?? null);
    },
    [selected, cursor, score, select, sound],
  );

  const ghost = useMemo<GhostNote | null>(() => {
    if (mode !== "input" || hover === null) {
      return null;
    }
    const place = target(hover);
    if (place === null) {
      return null;
    }
    return { ...place.position, diatonic: diatonicNumber(place.pitch) };
  }, [mode, hover, target]);

  /** 案内の文言。「2 小節目 3 拍目 上段 E4」 */
  const hoverLabel = useMemo(() => {
    if (hover === null || hover.point === null) {
      return null;
    }
    const place = target(hover);
    if (place === null) {
      return null;
    }
    const { measureIndex, staff, onset } = place.position;
    const pitch = mode === "input" && !palette.rest ? ` ${pitchToName(place.pitch)}` : "";
    return `${measureIndex + 1} 小節目 ${beatLabel(onset, score.time.beatType)} ${staffName(staff)}${pitch}`;
  }, [hover, target, mode, palette.rest, score.time.beatType]);

  /** パレットで音価を選ぶ。選択モードで音符を選んでいれば、その長さも変える */
  const chooseType = useCallback(
    (type: NoteType) => {
      setPalette((p) => ({ ...p, type }));
      if (mode === "select" && selected !== null) {
        const id = selected.note.id;
        apply((current) => setEventDuration(current, id, { type, dots: palette.dots }));
      }
    },
    [mode, selected, palette.dots, apply],
  );

  const toggleDot = useCallback(() => {
    const dots = palette.dots > 0 ? 0 : 1;
    setPalette((p) => ({ ...p, dots }));
    if (mode === "select" && selected !== null) {
      const type = selected.note.type;
      apply((current) => setEventDuration(current, selected.note.id, { type, dots }));
    }
  }, [mode, selected, palette.dots, apply]);

  const togglePaletteRest = useCallback(() => {
    setPalette((p) => ({ ...p, rest: !p.rest, chord: false }));
  }, []);

  const togglePaletteChord = useCallback(() => {
    setPalette((p) => ({ ...p, chord: !p.chord, rest: false }));
  }, []);

  /** 選んでいる音符の高さを幹音 steps 個ぶん上下させる (7 で 1 オクターブ) */
  const moveSelection = useCallback(
    (steps: number) => {
      if (selected === null || selected.note.pitch === null) {
        return;
      }
      const current = selected.note.pitch;
      const moved = clampDiatonic(diatonicNumber(current) + steps);
      if (moved === diatonicNumber(current)) {
        return;
      }
      const pitch = pitchFromDiatonic(moved, score.key.fifths);
      const result = apply((s) => setNotePitch(s, selected.note.id, pitch));
      if (result !== null) {
        sound(pitch);
      }
    },
    [selected, score.key.fifths, apply, sound],
  );

  /**
   * 選んでいる音符に ♯ / ♭ / ♮ を付ける。同じ記号をもう一度押すと外し、
   * 調号どおりの高さに戻す。
   */
  const setAccidental = useCallback(
    (alter: Alter) => {
      if (selected === null || selected.note.pitch === null) {
        return;
      }
      const current = selected.note.pitch;
      const next =
        (current.alter ?? 0) === alter ? keyAlter(current.step, score.key.fifths) : alter;
      if (next === (current.alter ?? 0)) {
        return;
      }
      const pitch = withAlter(current, next);
      const result = apply((s) => setNotePitch(s, selected.note.id, pitch));
      if (result !== null) {
        sound(pitch);
      }
    },
    [selected, score.key.fifths, apply, sound],
  );

  const toggleSelectedRest = useCallback(() => {
    if (selected === null) {
      return;
    }
    const pitch = pitchFromDiatonic(MIDDLE_LINE[selected.staff], score.key.fifths);
    apply((s) => toggleRest(s, selected.note.id, pitch));
  }, [selected, score.key.fifths, apply]);

  const deleteSelected = useCallback(() => {
    if (selected === null) {
      return;
    }
    apply((s) => removeNote(s, selected.note.id));
  }, [selected, apply]);

  /** 選んでいる小節の後ろ (選んでいなければ末尾) に小節を足す */
  const addMeasure = useCallback(() => {
    const index = selected === null ? score.measures.length : selected.measureIndex + 1;
    apply((s) => ({ score: insertMeasure(s, index), noteIds: [] }));
  }, [selected, score.measures.length, apply]);

  /** 選んでいる小節 (選んでいなければ末尾) を消す */
  const deleteMeasure = useCallback(() => {
    const index = selected === null ? score.measures.length - 1 : selected.measureIndex;
    if (apply((s) => ({ score: removeMeasure(s, index), noteIds: [] })) !== null) {
      setSelection(null);
    }
  }, [selected, score.measures.length, apply]);

  const selectedIds = useMemo(
    () => (selected === null ? [] : [selected.note.id]),
    [selected],
  );

  const undo = useCallback(() => {
    history.undo();
    setMessage(null);
  }, [history]);

  const redo = useCallback(() => {
    history.redo();
    setMessage(null);
  }, [history]);

  const changeMode = useCallback((next: EditMode) => {
    setMode(next);
    setMessage(null);
  }, []);

  return {
    mode,
    setMode: changeMode,
    palette,
    chooseType,
    toggleDot,
    togglePaletteRest,
    togglePaletteChord,
    selected,
    selectedIds,
    select,
    clearSelection,
    cursor,
    typeNote,
    typeRest,
    moveSelectionSideways,
    message,
    dismissMessage: () => setMessage(null),
    ghost,
    hoverLabel,
    handleHit,
    handleHover: setHover,
    editScore,
    moveSelection,
    setAccidental,
    toggleSelectedRest,
    deleteSelected,
    addMeasure,
    deleteMeasure,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    measureCount: score.measures.length,
  };
}

export type ScoreEditor = ReturnType<typeof useScoreEditor>;
