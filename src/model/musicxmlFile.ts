/**
 * MusicXML のファイル (バイト列) を読み込む。
 *
 * 圧縮 MusicXML (.mxl) にも対応する。MuseScore などの既定の書き出し形式で、
 * 中身は ZIP に MusicXML と目録 (META-INF/container.xml) を入れたもの。
 */

import { strFromU8, unzipSync } from "fflate";
import { MusicXmlImportError, parseMusicXml, type ImportResult } from "./musicxmlImport";

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 文字コードを BOM で見分けて読む。無ければ UTF-8 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** 圧縮 MusicXML から楽譜本体の XML を取り出す */
function extractFromMxl(bytes: Uint8Array): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new MusicXmlImportError("圧縮 MusicXML (.mxl) を展開できません");
  }

  const container = files["META-INF/container.xml"];
  if (container !== undefined) {
    const doc = new DOMParser().parseFromString(strFromU8(container), "application/xml");
    const rootfile = doc.getElementsByTagName("rootfile")[0];
    const path = rootfile?.getAttribute("full-path");
    if (path && files[path] !== undefined) {
      return files[path];
    }
  }
  // 目録が無いときは、それらしいファイルを探す
  const candidate = Object.keys(files).find(
    (name) => !name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(name),
  );
  if (candidate === undefined) {
    throw new MusicXmlImportError("圧縮 MusicXML (.mxl) の中に楽譜が見つかりません");
  }
  return files[candidate];
}

/** ファイル名 (拡張子は除く) を、題名が無い楽譜の題名にする */
function titleFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem === "" ? "無題" : stem;
}

export function readMusicXmlFile(name: string, bytes: Uint8Array): ImportResult {
  const xml = isZip(bytes) ? extractFromMxl(bytes) : bytes;
  return parseMusicXml(decodeText(xml), titleFromFileName(name));
}
