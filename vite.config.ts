import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// iOS/Android の実機・シミュレータ開発時に tauri が注入する
const host = process.env.TAURI_DEV_HOST;

// OMR の推論 (onnxruntime-web) を複数スレッドで動かすのに SharedArrayBuffer が要り、
// それには cross-origin isolation が要る。アプリ側は tauri.conf.json で同じ
// ヘッダを付けている
const CROSS_ORIGIN_ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // tauri の出力を消さないようにする
  clearScreen: false,

  // OMR の Worker (src/omr/omr.worker.ts) は onnxruntime-web を動的に読み込む。
  // 既定の iife では 1 つのファイルに固められないので ES モジュールにする
  worker: {
    format: "es",
  },

  server: {
    port: 1420,
    strictPort: true,
    headers: CROSS_ORIGIN_ISOLATION,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Rust 側の変更で Vite が再読み込みしないように
      ignored: ["**/src-tauri/**"],
    },
  },

  // ビルドしたものをブラウザで確かめるとき (pnpm preview) も同じにする
  preview: {
    headers: CROSS_ORIGIN_ISOLATION,
  },
});
