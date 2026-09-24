/**
 * ユーザーが選んだ場所のファイルを読み書きする。MusicXML / MIDI の
 * 書き出し (#5) と、楽譜の画像の読み込み (#2) に使う。
 *
 * アプリとして動いているときは Tauri のダイアログで保存先や読み込む
 * ファイルを選ばせる。選ばれたファイルは fs プラグインのスコープに
 * 自動で足されるので、そのパスをそのまま読み書きできる。
 *
 * ブラウザで開いたとき (開発中の確認用) は、ダウンロードと
 * <input type="file"> で代わりにする。
 */

import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";

export interface FileType {
  /** ダイアログに出す種類の名前 */
  name: string;
  /** 先頭の点は付けない */
  extensions: string[];
  mime: string;
}

export const MUSICXML_FILE: FileType = {
  name: "MusicXML",
  extensions: ["musicxml"],
  mime: "application/vnd.recordare.musicxml+xml",
};

export const MIDI_FILE: FileType = {
  name: "MIDI",
  extensions: ["mid", "midi"],
  mime: "audio/midi",
};

/** 楽譜の画像 (#2)。HEIC は macOS / iOS の WebView なら読める */
export const IMAGE_FILE: FileType = {
  name: "画像",
  extensions: ["png", "jpg", "jpeg", "heic", "heif", "webp"],
  mime: "image/*",
};

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

/** ファイル名から画像の MIME タイプを決める。分からなければ空文字 */
export function imageType(name: string): string {
  return IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** ファイル名に使えない文字を避ける */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned === "" ? "無題" : cleaned;
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/**
 * 名前を付けて保存する。保存先を選ばずに閉じられたら false。
 * suggestedName には拡張子まで含める。
 */
export async function saveFileAs(
  suggestedName: string,
  data: Uint8Array | string,
  type: FileType,
): Promise<boolean> {
  const bytes = toBytes(data);

  if (isTauri()) {
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: type.name, extensions: type.extensions }],
    });
    if (path === null) {
      return false;
    }
    await writeFile(path, bytes);
    return true;
  }

  const blob = new Blob([bytes as BlobPart], { type: type.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  // 文書に挿していないリンクでは、ファイル名の指定が無視されることがある
  document.body.append(link);
  link.click();
  link.remove();
  // クリックの処理が終わってから片付ける
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** ファイルを 1 つ選ばせて読む。選ばずに閉じられたら null */
export async function openFile(types: FileType[]): Promise<PickedFile | null> {
  if (isTauri()) {
    const path = await open({
      multiple: false,
      directory: false,
      filters: types.map((t) => ({ name: t.name, extensions: t.extensions })),
    });
    if (path === null) {
      return null;
    }
    return { name: baseName(path), bytes: await readFile(path) };
  }

  return pickWithInput(types.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(","));
}

/**
 * 画像を 1 つ選ばせる。iOS / iPadOS では写真ライブラリやカメラからも
 * 選べるように <input type="file"> を使う (Tauri のダイアログは
 * 「ファイル」の中しか選べない)。ほかでは openFile と同じ
 */
export async function openImage(): Promise<PickedFile | null> {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return iOS ? pickWithInput("image/*") : openFile([IMAGE_FILE]);
}

function pickWithInput(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buffer) => resolve({ name: file.name, bytes: new Uint8Array(buffer) }))
        .catch(reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
