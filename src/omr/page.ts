/**
 * 後処理で使い回す、1 ページぶんの材料。
 */

import { binarize, type GrayImage, type LabelImage } from "./image";
import { STAFF_CLASS, SYMBOL_CLASS } from "./models";

export interface Page {
  width: number;
  height: number;
  gray: GrayImage;
  /** 1 つ目のモデルの結果 (背景 / 五線 / 記号) */
  staffLabels: LabelImage;
  /** 2 つ目のモデルの結果 (背景 / 符幹・休符 / 符頭 / 音部記号・調号) */
  symbolLabels: LabelImage;
  /** 元の画像で黒い画素 (インク) */
  ink: Uint8Array;
  /** 線の間隔 */
  spacing: number;
}

export function makePage(
  gray: GrayImage,
  staffLabels: LabelImage,
  symbolLabels: LabelImage,
  spacing: number,
): Page {
  return {
    width: gray.width,
    height: gray.height,
    gray,
    staffLabels,
    symbolLabels,
    ink: binarize(gray),
    spacing,
  };
}

export function isStaffPixel(page: Page, x: number, y: number): boolean {
  return page.staffLabels.data[y * page.width + x] === STAFF_CLASS.staff;
}

/** 1 つ目のモデルが「記号」とした画素 (連桁・旗・付点なども含む) */
export function isSymbolPixel(page: Page, x: number, y: number): boolean {
  return page.staffLabels.data[y * page.width + x] === STAFF_CLASS.symbol;
}

export function symbolClass(page: Page, x: number, y: number): number {
  return page.symbolLabels.data[y * page.width + x];
}

export function isNoteheadPixel(page: Page, x: number, y: number): boolean {
  return symbolClass(page, x, y) === SYMBOL_CLASS.notehead;
}

export function clampX(page: Page, x: number): number {
  return Math.min(page.width - 1, Math.max(0, Math.round(x)));
}

export function clampY(page: Page, y: number): number {
  return Math.min(page.height - 1, Math.max(0, Math.round(y)));
}
