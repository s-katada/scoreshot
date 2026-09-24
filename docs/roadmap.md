# ロードマップと引き継ぎメモ

作業を引き継ぐ人・AI はまずこれを読むこと。個別の仕様は各 issue にある(もとは issue #9 に置いていたもの)。

## このアプリは何か

**ピアノ譜のエディタ**(macOS / iPadOS / iOS)。空の五線譜から手で書けて、編集でき、そのまま再生できる。加えて紙の楽譜を取り込む手段として OMR を持つ。

**OMR は入力手段のひとつであって、アプリの前提ではない。** 認識精度は原理的に 100% にならないので、本体は「編集できる楽譜エディタ」であり、OMR はその入口という位置づけ。

配布は自分用・身内向け。App Store 公開はしないので、審査対策・プライバシーポリシー等は不要。

## 設計の背骨

```
 [画像 / カメラ]      [新規作成 (#11)]     [MusicXML ファイル]
     │ OMR (#2)             │                  │ 読み込み (#5)
     ▼                      ▼                  ▼
 ┌─────────────────┐
 │ Score (データモデル) │ ◄── 真実の情報源。Undo/Redo もここ
 └─────────────────┘      保存: 楽譜ライブラリ (#4 #6)
     │          │        ▲       書き出し: MusicXML / MIDI (#5)
     │ 描画      │ 再生    │ 編集 (#3 #10 #11 #13)
     ▼          ▼        │
   OSMD      Tone.js   パレット UI / キーボード
```

**`src/model/score.ts` の `Score` が唯一の真実の情報源。** OSMD には状態を持たせず、描き直すだけの存在として扱う。再生も MusicXML ではなく `Score` から直接組み立てる。OMR も MusicXML を経ずに `Score` を組み立てる。この原則を崩さないこと。

## 今動いているもの(2026-09-23)

| | |
|---|---|
| 楽譜の表示 | OSMD。選択中の音・入力カーソル・置く前の音の影を重ねる |
| 編集(#3) | 入力モード(五線をタップして置く)と選択モード。音価・付点・休符・和音・高さの上下・オクターブ・削除・小節の追加と削除。Undo / Redo |
| 臨時記号と調号(#10) | ♯ ♭ ♮ の付け外し。どこに表示するかは調号と小節の中の状態から決める |
| 基本情報・新規作成(#11) | タイトル・調号・拍子・テンポの編集。空の楽譜から作る |
| キーボード(#13) | A〜G で音、数字で音価、`.` で付点、`0` で休符、矢印・Delete・⌘Z / ⇧⌘Z・Space(再生)・Esc |
| 保存(#4)・楽譜一覧(#6) | AppData に自動保存。一覧から開く・複製・名前の変更・削除 |
| 入出力(#5) | MusicXML(.musicxml / .xml / .mxl)の読み込みと書き出し、MIDI の書き出し |
| 再生(#12) | Salamander Grand Piano の実音サンプル(2MB 同梱)。一時停止・再開、選んだ音から再生、再生位置の縦線 |
| OMR(#2) | 画像ファイルかカメラから読み取り、新しい楽譜として足す。1 ページ 1 分ほど。認識率などは #2 のコメントと `scripts/omr/README.md` |
| iOS の表示(#7) | iOS 27 の UIScene 必須化で画面が出なかったのを、tao 0.37 の修正を持ち込んで直した(`src-tauri/patches/`) |
| iOS の消音スイッチ(#8) | 入っていても鳴るよう、アプリ(AVAudioSession)とページ(Audio Session API)の両方で「再生」にした |

**確かめたのは、この環境(Linux のコンテナ)のブラウザ(Chromium)と、iOS 向けの `cargo check` まで。** macOS のアプリ・iOS のシミュレータや実機では確かめていない(下の「次にやること」)。

## 進み具合

```
#4 ローカル保存             ✅
#3 編集                     ✅
  ├ #11 基本情報・空の楽譜   ✅
  └ #10 臨時記号と調号       ✅
#5 MusicXML/MIDI 入出力     ✅
#2 OMR                      ✅
#12 途中からの再生・一時停止 ✅
#13 キーボード入力           ✅
#6 楽譜ライブラリ            ✅
#7 iOS 表示                  ✅(tao の修正の持ち込み)
#8 iOS マナーモード対策      ✅
```

## 次にやること

実機が要るので、この環境では確かめられなかったもの。

1. **macOS のアプリで動かす**: 保存先(AppData)、MusicXML / MIDI のダイアログ、OMR の速さ(`crossOriginIsolated` が true になり、4 スレッドで動いているか。false だと 4 倍ほど遅い)、カメラの許可のダイアログ
2. **本物の楽譜の写真で OMR を試す**: 認識率は作った楽譜でしか測っていない
3. **iOS のシミュレータで画面が出るか**(#7)。出たら、**実機で消音スイッチを入れても鳴るか**(#8)
4. Tauri 2 系が tao 0.37 以降に上がったら、`src-tauri/patches/tao` と `Cargo.toml` の `[patch.crates-io]` を消す(`src-tauri/patches/README.md`)

## 開発環境

nix + direnv。`cd` すれば dev シェルに入る。

```
cargo tauri dev                    # 開発(HMR あり)
pnpm build                         # OMR のモデルを取ってくる(初回だけ 104MB)+ 型チェック + フロントのビルド
pnpm check                         # 見た目では確かめにくい所の検証(163 項目)
cargo tauri build --debug --no-bundle   # macOS アプリのビルド
```

OMR のモデルは git に入れていない(`pnpm omr:models` で `public/models/` に置く。`pnpm dev` / `pnpm build` が最初に走らせる)。認識率の測り方と開発用の道具は `scripts/omr/README.md`。

iOS ビルドは `cargo tauri ios build --target aarch64-sim --debug`。**必ず `nix develop` 経由で叩くこと**(直接叩くと Apple のツールチェーンが nix に覆われる)。

## 触るときに壊しやすいところ

実際に踏んで直した罠。理由を確認せずに戻さないこと。

- **OSMD インスタンスは一度だけ生成する。** 楽譜が変わるたびに作り直すと、前のインスタンスの要素と `autoResize` の監視が積み上がってレイアウトが壊れる(#1)。`load()` + `render()` で読み直すこと
- **OSMD の描画先に `isolate` を効かせてある。** 外すと再生カーソル(`z-index: -1`)が白背景の裏に隠れて見えなくなる
- **再生カーソルの寸法をインラインスタイルで当て直している。** Tailwind の preflight が `img { height: auto }` を当てるため、OSMD が height 属性で与える縦線が 1px に潰れる
- **`osmd.cursor` は `render()` が走るまで存在しない。** 描画前に触ると例外でアプリが白画面になる
- **nix の devShell は Apple のツールチェーンを覆い隠す。** `xcrun` が 2019 年製スタブに、`DEVELOPER_DIR` / `SDKROOT` が nix の SDK に奪われる。`flake.nix` の shellHook で打ち消してあるので、シェル外で叩くときは `/usr/bin/xcrun` を使うこと
- **編集は `src/model/edit.ts` の関数を通す。** 各段が小節をちょうど埋める(休符で詰め直す)のが不変条件で、`Score` を直接いじると再生や書き出しがずれる
- **楽譜を切り替える前に自動保存を `flush()` する。** しないと自動保存の待ち時間(300ms)の間にした編集が失われる
- **COOP/COEP のヘッダを外さない**(`vite.config.ts` と `src-tauri/tauri.conf.json`)。OMR の推論(onnxruntime-web)が 1 スレッドになり、4 倍ほど遅くなる
- **OMR の Worker は ES モジュールで出す**(`vite.config.ts` の `worker.format`)。onnxruntime-web は自分のファイルの URL からスレッドの Worker を作るので、別のチャンクに分かれている必要がある
- **tao は手元で直したものを使っている**(`src-tauri/patches/tao`)。Tauri を上げるときは `src-tauri/patches/README.md` を読む。生成済みの iOS の `Info.plist` に `UISceneDelegateClassName` を足さない(tao が実行時に割り当てる)

## コミット方針

**1 コミット = 1 関心事。** マイルストーンをまとめて 1 コミットにしない。メッセージは Conventional Commits + 日本語。
