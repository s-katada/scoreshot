import { createEmptyScore } from "../../src/model/newScore";
import { sampleScore } from "../../src/model/sample";
import {
  addScore,
  deleteScore,
  listScores,
  openLibrary,
  readScore,
  rememberLastOpened,
  writeScore,
} from "../../src/storage/library";
import { serializeScore } from "../../src/storage/scoreFile";
import { check, section } from "./harness";

section("楽譜ライブラリ");

const key = (name: string) => `scoreshot:${name}`;
const stored = (name: string) => localStorage.getItem(key(name));

async function run() {
  // 何も無ければサンプルを 1 件足して開く
  localStorage.clear();
  const first = await openLibrary();
  check("初回はサンプルを足して開く", first.score.title === sampleScore.title && first.error === undefined && (await listScores()).length === 1);
  check("最後に開いた楽譜を覚える", JSON.parse(stored("library.json") ?? "{}").lastOpenedId === first.id);

  // 同時に 2 回呼ばれても、#4 の楽譜を二重に移さない
  localStorage.clear();
  localStorage.setItem(key("score.json"), serializeScore({ ...sampleScore, title: "二重" }));
  const [x, y] = await Promise.all([openLibrary(), openLibrary()]);
  check("同時に呼んでも移すのは 1 回", x.id === y.id && (await listScores()).length === 1);

  // #4 の単一ファイルはライブラリの 1 件目へ移す
  localStorage.clear();
  const legacy = { ...sampleScore, title: "前の楽譜" };
  localStorage.setItem(key("score.json"), serializeScore(legacy));
  const migrated = await openLibrary();
  check("#4 の楽譜を移して開く", migrated.score.title === "前の楽譜" && migrated.error === undefined);
  check("移したあとは古いファイルを消す", stored("score.json") === null && (await listScores()).length === 1);

  // 壊れた単一ファイルは退避して、サンプルを開く
  localStorage.clear();
  localStorage.setItem(key("score.json"), '{"version":1,"score":{"title":"x"}}');
  const brokenLegacy = await openLibrary();
  check("壊れた #4 の楽譜は退避してサンプル", brokenLegacy.score.title === sampleScore.title && (brokenLegacy.error ?? "").includes("score.broken.json"));
  check("退避したファイルは元のまま", stored("score.broken.json") === '{"version":1,"score":{"title":"x"}}');

  // 一覧は新しく保存した順
  localStorage.clear();
  const a = await addScore({ ...sampleScore, title: "A" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await addScore(createEmptyScore({ title: "B", tempo: 90, fifths: 0, time: { beats: 3, beatType: 4 }, measures: 2 }));
  const listed = await listScores();
  check("一覧は新しい順", listed.map((e) => e.title).join(",") === "B,A", listed.map((e) => e.title).join(","));
  check("一覧に小節数", listed[0].measures === 2);

  // 前回開いていた楽譜を開く
  await rememberLastOpened(a);
  check("前回の楽譜を開く", (await openLibrary()).id === a);

  // 前回の楽譜が壊れていたら、開かずに (上書きもせず) 別の楽譜を開く
  localStorage.setItem(key(`scores/${a}.json`), "{broken");
  const fallback = await openLibrary();
  check("壊れた楽譜は開かない", fallback.id === b && (fallback.error ?? "").includes("壊れていた"));
  check("壊れた楽譜は上書きしない", stored(`scores/${a}.json`) === "{broken");
  const withBroken = await listScores();
  check("壊れた楽譜も一覧に残す", withBroken.some((e) => e.id === a && e.broken !== undefined));

  // 書く・読む・消す
  await writeScore(b, { ...(await readScore(b)), title: "B2" });
  check("書いて読む", (await readScore(b)).title === "B2");
  await deleteScore(a);
  check("消す", !(await listScores()).some((e) => e.id === a));
  check("書きかけの一時ファイルは一覧に出さない", await (async () => {
    localStorage.setItem(key(`scores/${b}.json.tmp`), "x");
    return (await listScores()).length === 1;
  })());
}

await run();
