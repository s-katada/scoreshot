/**
 * 楽譜の画像から楽譜を読み取る (OMR) 流れ。
 *
 *   濃淡画像 → 紙の地を白に揃える → 線の間隔を測って縮尺を揃える
 *   → 1 つ目のモデル (五線 / 記号) → 2 つ目のモデル (符頭・符幹など)
 *   → 後処理 (recognize) で Score に組み立てる
 *
 * モデルを動かす仕組み (onnxruntime-web) は呼び出し側から渡してもらう。
 * アプリでは Web Worker の中から、検証では Node から、同じ流れを通す。
 *
 * 2 つ目のモデルは 1 つ目の倍ほど重いので、五線から遠いタイル (題名や
 * 余白) は通さない。
 */

import { flattenBackground, resizeGray, type GrayImage, type LabelImage } from "./image";
import { STAFF_CLASS, STAFF_MODEL, SYMBOL_MODEL, type ModelSpec } from "./models";
import { makePage } from "./page";
import { RecognitionError, recognize, type Recognition } from "./recognize";
import { segment, type SegmentationModel } from "./segment";
import {
  TARGET_LINE_DISTANCE,
  estimateStaffSpacing,
  normalizingScale,
  type StaffSpacing,
} from "./staffSpace";

export type OmrStage = "loading" | "staff" | "symbols" | "recognizing";

export interface OmrProgress {
  stage: OmrStage;
  /** 全体のうち終わった割合 (0〜1) */
  fraction: number;
}

export interface ModelProvider {
  load(spec: ModelSpec): Promise<SegmentationModel>;
}

export interface ReadOptions {
  onProgress?: (progress: OmrProgress) => void;
}

/** 線の間隔がこれより狭い (画素) と、拡大しても符頭が潰れて読めない */
const MIN_LINE_DISTANCE = 5;
/** これより狭いと読めはするが、読み違いが増える */
const LOW_LINE_DISTANCE = 8;

// 全体の進み具合のうち、段階ごとに割り当てる幅。2 つ目のモデルは
// 1 つ目の倍ほど時間がかかる
const STAGE_SPAN: Record<OmrStage, [number, number]> = {
  loading: [0, 0.05],
  staff: [0.05, 0.35],
  symbols: [0.35, 0.95],
  recognizing: [0.95, 1],
};

/** 五線の画素がある行から上下 margin 行までを 1 にした、行ごとの印 */
function rowsNearStaves(labels: LabelImage, margin: number): Uint8Array {
  const { width, height, data } = labels;
  const minimum = TARGET_LINE_DISTANCE * 3;
  const near = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      if (data[i] === STAFF_CLASS.staff) {
        count++;
      }
    }
    if (count >= minimum) {
      near.fill(1, Math.max(0, y - margin), Math.min(height, y + margin + 1));
    }
  }
  return near;
}

export interface PreparedImage {
  /** 紙の地を白に揃え、線の間隔を揃えた画像 */
  image: GrayImage;
  /** 元の画像での線の間隔 */
  spacing: StaffSpacing;
  /** 元の画像に掛けた倍率 */
  scale: number;
}

/** モデルに通せるように画像を整える。五線が見つからなければ RecognitionError */
export function prepareImage(gray: GrayImage): PreparedImage {
  const flat = flattenBackground(gray);
  const spacing = estimateStaffSpacing(flat);
  if (spacing === null) {
    throw new RecognitionError(
      "五線が見つかりませんでした。楽譜全体が写っていて、ぼけていない画像を使ってください。",
    );
  }
  if (spacing.lineDistance < MIN_LINE_DISTANCE) {
    throw new RecognitionError(
      "画像の解像度が低すぎて読めません。もっと近づけて撮るか、解像度の高い画像を使ってください。",
    );
  }
  const scale = normalizingScale(spacing);
  return { image: resizeGray(flat, scale), spacing, scale };
}

export interface SegmentedPage {
  staffLabels: LabelImage;
  symbolLabels: LabelImage;
}

/** 2 つのモデルで画像を分ける。models は読み込んでおいたもの */
export async function segmentPage(
  image: GrayImage,
  staffModel: SegmentationModel,
  symbolModel: SegmentationModel,
  onProgress?: (stage: "staff" | "symbols", done: number, total: number) => void,
): Promise<SegmentedPage> {
  const staffLabels = await segment(image, staffModel, {
    onProgress: (done, total) => onProgress?.("staff", done, total),
  });
  // 加線の上の音符や符幹は五線から線の間隔 6 つぶんほど離れることがある
  const near = rowsNearStaves(staffLabels, Math.round(TARGET_LINE_DISTANCE * 6));
  const symbolLabels = await segment(image, symbolModel, {
    include: (_left, top, size) => near.subarray(top, top + size).some((v) => v === 1),
    onProgress: (done, total) => onProgress?.("symbols", done, total),
  });
  return { staffLabels, symbolLabels };
}

export async function readScoreFromGray(
  gray: GrayImage,
  models: ModelProvider,
  options: ReadOptions = {},
): Promise<Recognition> {
  const report = (stage: OmrStage, fraction: number) => {
    const [from, to] = STAGE_SPAN[stage];
    options.onProgress?.({ stage, fraction: from + (to - from) * fraction });
  };
  report("loading", 0);
  const prepared = prepareImage(gray);
  const staffModel = await models.load(STAFF_MODEL);
  const symbolModel = await models.load(SYMBOL_MODEL);
  report("loading", 1);

  const { staffLabels, symbolLabels } = await segmentPage(
    prepared.image,
    staffModel,
    symbolModel,
    (stage, done, total) => report(stage, total === 0 ? 1 : done / total),
  );

  report("recognizing", 0);
  const page = makePage(
    prepared.image,
    staffLabels,
    symbolLabels,
    prepared.spacing.lineDistance * prepared.scale,
  );
  const recognition = recognize(page);
  if (prepared.spacing.lineDistance < LOW_LINE_DISTANCE) {
    recognition.warnings.unshift(
      "画像の解像度が低いため、読み違いが多いかもしれません。近づけて撮ると良くなります。",
    );
  }
  report("recognizing", 1);
  return recognition;
}
