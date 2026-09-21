import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// iOS/Android の実機・シミュレータ開発時に tauri が注入する
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  // tauri の出力を消さないようにする
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Rust 側の変更で Vite が再読み込みしないように
      ignored: ["**/src-tauri/**"],
    },
  },
});
