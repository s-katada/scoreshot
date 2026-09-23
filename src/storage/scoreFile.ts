/**
 * 楽譜の保存形式。
 *
 * Score をそのまま JSON にし、形式のバージョン番号を添える:
 *
 *   { "version": 1, "score": { ...Score } }
 *
 * Score のスキーマは今後変わるので、読み込み時には必ず version を見る。
 * 知らないバージョンや壊れたデータは例外にして、呼び出し側に
 * 「読み込めなかった」と伝える (黙って壊れた楽譜を出すより後で困らない)。
 */

import type { Score } from "../model/score";
import { ScoreValidationError, validateScore } from "../model/validate";

export const SCORE_FILE_VERSION = 1;

export class ScoreFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreFileError";
  }
}

export function serializeScore(score: Score): string {
  return `${JSON.stringify({ version: SCORE_FILE_VERSION, score }, null, 2)}\n`;
}

export function parseScoreFile(text: string): Score {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ScoreFileError("JSON として読めない");
  }

  if (typeof data !== "object" || data === null || !("version" in data)) {
    throw new ScoreFileError("バージョン番号が無い");
  }
  const { version } = data as { version: unknown };
  if (version !== SCORE_FILE_VERSION) {
    throw new ScoreFileError(`未知のバージョン (${String(version)})`);
  }

  try {
    return validateScore((data as { score?: unknown }).score);
  } catch (error) {
    if (error instanceof ScoreValidationError) {
      throw new ScoreFileError(`楽譜の中身が壊れている\n${error.message}`);
    }
    throw error;
  }
}
