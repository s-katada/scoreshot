/**
 * OSMD で楽譜を描画するコンポーネント。
 *
 * OSMD には状態を持たせない。MusicXML を渡されたら描き直すだけの存在として扱い、
 * 真実の情報源はあくまでデータモデル側に置く。
 */

import { useEffect, useRef } from "react";
import { OpenSheetMusicDisplay, Pitch } from "opensheetmusicdisplay";

interface ScoreViewProps {
  musicXml: string;
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

export function ScoreView({ musicXml, onNoteClick }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // ハンドラの差し替えで楽譜を描き直さずに済むよう ref 経由で参照する
  const onNoteClickRef = useRef(onNoteClick);
  onNoteClickRef.current = onNoteClick;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let disposed = false;
    let cleanups: Array<() => void> = [];

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      drawPartNames: false,
    });

    void (async () => {
      await osmd.load(musicXml);
      if (disposed) {
        return;
      }
      osmd.render();
      if (disposed) {
        return;
      }
      cleanups = attachNoteHandlers(osmd, (frequency) => {
        onNoteClickRef.current?.(frequency);
      });
    })();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) {
        cleanup();
      }
      osmd.clear();
    };
  }, [musicXml]);

  // 楽譜は紙の見立てなので、配色に関わらず白地に黒で描く
  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-auto rounded-lg bg-white p-4 text-black shadow-sm"
    />
  );
}
