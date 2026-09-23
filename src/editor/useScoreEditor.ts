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
  toggleRest,
  type EditResult,
  type StaffPosition,
} from "../model/edit";
import {
  PIANO_HIGHEST,
  PIANO_LOWEST,
  diatonicNumber,
  pitchFromDiatonic,
} from "../model/pitch";
import {
  pitchToName,
  type NoteType,
  type Pitch,
  type Score,
  type StaffNumber,
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

  /** 選んだ音符に合わせてパレットの音価も揃える (長さを変えるときの起点になる) */
  const select = useCallback(
    (noteId: string | null) => {
      setSelection(noteId);
      const location = noteId === null ? null : locateNote(score, noteId);
      if (location !== null) {
        const { type, dots } = location.note;
        setPalette((p) => ({ ...p, type, dots: dots ?? 0 }));
      }
      return location;
    },
    [score],
  );

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
      if (result !== null && !palette.rest) {
        sound(pitch);
      }
    },
    [mode, palette, target, apply, select, sound],
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
    message,
    dismissMessage: () => setMessage(null),
    ghost,
    hoverLabel,
    handleHit,
    handleHover: setHover,
    editScore,
    moveSelection,
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
