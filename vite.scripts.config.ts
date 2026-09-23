import { defineConfig } from "vite";

// pnpm check や OMR の開発用スクリプトを Node 向けにまとめるときの設定。
// public/ (音源や OMR のモデル) を出力先へ写す必要は無い
export default defineConfig({
  publicDir: false,
  logLevel: "error",
});
