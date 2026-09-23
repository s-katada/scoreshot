/**
 * ユーザーが選んだ場所のファイルを読み書きする。MusicXML / MIDI の
 * 読み込み・書き出しに使う (#5)。
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
  extensions: ["musicxml", "xml", "mxl"],
  mime: "application/vnd.recordare.musicxml+xml",
};

export const MIDI_FILE: FileType = {
  name: "MIDI",
  extensions: ["mid", "midi"],
  mime: "audio/midi",
};

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

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = types.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(",");
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
