# 手を入れた依存クレート

`Cargo.toml` の `[patch.crates-io]` で、crates.io の版の代わりにここにあるものを使っている。

## tao 0.35.3 (`tao/`)

iOS 27 SDK でビルドすると画面が出ない問題 (#7) を直すため、tao 0.37.0 の UIScene 対応を 0.35.3 に持ち込んだもの。Tauri 2 系 (tauri-runtime-wry 2.11) は `tao ^0.35` を要求していて、直った 0.37 を使えないため。

- 元: crates.io の tao 0.35.3 (Apache-2.0、`tao/LICENSE`)。`examples/` は持ってきておらず、`Cargo.toml` からも例を外した
- 変えたのは `src/platform_impl/ios/` の `app_state.rs`・`scene.rs`・`view.rs` だけで、変えた所には `// scoreshot:` と書いてある。macOS などほかの環境のコードは 0.35.3 のまま
- 持ち込んだもの (tao 0.37.0 の同じファイルから):
  - `UIApplicationSceneManifest` があればシーンのライフサイクルとみなす (0.35.3 は `UIApplicationSupportsMultipleScenes` が true のときだけで、false のアプリではウィンドウがシーンにつながらず画面が出なかった)
  - ウィンドウを作るとき必ずシーンにつなぐ。まだシーンが無ければ覚えておき、最初につながったシーンが引き取る
  - シーンの設定を問われたら常に答え、シーンのデリゲート (`TaoSceneDelegate`) を実行時に割り当てる。返す設定は autorelease する (0.35.3 は関数の終わりで解放していた)
  - `TaoSceneDelegate` のクラスを起動の前に登録する
  - 画面から外れている間のレイアウトで落ちないようにする
- 持ち込まなかったもの: 0.37.0 で `Suspended` / `Resumed` をウィンドウごとの `WindowEvent` に変えた所 (tauri-runtime-wry 2 系が受けるのは `Event::Suspended` / `Event::Resumed` なので)。代わりに、シーンのライフサイクルでは呼ばれない `applicationWillResignActive:` などの代わりとして、シーンのデリゲートから `Event::Suspended` / `Event::Resumed` を出す

`cargo check --target aarch64-apple-ios` / `aarch64-apple-ios-sim` が通ることは確かめた。iOS のシミュレータ・実機では確かめていない。

### 消すとき

Tauri 2 系が tao 0.37 以降を使うようになったら、`Cargo.toml` の `[patch.crates-io]` とこのディレクトリを消し、`cargo update -p tao` する。
