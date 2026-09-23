/**
 * 開発用: きれいな楽譜の画像を、スマートフォンで撮った写真のように崩す。
 * 写真での認識率を、正解の分かっている楽譜で測るために使う。
 *
 *   pnpm omr:degrade <入力.png> <出力.png> [傾き(度)] [倍率] [乱数の種]
 *
 * 傾け、斜めから撮ったように台形に歪め、縮め、照明のむらと紙の色を
 * 付け、ぼかしてノイズを乗せる。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { rgbaToGray } from "../../src/omr/image";
import { decodePng, encodePngRgb } from "./png";

const [input, output, angleText, scaleText, seedText] = process.argv.slice(2);
const angle = (Number(angleText ?? 1.2) * Math.PI) / 180;
const scale = Number(scaleText ?? 0.6);

let seed = Number(seedText ?? 1) >>> 0;
function random(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gaussian(): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

type Matrix = number[]; // 3×3 を行の順に

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return out;
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const png = decodePng(new Uint8Array(readFileSync(input)));
const source = rgbaToGray(png.data, png.width, png.height);
const { width: w, height: h } = source;

// 元の画像 → 出力の画像への写像: 中心で回す → 台形に歪める → 縮める
const toCenter: Matrix = [1, 0, -w / 2, 0, 1, -h / 2, 0, 0, 1];
const rotate: Matrix = [Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle), 0, 0, 0, 1];
const keystone: Matrix = [1, 0, 0, 0, 1, 0, 0.03 / w, 0.02 / h, 1];
const back: Matrix = [scale, 0, (w * scale) / 2, 0, scale, (h * scale) / 2, 0, 0, 1];
const inverse = invert(multiply(back, multiply(keystone, multiply(rotate, toCenter))));

const width = Math.round(w * scale);
const height = Math.round(h * scale);
let image = new Float32Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const z = inverse[6] * x + inverse[7] * y + inverse[8];
    const sx = (inverse[0] * x + inverse[1] * y + inverse[2]) / z;
    const sy = (inverse[3] * x + inverse[4] * y + inverse[5]) / z;
    let value = 255;
    if (sx >= 0 && sy >= 0 && sx < w - 1 && sy < h - 1) {
      // 縮めるので、周りの 2×2 画素の平均で近似する (本当は面積平均がよい)
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const tx = sx - x0;
      const ty = sy - y0;
      const p = (xx: number, yy: number) => source.data[yy * w + xx];
      value =
        p(x0, y0) * (1 - tx) * (1 - ty) +
        p(x0 + 1, y0) * tx * (1 - ty) +
        p(x0, y0 + 1) * (1 - tx) * ty +
        p(x0 + 1, y0 + 1) * tx * ty;
    }
    // 照明のむら (右下ほど暗い) と、わずかに黄ばんだ紙
    const light = 0.92 - 0.2 * ((x / width) * 0.6 + (y / height) * 0.4);
    image[y * width + x] = (value / 255) * 232 * light;
  }
}

// ぼかす (横と縦に分けたガウスぼかし)
const sigma = 0.9;
const radius = Math.ceil(sigma * 3);
const kernel = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
const total = kernel.reduce((s, v) => s + v, 0);
for (const horizontal of [true, false]) {
  const next = new Float32Array(image.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
        const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
        sum += image[yy * width + xx] * kernel[k + radius];
      }
      next[y * width + x] = sum / total;
    }
  }
  image = next;
}

const rgb = new Uint8Array(width * height * 3);
for (let i = 0; i < image.length; i++) {
  const v = Math.max(0, Math.min(255, Math.round(image[i] + gaussian() * 6)));
  rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
}
writeFileSync(output, encodePngRgb(width, height, rgb));
console.log(`${output}: ${width}×${height}`);
