/**
 * oemer の 1 つ目のモデル (五線と記号の分離) を、今の onnxruntime で
 * 読めるように直す。
 *
 * TensorFlow から変換されたこのモデルには、pads に負の値を持つ
 * ConvTranspose がある (1×1・ストライド 2 の転置畳み込みで、出力を末尾に
 * 1 行・1 列伸ばす意味)。onnxruntime 1.18 以降は負の pads を拒むため
 * 読み込めない。末尾の負の pads は output_padding で同じ計算になるので、
 * pads を 0 にして output_padding に移す。
 *
 * ONNX は protobuf なので、依存を増やさずに済むよう、書き換える所
 * (Model → Graph → Node → Attribute) だけを読み書きする。それ以外の
 * フィールドはバイト列のまま写す。
 */

/** protobuf のフィールドを 1 つずつ読む。値は元のバイト列の範囲で返す */
function* fields(bytes, start = 0, end = bytes.length) {
  let pos = start;
  while (pos < end) {
    const fieldStart = pos;
    const [key, afterKey] = readVarint(bytes, pos);
    pos = afterKey;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let valueStart = pos;
    let valueEnd;
    switch (wire) {
      case 0: {
        [, valueEnd] = readVarint(bytes, pos);
        break;
      }
      case 1:
        valueEnd = pos + 8;
        break;
      case 2: {
        const [length, afterLength] = readVarint(bytes, pos);
        valueStart = afterLength;
        valueEnd = afterLength + Number(length);
        break;
      }
      case 5:
        valueEnd = pos + 4;
        break;
      default:
        throw new Error(`未対応の wire type ${wire} (位置 ${fieldStart})`);
    }
    pos = valueEnd;
    yield { field, wire, fieldStart, valueStart, valueEnd, fieldEnd: pos };
  }
}

function readVarint(bytes, pos) {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    const byte = bytes[pos++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [value, pos];
    }
    shift += 7n;
  }
}

function encodeVarint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (v !== 0n);
  return out;
}

function toInt64(value) {
  return BigInt.asIntN(64, value);
}

function lengthDelimited(field, payload) {
  return Uint8Array.from([...encodeVarint((field << 3) | 2), ...encodeVarint(payload.length), ...payload]);
}

function concat(parts) {
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const text = new TextDecoder();

/** AttributeProto を読む (名前と、ints があれば整数の並び) */
function readAttribute(bytes, start, end) {
  let name = "";
  const ints = [];
  for (const f of fields(bytes, start, end)) {
    if (f.field === 1 && f.wire === 2) {
      name = text.decode(bytes.subarray(f.valueStart, f.valueEnd));
    } else if (f.field === 8 && f.wire === 0) {
      ints.push(toInt64(readVarint(bytes, f.valueStart)[0]));
    } else if (f.field === 8 && f.wire === 2) {
      // 詰めて書かれた (packed) ints
      let pos = f.valueStart;
      while (pos < f.valueEnd) {
        const [value, next] = readVarint(bytes, pos);
        ints.push(toInt64(value));
        pos = next;
      }
    }
  }
  return { name, ints };
}

/** ints を持つ AttributeProto を作る (type = INTS) */
function intsAttribute(name, ints) {
  const nameBytes = new TextEncoder().encode(name);
  const parts = [Uint8Array.from([...encodeVarint((1 << 3) | 2), ...encodeVarint(nameBytes.length)]), nameBytes];
  for (const value of ints) {
    parts.push(Uint8Array.from([...encodeVarint((8 << 3) | 0), ...encodeVarint(value)]));
  }
  // AttributeProto.type = INTS (7)
  parts.push(Uint8Array.from([...encodeVarint((20 << 3) | 0), ...encodeVarint(7)]));
  return concat(parts);
}

/** NodeProto を直す。直すところが無ければ null */
function patchNode(bytes, start, end) {
  let opType = "";
  for (const f of fields(bytes, start, end)) {
    if (f.field === 4 && f.wire === 2) {
      opType = text.decode(bytes.subarray(f.valueStart, f.valueEnd));
    }
  }
  if (opType !== "ConvTranspose") {
    return null;
  }

  const parts = [];
  let changed = false;
  let outputPadding = null;
  for (const f of fields(bytes, start, end)) {
    if (f.field === 5 && f.wire === 2) {
      const attribute = readAttribute(bytes, f.valueStart, f.valueEnd);
      if (attribute.name === "pads" && attribute.ints.some((v) => v < 0n)) {
        const half = attribute.ints.length / 2;
        const begin = attribute.ints.slice(0, half);
        const tail = attribute.ints.slice(half);
        if (begin.some((v) => v < 0n)) {
          throw new Error("先頭側の負の pads は output_padding では表せない");
        }
        parts.push(lengthDelimited(5, intsAttribute("pads", [...begin, ...tail.map((v) => (v < 0n ? 0n : v))])));
        outputPadding = tail.map((v) => (v < 0n ? -v : 0n));
        changed = true;
        continue;
      }
      if (attribute.name === "output_padding") {
        throw new Error("output_padding を既に持つ ConvTranspose は想定していない");
      }
    }
    parts.push(bytes.subarray(f.fieldStart, f.fieldEnd));
  }
  if (!changed) {
    return null;
  }
  parts.push(lengthDelimited(5, intsAttribute("output_padding", outputPadding)));
  return concat(parts);
}

/**
 * モデルを直す。直した ConvTranspose の数も返す。
 * @param {Uint8Array} model
 */
export function patchNegativePads(model) {
  let patched = 0;
  const modelParts = [];
  for (const mf of fields(model)) {
    if (mf.field !== 7 || mf.wire !== 2) {
      modelParts.push(model.subarray(mf.fieldStart, mf.fieldEnd));
      continue;
    }
    // GraphProto
    const graphParts = [];
    for (const gf of fields(model, mf.valueStart, mf.valueEnd)) {
      if (gf.field === 1 && gf.wire === 2) {
        const node = patchNode(model, gf.valueStart, gf.valueEnd);
        if (node !== null) {
          graphParts.push(lengthDelimited(1, node));
          patched++;
          continue;
        }
      }
      graphParts.push(model.subarray(gf.fieldStart, gf.fieldEnd));
    }
    modelParts.push(lengthDelimited(7, concat(graphParts)));
  }
  return { model: concat(modelParts), patched };
}
