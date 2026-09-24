/**
 * OSMD で楽譜を描画するコンポーネント。
 *
 * OSMD には状態を持たせない。楽譜を渡されたら描き直すだけの存在として扱い、
 * 真実の情報源はあくまでデータモデル側に置く。
 *
 * 編集のために 2 つの橋渡しをしている:
 *
 * - 描いた音符とモデルの音符 (id) の対応づけ。選択の表示とクリックに使う
 * - クリック位置から「何小節目の、どちらの段の、いつの、どの高さか」への変換
 *
 * どちらも描画のたびに OSMD の描画結果 (VexFlow の五線と音符) から作り直す。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Cursor,
  CursorType,
  type GraphicalMeasure,
  type GraphicalNote,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import { isRestEvent, staffEvents } from "../model/edit";
import { scoreToMusicXml } from "../model/musicxml";
import { comparePitch } from "../model/pitch";
import {
  measureQuarterLength,
  type Pitch,
  type Score,
  type StaffNumber,
} from "../model/score";

/** 五線上の位置 */
export interface StaffPoint {
  measureIndex: number;
  staff: StaffNumber;
  /**
   * 小節頭からのおおよその時刻 (四分音符単位)。描かれた音符の間を
   * 線形に補って求める。音符を置く位置への寄せはモデル側で行う
   */
  time: number;
  /** 五線上の高さ。幹音の通し番号 (C0 = 0) */
  diatonic: number;
}

export interface ScoreHit {
  /** クリック位置のすぐ近くにある音符 (休符含む)。無ければ null */
  noteId: string | null;
  /** 五線から遠すぎる所なら null */
  point: StaffPoint | null;
}

/** キーボードで音を置く位置 (入力カーソル) */
export interface CaretPosition {
  measureIndex: number;
  staff: StaffNumber;
  onset: number;
}

/** 入力モードで「ここに置かれる」を示す半透明の符頭 */
export interface GhostNote {
  measureIndex: number;
  staff: StaffNumber;
  onset: number;
  diatonic: number;
}

interface ScoreViewProps {
  score: Score;
  /**
   * 再生位置を四分音符単位で受ける。null なら停止中。
   * 今どこを弾いているかを示す縦線を動かすために使う。
   */
  playbackPosition?: number | null;
  /** 色を付けて示す音符の id */
  selectedNoteIds?: readonly string[];
  ghost?: GhostNote | null;
  /** 入力カーソルの位置に細い縦線を出す */
  caret?: CaretPosition | null;
  /** 楽譜の上をクリック (タップ) したとき */
  onHit?: (hit: ScoreHit) => void;
  /** 楽譜の上でポインタを動かしたとき。外れたら null */
  onHover?: (hit: ScoreHit | null) => void;
  /** 入力モードではクリックで音符が置かれることをカーソルで示す */
  cursorStyle?: "default" | "crosshair";
}

/** 各段のいちばん上の線の高さ (幹音の通し番号)。ト音記号は F5、ヘ音記号は A3 */
const TOP_LINE: Record<StaffNumber, number> = { 1: 38, 2: 26 };

const SELECTED_COLOR = "#2563eb";

/** VexFlow の五線から使うものだけを構造的に受ける */
interface StaveLike {
  getX(): number;
  getWidth(): number;
  getYForLine(line: number): number;
  getNoteStartX(): number;
  getNoteEndX(): number;
}

interface VexFlowNoteLike {
  getSVGGElement?: () => SVGGElement | null;
  getNoteheadSVGs?: () => Element[];
  vfnote?: [{ getAbsoluteX(): number }, number];
}

interface StaffLayout {
  measureIndex: number;
  staff: StaffNumber;
  left: number;
  right: number;
  /** いちばん上の線の y */
  top: number;
  /** 線の間隔 */
  spacing: number;
}

/** 小節内の時刻と、それが描かれた x 座標の組 */
interface TimeAnchor {
  time: number;
  x: number;
}

/** 描画結果から読み取った配置。座標はすべて SVG 座標 */
interface Layout {
  svg: SVGSVGElement;
  staves: StaffLayout[];
  anchors: Map<number, TimeAnchor[]>;
  /** 音符の id から、その音符として色を付ける要素 */
  notes: Map<string, Element>;
}

function staveOf(measure: GraphicalMeasure): StaveLike | null {
  const getter = (measure as unknown as { getVFStave?: () => StaveLike }).getVFStave;
  return getter ? getter.call(measure) : null;
}

/**
 * 描いた音符とモデルの音符を対応づけながら、五線と時刻の配置を集める。
 *
 * 対応づけは「何小節目・どちらの段・いつ鳴り始めるか」で行い、和音の中は
 * 高さの順に揃える (モデルは低い順、描画は符頭の y の大きい順)。
 */
function buildLayout(
  osmd: OpenSheetMusicDisplay,
  container: HTMLElement,
  score: Score,
): Layout | null {
  // 既定のページ設定 (Endless) では楽譜全体が 1 枚の SVG に描かれる
  const svg = container.querySelector("svg");
  if (svg === null) {
    return null;
  }
  const measureLength = measureQuarterLength(score.time);
  const staves: StaffLayout[] = [];
  const anchors = new Map<number, TimeAnchor[]>();
  const notes = new Map<string, Element>();

  for (const row of osmd.GraphicSheet.MeasureList) {
    for (const measure of row) {
      if (!measure) {
        continue;
      }
      const stave = staveOf(measure);
      const measureIndex = measure.parentSourceMeasure?.measureListIndex;
      const modelMeasure = score.measures[measureIndex];
      if (stave === null || modelMeasure === undefined) {
        continue;
      }
      const staff = (measure.ParentStaff.idInMusicSheet + 1) as StaffNumber;
      const top = stave.getYForLine(0);
      staves.push({
        measureIndex,
        staff,
        left: stave.getX(),
        right: stave.getX() + stave.getWidth(),
        top,
        spacing: stave.getYForLine(1) - top,
      });

      const points = anchors.get(measureIndex) ?? [];
      anchors.set(measureIndex, points);
      points.push({ time: 0, x: stave.getNoteStartX() });
      points.push({ time: measureLength, x: stave.getNoteEndX() });

      const events = staffEvents(modelMeasure, staff);
      for (const entry of measure.staffEntries) {
        const time = entry.relInMeasureTimestamp.RealValue * 4;
        const graphical: GraphicalNote[] = entry.graphicalVoiceEntries.flatMap(
          (v) => v.notes,
        );
        const first = graphical[0] as unknown as VexFlowNoteLike | undefined;
        const event = events.find((e) => Math.abs(e.onset - time) < 1e-6);
        const x = first?.vfnote?.[0].getAbsoluteX();
        // 小節まるごとの休符は小節の真ん中に描かれるので、時刻の目安にしない
        const wholeRest =
          event !== undefined && isRestEvent(event) && event.length >= measureLength;
        if (x !== undefined && !wholeRest) {
          points.push({ time, x });
        }

        if (event === undefined || first === undefined) {
          continue;
        }
        if (isRestEvent(event)) {
          const element = first.getSVGGElement?.();
          if (element) {
            notes.set(event.notes[0].id, element);
          }
          continue;
        }
        // 符頭は下 (低い音) から順に並べる
        const heads = [...(first.getNoteheadSVGs?.() ?? [])].sort(
          (a, b) =>
            (b as SVGGraphicsElement).getBBox().y -
            (a as SVGGraphicsElement).getBBox().y,
        );
        const sorted = [...event.notes].sort((a, b) =>
          comparePitch(a.pitch as Pitch, b.pitch as Pitch),
        );
        sorted.forEach((note, i) => {
          const head = heads[Math.min(i, heads.length - 1)];
          if (head) {
            notes.set(note.id, head);
          }
        });
      }
    }
  }

  for (const points of anchors.values()) {
    points.sort((a, b) => a.time - b.time || a.x - b.x);
  }
  return { svg, staves, anchors, notes };
}

function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const matrix = svg.getScreenCTM();
  if (matrix === null) {
    return null;
  }
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(matrix.inverse());
}

/** x 座標から小節内の時刻を補う */
function timeAtX(points: TimeAnchor[], x: number): number {
  if (points.length === 0) {
    return 0;
  }
  if (x <= points[0].x) {
    return points[0].time;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      return b.x === a.x ? a.time : a.time + ((x - a.x) / (b.x - a.x)) * (b.time - a.time);
    }
  }
  return points[points.length - 1].time;
}

/** 時刻が描かれる x 座標 (timeAtX の逆) */
function xAtTime(points: TimeAnchor[], time: number): number {
  if (points.length === 0) {
    return 0;
  }
  if (time <= points[0].time) {
    return points[0].x;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (time <= b.time) {
      return b.time === a.time ? a.x : a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x);
    }
  }
  return points[points.length - 1].x;
}

/** 符頭の左端から中心までのずれ (線の間隔に対する割合) */
const HEAD_CENTER = 0.6;

function hitTest(layout: Layout, clientX: number, clientY: number): ScoreHit {
  const p = toSvgPoint(layout.svg, clientX, clientY);
  if (p === null) {
    return { noteId: null, point: null };
  }

  // 五線: 横の範囲に入っていて、縦にいちばん近い段
  let best: StaffLayout | null = null;
  let bestDistance = Infinity;
  for (const staff of layout.staves) {
    if (p.x < staff.left || p.x > staff.right) {
      continue;
    }
    const bottom = staff.top + staff.spacing * 4;
    const distance = p.y < staff.top ? staff.top - p.y : p.y > bottom ? p.y - bottom : 0;
    if (distance < bestDistance) {
      best = staff;
      bestDistance = distance;
    }
  }
  let point: StaffPoint | null = null;
  if (best !== null && bestDistance <= best.spacing * 5) {
    const steps = Math.round((p.y - best.top) / (best.spacing / 2));
    const points = layout.anchors.get(best.measureIndex) ?? [];
    point = {
      measureIndex: best.measureIndex,
      staff: best.staff,
      time: Math.max(0, timeAtX(points, p.x - best.spacing * HEAD_CENTER)),
      diatonic: TOP_LINE[best.staff] - steps,
    };
  }

  // 音符: 画面上でいちばん近い符頭 (休符) が指の太さくらいの範囲にあれば
  const spacing = best?.spacing ?? 10;
  const scale = layout.svg.getScreenCTM()?.a ?? 1;
  const reach = Math.max(12, spacing * scale * 1.2);
  let noteId: string | null = null;
  let nearest = reach;
  for (const [id, element] of layout.notes) {
    const rect = element.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < nearest) {
      nearest = distance;
      noteId = id;
    }
  }

  return { noteId, point };
}

function setColor(element: Element, color: string | null): void {
  const targets = [element, ...element.querySelectorAll("path, rect, text")];
  for (const target of targets) {
    const style = (target as SVGElement).style;
    if (color === null) {
      style.removeProperty("fill");
      style.removeProperty("stroke");
    } else {
      style.fill = color;
      style.stroke = color;
    }
  }
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

interface GhostBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ScoreView({
  score,
  playbackPosition,
  selectedNoteIds = [],
  ghost = null,
  caret = null,
  onHit,
  onHover,
  cursorStyle = "default",
}: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 案内の符頭を重ねるための枠。OSMD が中身を管理する containerRef とは分けておく
  const overlayRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  // 読み込みは非同期なので、古い読み込みの続きが新しい描画を壊さないよう
  // 世代番号で打ち切る
  const loadTokenRef = useRef(0);
  const cursorStopsRef = useRef<number[]>([]);
  const cursorIndexRef = useRef(0);
  const layoutRef = useRef<Layout | null>(null);
  // 描画済みの楽譜。配置を作り直すときにモデル側の対応を引くのに使う
  const renderedScoreRef = useRef<Score | null>(null);
  const highlightedRef = useRef<Element[]>([]);
  const selectedRef = useRef(selectedNoteIds);
  selectedRef.current = selectedNoteIds;
  // 描き直すたびに増やし、配置に依存する表示 (選択・案内) を更新させる
  const [renderCount, setRenderCount] = useState(0);

  const musicXml = useMemo(() => scoreToMusicXml(score), [score]);

  const applySelection = useCallback(() => {
    for (const element of highlightedRef.current) {
      setColor(element, null);
    }
    highlightedRef.current = [];
    const layout = layoutRef.current;
    if (layout === null) {
      return;
    }
    for (const id of selectedRef.current) {
      const element = layout.notes.get(id);
      if (element) {
        setColor(element, SELECTED_COLOR);
        highlightedRef.current.push(element);
      }
    }
  }, []);

  /** 描き終えたあとの後始末。配置の読み取り・選択の再表示・カーソルの準備 */
  const afterRender = useCallback(
    (osmd: OpenSheetMusicDisplay) => {
      const rendered = renderedScoreRef.current;
      const container = containerRef.current;
      layoutRef.current =
        rendered === null || container === null
          ? null
          : buildLayout(osmd, container, rendered);
      highlightedRef.current = [];
      applySelection();
      cursorStopsRef.current = collectCursorStops(osmd);
      cursorIndexRef.current = 0;
      osmd.cursor.hide();
      setRenderCount((n) => n + 1);
    },
    [applySelection],
  );

  /**
   * OSMD は一度だけ作る。
   *
   * 楽譜が変わるたびに作り直すと、前のインスタンスが残した要素と
   * autoResize のリサイズ監視がコンテナに積み上がり、描画が下へずれて
   * 楽譜が見えなくなる (issue #1)。
   *
   * 幅に合わせた描き直しも OSMD の autoResize に任せず自前で行う。
   * 描き直すと SVG 要素が作り直されて選択の色や配置が失われるため、
   * 描き直した直後に afterRender を通す必要がある。
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
        if (osmdRef.current !== osmd || renderedScoreRef.current === null) {
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
      osmdRef.current = null;
      layoutRef.current = null;
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
    // 読み直す間、OSMD は描画先を一度空にする。そのままだとページが縮んで
    // スクロール位置が先頭に詰められ、編集するたびに画面がいちばん上へ
    // 戻ってしまう。描き終わるまで今の高さを保つ
    const container = containerRef.current;
    if (container !== null) {
      container.style.minHeight = `${container.offsetHeight}px`;
    }
    const release = () => {
      if (container !== null && loadTokenRef.current === token) {
        container.style.minHeight = "";
      }
    };

    void (async () => {
      try {
        await osmd.load(musicXml);
        if (loadTokenRef.current !== token) {
          return;
        }
        osmd.render();
      } catch {
        // 読み込み中に破棄された場合など。新しい世代が描き直す
        release();
        return;
      }
      if (loadTokenRef.current !== token) {
        return;
      }
      renderedScoreRef.current = score;
      afterRender(osmd);
      release();
    })();
    // score も見る。休符の id だけが変わった編集では MusicXML が同じままでも
    // 音符との対応づけを作り直す必要がある
  }, [musicXml, score, afterRender]);

  useEffect(() => {
    applySelection();
  }, [selectedNoteIds, applySelection]);

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
    // renderCount: 描き直すとカーソルが隠れて頭に戻るので、一時停止中でも
    // 描き直しのたびに置き直す
  }, [playbackPosition, renderCount]);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const layout = layoutRef.current;
      if (layout === null || !onHit) {
        return;
      }
      onHit(hitTest(layout, event.clientX, event.clientY));
    },
    [onHit],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const layout = layoutRef.current;
      if (layout === null || !onHover) {
        return;
      }
      onHover(hitTest(layout, event.clientX, event.clientY));
    },
    [onHover],
  );

  const handlePointerLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  // 案内の符頭を置く位置。コンテナ内の座標に直して絶対配置する
  const ghostBox = useMemo<GhostBox | null>(() => {
    const layout = layoutRef.current;
    const overlay = overlayRef.current;
    if (ghost === null || layout === null || overlay === null || renderCount === 0) {
      return null;
    }
    const staff = layout.staves.find(
      (s) => s.measureIndex === ghost.measureIndex && s.staff === ghost.staff,
    );
    const matrix = layout.svg.getScreenCTM();
    if (staff === undefined || matrix === null) {
      return null;
    }
    const points = layout.anchors.get(ghost.measureIndex) ?? [];
    const x = xAtTime(points, ghost.onset) + staff.spacing * HEAD_CENTER;
    const y = staff.top + (TOP_LINE[ghost.staff] - ghost.diatonic) * (staff.spacing / 2);
    const point = layout.svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const client = point.matrixTransform(matrix);
    const origin = overlay.getBoundingClientRect();
    const width = staff.spacing * 1.3 * matrix.a;
    const height = staff.spacing * matrix.d;
    return {
      left: client.x - origin.left - width / 2,
      top: client.y - origin.top - height / 2,
      width,
      height,
    };
    // renderCount: 描き直すと座標が変わるので、そのたびに測り直す
  }, [ghost, renderCount]);

  // 入力カーソルの縦線。最後の小節の後ろを指しているときは楽譜の右端に出す
  const caretBox = useMemo<GhostBox | null>(() => {
    const layout = layoutRef.current;
    const overlay = overlayRef.current;
    if (caret === null || layout === null || overlay === null || renderCount === 0) {
      return null;
    }
    const matrix = layout.svg.getScreenCTM();
    if (matrix === null) {
      return null;
    }
    let staff = layout.staves.find(
      (s) => s.measureIndex === caret.measureIndex && s.staff === caret.staff,
    );
    let x: number;
    if (staff !== undefined) {
      x = xAtTime(layout.anchors.get(caret.measureIndex) ?? [], caret.onset) - staff.spacing * 0.3;
    } else {
      const last = layout.staves
        .filter((s) => s.staff === caret.staff)
        .sort((a, b) => b.measureIndex - a.measureIndex)[0];
      if (last === undefined || caret.measureIndex < last.measureIndex) {
        return null;
      }
      staff = last;
      x = last.right + staff.spacing * 0.5;
    }
    const point = layout.svg.createSVGPoint();
    point.x = x;
    point.y = staff.top - staff.spacing;
    const client = point.matrixTransform(matrix);
    const origin = overlay.getBoundingClientRect();
    return {
      left: client.x - origin.left,
      top: client.y - origin.top,
      width: 2,
      height: staff.spacing * 6 * matrix.d,
    };
  }, [caret, renderCount]);

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
      <div
        ref={overlayRef}
        className="relative w-full"
        style={{ cursor: cursorStyle }}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <div ref={containerRef} className="relative isolate w-full" />
        {caretBox && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded bg-blue-600/60"
            style={{
              left: caretBox.left,
              top: caretBox.top,
              width: caretBox.width,
              height: caretBox.height,
            }}
          />
        )}
        {ghostBox && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-[50%] bg-blue-600/40"
            style={{
              left: ghostBox.left,
              top: ghostBox.top,
              width: ghostBox.width,
              height: ghostBox.height,
              transform: "rotate(-20deg)",
            }}
          />
        )}
      </div>
    </div>
  );
}
