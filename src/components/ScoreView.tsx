/**
 * OSMD で楽譜を描画するコンポーネント。
 *
 * OSMD には状態を持たせない。楽譜を渡されたら描き直すだけの存在として扱い、
 * 真実の情報源はあくまでデータモデル側に置く。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type Cursor,
  CursorType,
  OpenSheetMusicDisplay,
  Pitch,
} from "opensheetmusicdisplay";
import { scoreToMusicXml } from "../model/musicxml";
import type { Score } from "../model/score";

interface ScoreViewProps {
  score: Score;
  /**
   * 再生位置を四分音符単位で受ける。null なら停止中。
   * 今どこを弾いているかを示す縦線を動かすために使う。
   */
  playbackPosition?: number | null;
  /** 音符がクリックされたとき、その音の周波数 (Hz) を通知する */
  onNoteClick?: (frequency: number) => void;
}

/**
 * SVG 要素を取り出せる GraphicalNote を構造的に受けるための型。
 * getSVGGElement を持つのは VexFlowGraphicalNote だが、内部クラスを
 * 直接 import せずに済ませている。
 */
interface SvgCapableNote {
  getSVGGElement?: () => SVGGElement | null;
}

/**
 * 描画結果の各音符に click を仕掛ける。
 *
 * 座標計算ではなく OSMD が吐いた SVG 要素そのものに載せているので、
 * ここでは当たり判定を自前で持つ必要がない。タップ位置から音楽的な位置を
 * 逆算する本格的なヒットテストは編集機能 (Phase 3) で必要になる。
 */
function attachNoteHandlers(
  osmd: OpenSheetMusicDisplay,
  onNote: (frequency: number) => void,
): Array<() => void> {
  const cleanups: Array<() => void> = [];

  for (const measuresAcrossStaves of osmd.GraphicSheet.MeasureList) {
    for (const measure of measuresAcrossStaves) {
      if (!measure) {
        continue;
      }
      for (const staffEntry of measure.staffEntries) {
        for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const note of voiceEntry.notes) {
            const element = (note as unknown as SvgCapableNote).getSVGGElement?.();
            // 休符は Pitch を持たないので鳴らす対象から外れる
            const pitch = note.sourceNote?.Pitch;
            if (!element || !pitch) {
              continue;
            }

            const frequency = Pitch.calcFrequency(pitch);
            const handler = (event: Event) => {
              event.stopPropagation();
              onNote(frequency);
            };

            element.addEventListener("click", handler);
            element.style.cursor = "pointer";
            cleanups.push(() => element.removeEventListener("click", handler));
          }
        }
      }
    }
  }

  return cleanups;
}

/**
 * カーソルが止まる位置を四分音符単位で全部集める。
 *
 * 再生位置からカーソルを動かすには「どこで止まれるか」を知る必要があるが、
 * OSMD のイテレータは次の位置を覗き見できない。一度なめて記録しておけば、
 * 以降は添字の差だけ next() を呼べばよくなる。
 */
function collectCursorStops(osmd: OpenSheetMusicDisplay): number[] {
  const cursor = osmd.cursor;
  const stops: number[] = [];
  cursor.reset();
  // 万一 EndReached にならなかったときのための保険
  const limit = 10000;
  while (!cursor.Iterator.EndReached && stops.length < limit) {
    // OSMD のタイムスタンプは全音符を 1 とするので 4 倍して四分音符単位にする
    stops.push(cursor.Iterator.currentTimeStamp.RealValue * 4);
    cursor.next();
  }
  cursor.reset();
  return stops;
}

/**
 * カーソルの縦線が潰れるのを防ぐ。
 *
 * OSMD は縦線を <img> で描き、その高さを HTML の height 属性で与える。
 * ところが Tailwind の preflight が img に height:auto を当てるため、
 * 属性が打ち消されて画像本来の高さ (生成元のキャンバスが 1px) に潰れる。
 * 属性値をインラインスタイルへ写して上書きする。
 */
function applyCursorSize(element: HTMLImageElement | undefined): void {
  if (!element) {
    return;
  }
  // img.width / img.height は描画済みだとレンダリング後の値を返すため、
  // 前回書いたインラインスタイルを読み返して値が固まってしまう。
  // OSMD が書いた属性そのものを読む。
  const width = element.getAttribute("width");
  const height = element.getAttribute("height");
  if (width === null || height === null) {
    return;
  }
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.maxWidth = "none";
  // OSMD は z-index: -1 で音符の裏に敷く想定だが、それだと楽譜の白背景の
  // 裏に回り込んで見えなくなるため前面に出す
  element.style.zIndex = "5";
}

export function ScoreView({
  score,
  playbackPosition,
  onNoteClick,
}: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const noteCleanupsRef = useRef<Array<() => void>>([]);
  // 読み込みは非同期なので、古い読み込みの続きが新しい描画を壊さないよう
  // 世代番号で打ち切る
  const loadTokenRef = useRef(0);
  const cursorStopsRef = useRef<number[]>([]);
  const cursorIndexRef = useRef(0);
  // ハンドラの差し替えで楽譜を描き直さずに済むよう ref 経由で参照する
  const onNoteClickRef = useRef(onNoteClick);
  onNoteClickRef.current = onNoteClick;
  // 描画済みかどうか。描く前に幅が変わっても描き直さない
  const renderedRef = useRef(false);

  const musicXml = useMemo(() => scoreToMusicXml(score), [score]);

  /** 描き終えたあとの後始末。音符への仕掛けとカーソルの準備 */
  const afterRender = useCallback((osmd: OpenSheetMusicDisplay) => {
    for (const cleanup of noteCleanupsRef.current) {
      cleanup();
    }
    noteCleanupsRef.current = attachNoteHandlers(osmd, (frequency) => {
      onNoteClickRef.current?.(frequency);
    });
    cursorStopsRef.current = collectCursorStops(osmd);
    cursorIndexRef.current = 0;
    osmd.cursor.hide();
  }, []);

  /**
   * OSMD は一度だけ作る。
   *
   * 楽譜が変わるたびに作り直すと、前のインスタンスが残した要素と
   * autoResize のリサイズ監視がコンテナに積み上がり、描画が下へずれて
   * 楽譜が見えなくなる (issue #1)。
   *
   * 幅に合わせた描き直しも OSMD の autoResize に任せず自前で行う。
   * 描き直すと SVG 要素が作り直されるので、音符への仕掛けやカーソルの
   * 準備 (afterRender) をやり直す必要があるが、autoResize ではその
   * きっかけを受け取れないため。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: "svg",
      drawTitle: true,
      drawPartNames: false,
      // 今どこを弾いているかを示す縦線
      cursorsOptions: [
        {
          type: CursorType.ThinLeft,
          color: "#2563eb",
          alpha: 0.9,
          follow: true,
        },
      ],
    });
    osmdRef.current = osmd;

    let width = container.clientWidth;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === width) {
        return;
      }
      width = container.clientWidth;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (osmdRef.current !== osmd || !renderedRef.current) {
          return;
        }
        osmd.render();
        afterRender(osmd);
      }, 150);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      loadTokenRef.current += 1;
      for (const cleanup of noteCleanupsRef.current) {
        cleanup();
      }
      noteCleanupsRef.current = [];
      osmdRef.current = null;
      osmd.clear();
    };
  }, [afterRender]);

  /** 楽譜が変わったら読み直して描き直す */
  useEffect(() => {
    const osmd = osmdRef.current;
    if (osmd === null) {
      return;
    }
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;

    void (async () => {
      try {
        await osmd.load(musicXml);
        if (loadTokenRef.current !== token) {
          return;
        }
        osmd.render();
      } catch {
        // 読み込み中に破棄された場合など。新しい世代が描き直す
        return;
      }
      if (loadTokenRef.current !== token) {
        return;
      }
      renderedRef.current = true;
      afterRender(osmd);
    })();
  }, [musicXml, afterRender]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (osmd === null) {
      return;
    }
    // カーソルは render() が走るまで作られない。OSMD の生成と描画を別の
    // 効果に分けているので、描画前にここへ来ることがある
    const cursor: Cursor | undefined = osmd.cursor;
    if (!cursor) {
      return;
    }

    if (playbackPosition === null || playbackPosition === undefined) {
      if (!cursor.Hidden) {
        cursor.hide();
      }
      cursor.reset();
      cursorIndexRef.current = 0;
      return;
    }

    // 再生位置を追い越さない範囲で、いちばん後ろの停止点を選ぶ
    const stops = cursorStopsRef.current;
    let target = 0;
    while (target + 1 < stops.length && stops[target + 1] <= playbackPosition) {
      target += 1;
    }

    // 巻き戻しは reset からやり直す (previous() を重ねるより確実)
    if (target < cursorIndexRef.current) {
      cursor.reset();
      cursorIndexRef.current = 0;
    }
    while (cursorIndexRef.current < target) {
      cursor.next();
      cursorIndexRef.current += 1;
    }

    if (cursor.Hidden) {
      cursor.show();
    }
    // next() や show() のたびに OSMD が属性を書き直すので毎回当て直す
    applyCursorSize(cursor.cursorElement);
  }, [playbackPosition]);

  // 楽譜は紙の見立てなので、配色に関わらず白地に黒で描く。
  //
  // OSMD が幅を測る要素には padding を置かない。padding ぶんまで描画幅に
  // 使われて横にはみ出すため、外側の枠と分けている。
  //
  // 描画先に isolate を効かせて重ね合わせの文脈を作っている。これが無いと
  // OSMD が z-index: -1 で置く再生カーソルが、外枠の白背景の裏に回り込んで
  // 見えなくなる。
  return (
    <div className="w-full overflow-x-auto rounded-lg bg-white p-4 text-black shadow-sm">
      <div ref={containerRef} className="relative isolate w-full" />
    </div>
  );
}
