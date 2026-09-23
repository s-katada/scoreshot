# scoreshot

ピアノ譜のエディタ(macOS / iPadOS / iOS)。空の五線譜から手で書けて、編集でき、そのまま再生できる。紙の楽譜を取り込む OMR は入力手段のひとつという位置づけ(認識精度は原理的に 100% にならないので、本体はあくまでエディタ)。Tauri v2 + React + Vite + Tailwind 4、楽譜描画は OSMD、再生は Tone.js。配布は自分用・身内向けで App Store 公開はしない。

- ツールは flake + direnv 管理。コマンドは direnv 有効シェルか `nix develop --command <cmd>` で実行(`cargo tauri dev` / `pnpm build` / `pnpm check` / `cargo tauri build --debug --no-bundle`)
- **`src/model/score.ts` の `Score` が唯一の真実の情報源**。OSMD には状態を持たせず「MusicXML を渡されたら描き直すだけ」の存在として扱い、再生も MusicXML ではなく `Score` から直接組み立てる
- **OSMD インスタンスは一度だけ生成する**。楽譜が変わるたびに作り直すと前のインスタンスの要素と `autoResize` の監視が積み上がり、コンテナが巨大化して楽譜が画面から消える(#1)。差し替えは `load()` + `render()` で行う
- **OSMD の描画先の `isolate` を外さない**。再生カーソルは `z-index: -1` で描かれるため、外すと楽譜の白背景の裏に回り込んで見えなくなる
- **再生カーソルの寸法はインラインスタイルで当て直している**。Tailwind の preflight が `img { height: auto }` を当てるので、OSMD が height 属性で与える縦線が 1px に潰れる。CSS では属性値に戻せないため JS で当てるしかない
- `osmd.cursor` は `render()` が走るまで存在しない。描画前に触ると例外が飛んでアプリが白画面になる
- **nix の devShell は Apple のツールチェーンを覆い隠す**。`xcrun` が 2019 年製スタブに、`DEVELOPER_DIR` / `SDKROOT` が nix の SDK に奪われる。`flake.nix` の shellHook で打ち消しているので、iOS 関連は必ず `nix develop` 経由で叩く(シェル外から使うときは `/usr/bin/xcrun`)
- iOS はビルド・起動・フロントエンド読み込みまで通るが**画面が出ない**(iOS 27 の UIScene 必須化に wry/tao が未対応 / #7)。上流待ちなので動作確認は macOS で行う
- Xcode のビルドスクリプトは環境が消毒されて nix の変数も PATH も届かないため、`src-tauri/gen/apple/project.yml` で `nix develop` に入り直している。`gen/apple` を消して再生成するとこの修正が失われる
- ピアノ音源は `public/samples/piano/` に 2MB 同梱(Salamander Grand Piano / CC-BY 3.0)。音色の差し替え口は `src/audio/player.ts` の `loadInstrument()` に閉じてある
- 編集は `src/model/edit.ts` の関数で行い、どれも新しい `Score` を返す(元は変えない)。**各段は小節をちょうど埋める**(音を置いたり消したりしたら休符で詰め直す)のが不変条件。Undo/Redo は `Score` のスナップショットを積む(`src/state/useHistory.ts`)
- モデルには実際の音高だけを持つ。♯♭♮ をどこに表示するかは MusicXML に書き出すときに、調号と小節の中で先に付いたものから決める(`src/model/accidentals.ts`)
- 楽譜は AppData の `scores/<id>.json` と一覧の `library.json` に保存する(ブラウザで開いたときは localStorage の `scoreshot:` の下)。書き込みは `.tmp` に書いてから rename。**開いている楽譜を切り替える前に自動保存を `flush()` する**。しないと自動保存の待ち時間(300ms)の間にした編集が失われる
- OMR(`src/omr/`)は、画像 → 紙の地を白に揃える → 線の間隔を 13.5px に揃える → oemer の 2 つの画像分割モデル → 後処理(`recognize.ts`、自前)→ `Score`。モデルは onnxruntime-web の WASM で、画面を塞がないよう Web Worker(`omr.worker.ts`)で動かす。後処理の詳しい流れと認識率の測り方は `scripts/omr/README.md`
- **OMR のモデル(104MB)は git に入れていない。** `pnpm omr:models` で `public/models/` に置く(`pnpm build` が最初に走らせる)。アプリの実行ファイルに埋め込まれ、約 103MB 増える
- **COOP/COEP のヘッダを外さない**(`vite.config.ts` と `src-tauri/tauri.conf.json`)。onnxruntime-web が複数スレッドで動くのに cross-origin isolation が要り、無いと 1 スレッドになって読み取りが 4 倍ほど遅くなる。外のリソースを読むものを足すときは COEP で止められないか確かめる
- **Worker は ES モジュールで出す**(`vite.config.ts` の `worker.format`)。onnxruntime-web は自分のファイルの URL からスレッドの Worker を作るので、別のチャンクに分かれている必要がある
- カメラの利用目的の文は `src-tauri/Info.plist`(macOS)と `src-tauri/Info.ios.plist`(iOS)の `NSCameraUsageDescription`。WebView 側の許可は wry が自動で与える
- `pnpm check` は見た目では確認できない部分の検証(和音が同時刻か、付点の長さ、MusicXML の `<backup>` が上段の長さと一致するか、保存形式や MusicXML / MIDI の往復、OMR の後処理など)。OMR はモデルを使わず、モデルの出力を段 1 つぶん保存したもの(`scripts/fixtures/omr/`)で確かめる。テストフレームワークは入れていない
- 作業の現在地・着手順・各機能の仕様は issue にある。まず #9(ピン留め)を読む
- コミットは1関心=1コミットの細粒度(Conventional Commits + 日本語メッセージ)。マイルストーンをまとめて1コミットにしない
