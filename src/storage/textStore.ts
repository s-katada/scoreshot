/**
 * 名前付きのテキストを読み書きする置き場。
 *
 * アプリとして動いているときは Tauri のアプリデータディレクトリに
 * ファイルとして置く。ユーザーが直接触る必要はまだ無く、Documents に置くと
 * ファイルが散らかるため。
 *
 * ブラウザで `pnpm dev` を開いたとき (Tauri が居ないとき) は localStorage に
 * 置く。開発中の確認用で、アプリの動作には関わらない。
 *
 * 名前には "scores/xxxx.json" のようにディレクトリを 1 段含められる。
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export interface TextStore {
  /** 無ければ null */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  /** 無ければ何もしない */
  remove(name: string): Promise<void>;
  /** ディレクトリ直下のファイル名。ディレクトリが無ければ空 */
  list(directory: string): Promise<string[]>;
}

const baseDir = BaseDirectory.AppData;

function directoryOf(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? "" : name.slice(0, slash);
}

const tauriStore: TextStore = {
  async read(name) {
    if (!(await exists(name, { baseDir }))) {
      return null;
    }
    return readTextFile(name, { baseDir });
  },

  async write(name, text) {
    // アプリデータディレクトリ (と、その下のディレクトリ) は初回には存在しない
    await mkdir(directoryOf(name), { baseDir, recursive: true });
    // 書きかけで落ちても元のファイルが壊れないよう、別名に書いてから差し替える
    const temporary = `${name}.tmp`;
    await writeTextFile(temporary, text, { baseDir });
    await rename(temporary, name, {
      oldPathBaseDir: baseDir,
      newPathBaseDir: baseDir,
    });
  },

  async remove(name) {
    if (await exists(name, { baseDir })) {
      await remove(name, { baseDir });
    }
  },

  async list(directory) {
    if (!(await exists(directory, { baseDir }))) {
      return [];
    }
    const entries = await readDir(directory, { baseDir });
    return entries.filter((e) => e.isFile).map((e) => e.name);
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

  async remove(name) {
    localStorage.removeItem(PREFIX + name);
  },

  async list(directory) {
    const prefix = `${PREFIX}${directory}/`;
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
        names.push(key.slice(prefix.length));
      }
    }
    return names;
  },
};

export function getTextStore(): TextStore {
  return isTauri() ? tauriStore : browserStore;
}
