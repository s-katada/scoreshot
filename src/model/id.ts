/**
 * 音符や小節に振る id。
 *
 * 楽譜の中で重複しなければよく、意味は持たせない。描画した音符とモデルを
 * 対応づけたり、選択を覚えておいたりするのに使う。
 */
export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
