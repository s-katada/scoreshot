/** 例外を画面に出せる文にする */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
