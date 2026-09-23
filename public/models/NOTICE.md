# OMR のモデルについて

楽譜の画像を読み取る (#2) ための画像分割モデル。oemer
(https://github.com/BreezeWhite/oemer、作者 BreezeWhite) が配っている
学習済みモデルを使っている。

- ライセンス: MIT License (oemer のリポジトリの LICENSE。著作権表示の
  年と名前は空欄のまま配られている)
- 入手先: https://github.com/BreezeWhite/oemer/releases/tag/checkpoints
- 学習データ (oemer の README による):
  - 1 つ目のモデル: CvcMuscima-Distortions
    (http://pages.cvc.uab.es/cvcmuscima/index_database.html)
  - 2 つ目のモデル: DeepScores-extended (https://zenodo.org/record/4012193)

合わせて 100MB を超えるので git には入れていない。`pnpm omr:models` で
取ってきて、このディレクトリに置く。

| ファイル | 元のファイル | 中身 |
|---|---|---|
| `oemer-staff.onnx` | `1st_model.onnx` | 五線と、それ以外の記号を分ける (入力 256×256) |
| `oemer-symbols.onnx` | `2nd_model.onnx` | 記号を 符幹・休符 / 符頭 / 音部記号・調号 に分ける (入力 288×288) |

`oemer-staff.onnx` だけ手を入れている。TensorFlow から変換されたときに
pads が負の ConvTranspose ができており、onnxruntime 1.18 以降は読み
込めないため、同じ計算になる output_padding に移した
(`scripts/omr/patch-onnx.mjs`)。どちらのファイルも、元と直したあとの
SHA-256 を `scripts/omr/fetch-models.mjs` で確かめている。
