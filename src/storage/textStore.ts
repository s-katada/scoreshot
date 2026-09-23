/**
 * 名前付きのテキストを読み書きする置き場。
 *
 * アプリとして動いているときは Tauri のアプリデータディレクトリに
 * ファイルとして置く。ユーザーが直接触る必要はまだ無く、Documents に置くと
 * ファイルが散らかるため。
 *
 * ブラウザで `pnpm dev` を開いたとき (Tauri が居ないとき) は localStorage に
 * 置く。開発中の確認用で、アプリの動作には関わらない。
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export interface TextStore {
  /** 無ければ null */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
}

const baseDir = BaseDirectory.AppData;

const tauriStore: TextStore = {
  async read(name) {
    if (!(await exists(name, { baseDir }))) {
      return null;
    }
    return readTextFile(name, { baseDir });
  },

  async write(name, text) {
    // アプリデータディレクトリは初回には存在しない
    await mkdir("", { baseDir, recursive: true });
    // 書きかけで落ちても元のファイルが壊れないよう、別名に書いてから差し替える
    const temporary = `${name}.tmp`;
    await writeTextFile(temporary, text, { baseDir });
    await rename(temporary, name, {
      oldPathBaseDir: baseDir,
      newPathBaseDir: baseDir,
    });
  },
};

const PREFIX = "scoreshot:";

const browserStore: TextStore = {
  async read(name) {
    return localStorage.getItem(PREFIX + name);
  },

  async write(name, text) {
    localStorage.setItem(PREFIX + name, text);
  },
};

export function getTextStore(): TextStore {
  return isTauri() ? tauriStore : browserStore;
}
