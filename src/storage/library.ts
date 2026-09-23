/**
 * 楽譜ライブラリ。複数の楽譜をアプリデータディレクトリに置いて管理する (#6)。
 *
 *   scores/<id>.json   楽譜 1 つにつき 1 ファイル (形式は #4 と同じ scoreFile.ts)
 *   library.json       最後に開いていた楽譜の id
 *
 * 一覧は scores/ のファイルを全部読んで作る。楽譜が数十件を超えて重く
 * なるようなら、そこで初めて SQLite などへの移行を考える (#6 の設計メモ)。
 *
 * #4 までの単一ファイル (score.json) は、起動時にライブラリの 1 件目へ移す。
 */

import { createId } from "../model/id";
import { sampleScore } from "../model/sample";
import type { Score } from "../model/score";
import { describeError } from "../util/errors";
import { readScoreFile, serializeScore } from "./scoreFile";
import { getTextStore } from "./textStore";

const SCORES_DIR = "scores";
const LIBRARY_FILE = "library.json";
const LIBRARY_VERSION = 1;
/** #4 で使っていた単一の保存ファイル */
const LEGACY_FILE = "score.json";
/** 読み込めなかった単一ファイルの退避先 (#4 と同じ名前) */
const LEGACY_BROKEN_FILE = "score.broken.json";

export interface LibraryEntry {
  id: string;
  title: string;
  /** 保存した日時。分からなければ null */
  savedAt: Date | null;
  measures: number;
  /** 読み込めないファイルなら、その理由 */
  broken?: string;
}

export function scoreFileName(id: string): string {
  return `${SCORES_DIR}/${id}.json`;
}

/** 保存されている楽譜の一覧。新しく保存したものから並べる */
export async function listScores(): Promise<LibraryEntry[]> {
  const store = getTextStore();
  const names = await store.list(SCORES_DIR);
  const entries: LibraryEntry[] = [];
  for (const name of names) {
    // 書きかけの一時ファイル (xxx.json.tmp) などは数えない
    if (!name.endsWith(".json")) {
      continue;
    }
    const id = name.slice(0, -".json".length);
    try {
      const text = await store.read(scoreFileName(id));
      if (text === null) {
        continue;
      }
      const { score, savedAt } = readScoreFile(text);
      entries.push({ id, title: score.title, savedAt, measures: score.measures.length });
    } catch (error) {
      entries.push({
        id,
        title: "(読み込めない楽譜)",
        savedAt: null,
        measures: 0,
        broken: describeError(error),
      });
    }
  }
  return entries.sort(
    (a, b) => (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0),
  );
}

export async function readScore(id: string): Promise<Score> {
  const text = await getTextStore().read(scoreFileName(id));
  if (text === null) {
    throw new Error("楽譜のファイルが見つかりません");
  }
  return readScoreFile(text).score;
}

export async function writeScore(id: string, score: Score): Promise<void> {
  await getTextStore().write(scoreFileName(id), serializeScore(score, new Date()));
}

export async function deleteScore(id: string): Promise<void> {
  await getTextStore().remove(scoreFileName(id));
}

/** 新しい楽譜として保存し、その id を返す */
export async function addScore(score: Score): Promise<string> {
  const id = createId();
  await writeScore(id, score);
  return id;
}

async function readLastOpened(): Promise<string | null> {
  try {
    const text = await getTextStore().read(LIBRARY_FILE);
    if (text === null) {
      return null;
    }
    const data = JSON.parse(text) as { version?: unknown; lastOpenedId?: unknown };
    return data.version === LIBRARY_VERSION && typeof data.lastOpenedId === "string"
      ? data.lastOpenedId
      : null;
  } catch {
    // 無くても壊れていても、最後に開いた楽譜が分からないだけで困らない
    return null;
  }
}

export async function rememberLastOpened(id: string): Promise<void> {
  await getTextStore().write(
    LIBRARY_FILE,
    `${JSON.stringify({ version: LIBRARY_VERSION, lastOpenedId: id }, null, 2)}\n`,
  );
}

/**
 * #4 の単一ファイルをライブラリの 1 件目へ移す。
 * 壊れていたら退避だけして、そのことを返す。
 */
async function migrateLegacyFile(): Promise<string | null> {
  const store = getTextStore();
  const text = await store.read(LEGACY_FILE);
  if (text === null) {
    return null;
  }
  let score: Score;
  try {
    score = readScoreFile(text).score;
  } catch (error) {
    await store.write(LEGACY_BROKEN_FILE, text);
    await store.remove(LEGACY_FILE);
    return `前に保存した楽譜が壊れていたため、読み込めませんでした。元のファイルは ${LEGACY_BROKEN_FILE} に退避しました。\n${describeError(error)}`;
  }
  const id = await addScore(score);
  await rememberLastOpened(id);
  // 移し終えてから消す (途中で失敗しても元のファイルは残る)
  await store.remove(LEGACY_FILE);
  return null;
}

export interface OpenedScore {
  id: string;
  score: Score;
  /** 開きたかった楽譜を開けなかったときの説明 */
  error?: string;
}

let opening: Promise<OpenedScore> | null = null;

/**
 * 起動時に開く楽譜を決める。
 *
 * 前回開いていた楽譜を開く。無ければ最近保存したもの、それも無ければ
 * サンプルを新しく足して開く。壊れた楽譜は開かず一覧に残す (上書き
 * しないように)。
 *
 * 走っている間にもう一度呼ばれたら、同じ結果を返す。React の開発時の
 * 二重実行などで同時に 2 回走ると、#4 の楽譜を二重に移してしまうため。
 */
export function openLibrary(): Promise<OpenedScore> {
  opening ??= openLibraryOnce().finally(() => {
    opening = null;
  });
  return opening;
}

async function openLibraryOnce(): Promise<OpenedScore> {
  const errors: string[] = [];
  try {
    const migrationError = await migrateLegacyFile();
    if (migrationError !== null) {
      errors.push(migrationError);
    }
  } catch (error) {
    errors.push(`前に保存した楽譜を移せませんでした。\n${describeError(error)}`);
  }

  const lastOpened = await readLastOpened();
  const entries = await listScores();
  const readable = entries.filter((e) => e.broken === undefined);
  const last = entries.find((e) => e.id === lastOpened);
  if (last?.broken !== undefined) {
    errors.push(
      `前回開いていた楽譜が壊れていたため、開けませんでした (一覧には残しています)。\n${last.broken}`,
    );
  }

  const chosen = readable.find((e) => e.id === lastOpened) ?? readable[0];
  let opened: OpenedScore;
  if (chosen === undefined) {
    opened = { id: await addScore(sampleScore), score: sampleScore };
  } else {
    opened = { id: chosen.id, score: await readScore(chosen.id) };
  }
  await rememberLastOpened(opened.id);
  return errors.length > 0 ? { ...opened, error: errors.join("\n\n") } : opened;
}
