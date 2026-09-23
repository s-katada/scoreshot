# OMR の開発用スクリプト

画像から楽譜を読み取る処理 (`src/omr/`) を詰めるための道具。アプリの動作には要らない。

## 流れ

```
画像 ─ prepareImage ─┬─ 1 つ目のモデル (五線 / 記号) ──┐
  紙の地を白に揃え、   └─ 2 つ目のモデル (符幹・休符 /  ├─ recognize ─ Score
  線の間隔を 13.5px に       符頭 / 音部記号・調号)  ──┘   (後処理)
  揃える
```

- モデルは oemer (MIT) のものをそのまま使う (`public/models/NOTICE.md`)。推論はアプリでもここでも onnxruntime-web の WASM
- 後処理は oemer の Python の実装を移したものではなく、ここで書き起こしたもの。五線・小節線・符頭・符幹・連桁・付点・休符・音部記号・調号・臨時記号を順に拾って `Score` に組み立てる
- モデルを通すのに 1 ページ 1 分ほどかかるので、ラベル画像を書き出しておき、後処理だけを何度も回せるようにしてある

## 認識率を測る

正解の分かっている楽譜を作り、画像にしてから読ませて突き合わせる。

```sh
pnpm omr:models                                   # モデルを public/models/ に置く (初回だけ)
pnpm omr:corpus /tmp/corpus 12                    # 正解 (piece-01.json) と MusicXML を作る
cd /tmp/corpus && for f in piece-*.musicxml; do   # MuseScore で 300dpi の PNG にする (piece-01-1.png ができる)
  mscore3 -r 300 -o "${f%.musicxml}.png" "$f"     # 画面の無い環境では xvfb-run -a mscore3 …
done; cd -
pnpm omr:degrade /tmp/corpus/piece-01-1.png /tmp/photo/piece-01.png 1.2 0.55 1   # 写真のように崩す (任意)
pnpm omr:segment /tmp/corpus/piece-01-1.png /tmp/seg/piece-01                   # モデルに通す (1 分ほど)
pnpm omr:evaluate /tmp/corpus /tmp/seg                                           # 認識率
pnpm omr:evaluate /tmp/corpus /tmp/seg piece-01                                  # 小節ごとの違い
pnpm omr:inspect /tmp/seg/piece-01                                               # 途中経過 (inspect.png も出る)
```

`evaluate` は、正解と読んだ音を「何小節目・どちらの段・いつ・どの高さ」で突き合わせ、再現率 (正解の音のうち読めた割合)・適合率 (読んだ音のうち正しかった割合)・長さまで合っている割合を出す。

## 今の認識率 (2026-09)

| 画像 | 曲数 | 再現率 | 適合率 | 長さまで一致 |
| --- | --- | --- | --- | --- |
| MuseScore で 300dpi にした画像 | 12 | 100.0% | 100.0% | 100.0% |
| それを `omr:degrade` で写真のように崩したもの (傾き 0.8〜1.8°、150〜200dpi 相当) | 4 | 97.3% | 97.3% | 96.1% |

作った楽譜はピアノ大譜表で、右手は旋律と時々の和音・休符・臨時記号、左手は和音と分散和音。装飾音符・連符・複数声部・タイ・スラーは入っていない (読めない)。実際の写真や手書きの楽譜ではもっと下がる。

## pnpm check で使う材料

`pnpm check` は、モデルを使わずに後処理を確かめるため、モデルの出力を段 1 つぶん保存したもの (`scripts/fixtures/omr/`) を読み、正解と突き合わせる。傾きに付いていけるかは、それを 1.5° 傾けて確かめる。後処理を変えたら `pnpm check` と上の認識率の両方を見る。

作り直すとき (モデルや前処理を変えたときなど):

```sh
pnpm omr:fixture /tmp/seg/piece-01 /tmp/corpus/piece-01.json 0 scripts/fixtures/omr/piece-01-system1.bin.gz
```

`piece-01` は `pnpm omr:corpus` の既定の乱数の種 (1) で作ったもの。引数は segment-page の出力・正解・段の番号 (0 から)・出力先。
