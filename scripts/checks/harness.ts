/**
 * pnpm check の小さな検証の枠組み。
 *
 * テストフレームワークは入れていない。見た目では確認できない部分
 * (和音が同時刻か、付点の長さ、保存形式の往復など) を項目ごとに確かめて
 * OK / NG を並べるだけ。
 */

let failures = 0;

export function section(title: string): void {
  console.log(`\n# ${title}`);
}

export function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? "OK  " : "NG  "} ${label}${detail ? "  " + detail : ""}`);
}

/** fn が例外を投げること (と、そのメッセージに expected が含まれること) */
export function checkThrows(
  label: string,
  fn: () => unknown,
  expected?: string,
): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ok = expected === undefined || message.includes(expected);
    check(label, ok, message.split("\n").join(" / "));
    return;
  }
  check(label, false, "例外が出なかった");
}

export function finish(): void {
  console.log(failures === 0 ? "\n全項目 OK" : `\n${failures} 件 NG`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}
