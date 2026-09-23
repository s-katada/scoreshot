/**
 * 再生の状態 (停止・再生中・一時停止) と操作。
 *
 * 一時停止は、止めて位置を覚えておき、再開するとその位置から再生し直す。
 * 止めている間に楽譜が編集されても、再開したときは新しい楽譜を鳴らす。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Score } from "../model/score";
import { loadInstrument, play, stop } from "./player";

export type PlayState = "stopped" | "playing" | "paused";

export interface Playback {
  state: PlayState;
  /** 再生位置 (曲頭からの四分音符単位)。一時停止中は止めた位置、停止中は null */
  position: number | null;
  /** 音源を読み込み終えたか */
  ready: boolean;
  /** 再生 / 一時停止 / 再開を切り替える */
  toggle: () => void;
  /** 位置を指定して頭から鳴らし直す */
  playFrom: (position: number) => void;
  stop: () => void;
}

export function usePlayback(score: Score): Playback {
  const [state, setState] = useState<PlayState>("stopped");
  const [position, setPosition] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  // 再生のたびに増やす。止めたあとに届いた古い再生の通知を捨てるため
  const tokenRef = useRef(0);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const positionRef = useRef(position);
  positionRef.current = position;
  const stateRef = useRef(state);
  stateRef.current = state;

  // 音源の読み込みにはユーザー操作が要らないので起動時に済ませておく。
  // 最初の再生で 2MB の読み込みを待たされるのを避けるため。
  useEffect(() => {
    let cancelled = false;
    void loadInstrument().then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async (from: number) => {
    const token = ++tokenRef.current;
    setState("playing");
    setPosition(from);
    await play(scoreRef.current, {
      startAt: from,
      onPosition: (p) => {
        if (tokenRef.current === token) {
          setPosition(p);
        }
      },
      onEnded: () => {
        if (tokenRef.current === token) {
          setState("stopped");
          setPosition(null);
        }
      },
    });
    // 音の準備を待っている間に止められていたら、始まった再生を止める
    if (tokenRef.current !== token) {
      stop();
    }
  }, []);

  const stopPlayback = useCallback(() => {
    tokenRef.current++;
    stop();
    setState("stopped");
    setPosition(null);
  }, []);

  const toggle = useCallback(() => {
    switch (stateRef.current) {
      case "stopped":
        void start(0);
        break;
      case "playing":
        // 位置は最後に届いた通知のまま残す
        tokenRef.current++;
        stop();
        setState("paused");
        break;
      case "paused":
        void start(positionRef.current ?? 0);
        break;
    }
  }, [start]);

  const playFrom = useCallback(
    (from: number) => {
      void start(from);
    },
    [start],
  );

  // 画面を離れるときは鳴らしっぱなしにしない
  useEffect(() => () => stop(), []);

  return { state, position, ready, toggle, playFrom, stop: stopPlayback };
}
