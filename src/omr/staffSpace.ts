/**
 * 五線の線の間隔を、モデルに通す前の画像から見積もる。
 *
 * 画像分割モデルは学習したときの縮尺でいちばんよく働く (線の間隔が
 * 13〜14 画素くらい)。写真やスキャンは撮り方で縮尺がまちまちなので、
 * まず線の間隔を測り、それが揃うように拡大・縮小してからモデルに通す。
 *
 * 測り方は OMR でよく使われるもの。縦に画素をなめて、黒の続き (線の太さ)
 * と、黒の続きとその下の白の続きの和 (線から次の線までの距離) を数え、
 * いちばん多い長さを採る。五線は紙面に何本も平行に並ぶので、ほかの記号
 * よりずっと多く数えられる。
 */

import { binarize, type GrayImage } from "./image";

export interface StaffSpacing {
  /** 線の太さ (画素) */
  lineThickness: number;
  /** 線の中心から次の線の中心までの距離 (画素) */
  lineDistance: number;
}

/** 学習時の縮尺に合わせる、線の間隔の目標 (画素) */
export const TARGET_LINE_DISTANCE = 13.5;

function mode(histogram: number[], from: number): number {
  let best = from;
  for (let i = from; i < histogram.length; i++) {
    if (histogram[i] > histogram[best]) {
      best = i;
    }
  }
  return best;
}

/** 五線が見つからなければ null */
export function estimateStaffSpacing(image: GrayImage): StaffSpacing | null {
  const black = binarize(image);
  const { width, height } = image;
  const maxRun = Math.max(8, Math.floor(height / 8));
  const blackRuns = new Array<number>(maxRun + 1).fill(0);
  const pairs = new Array<number>(2 * maxRun + 1).fill(0);

  // 列を間引いてなめる。紙面の幅に対して 400 列ほど見れば足りる
  const step = Math.max(1, Math.floor(width / 400));
  for (let x = 0; x < width; x += step) {
    let y = 0;
    let previousBlack = -1;
    while (y < height) {
      const color = black[y * width + x];
      let length = 0;
      while (y < height && black[y * width + x] === color) {
        length++;
        y++;
      }
      if (length > maxRun) {
        previousBlack = -1;
        continue;
      }
      if (color === 1) {
        blackRuns[length]++;
        previousBlack = length;
      } else if (previousBlack > 0) {
        pairs[previousBlack + length]++;
        previousBlack = -1;
      }
    }
  }

  const lineThickness = mode(blackRuns, 1);
  const lineDistance = mode(pairs, 3);
  // 数えられた組が少なすぎるときは、五線が無いとみなす
  if (pairs[lineDistance] < 20 || lineDistance < 4) {
    return null;
  }
  return { lineThickness, lineDistance };
}

/** モデルに通す前に掛ける倍率 */
export function normalizingScale(spacing: StaffSpacing | null): number {
  if (spacing === null) {
    return 1;
  }
  return Math.min(4, Math.max(0.1, TARGET_LINE_DISTANCE / spacing.lineDistance));
}
