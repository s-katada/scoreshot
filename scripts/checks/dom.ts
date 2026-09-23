/**
 * Node には DOMParser が無いので xmldom で代わりにする。
 * MusicXML の読み込み (ブラウザでは本物の DOMParser を使う) の検証用。
 *
 * 壊れた XML を渡す検証もするので、xmldom がコンソールに出す警告は黙らせる。
 */
import { DOMParser } from "@xmldom/xmldom";

class QuietDOMParser extends DOMParser {
  constructor() {
    super({ onError: () => {} });
  }
}

(globalThis as unknown as { DOMParser: unknown }).DOMParser = QuietDOMParser;
