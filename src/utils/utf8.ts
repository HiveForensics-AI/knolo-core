// src/utils/utf8.ts
// Small, dependency-free UTF-8 encoder/decoder that works in RN/Hermes.

export type TextDecoderLike = { decode: (u8: Uint8Array) => string };
export type TextEncoderLike = { encode: (s: string) => Uint8Array };

export function getTextDecoder(): TextDecoderLike {
  try {
    // eslint-disable-next-line no-new
    const td = new TextDecoder();
    return td;
  } catch {
    return {
      decode: (u8: Uint8Array) => {
        let out = '';
        for (let i = 0; i < u8.length; ) {
          const a = u8[i++];
          if (a < 0x80) {
            out += String.fromCharCode(a);
          } else if ((a & 0xe0) === 0xc0) {
            const b = u8[i++] & 0x3f;
            const cp = ((a & 0x1f) << 6) | b;
            out += String.fromCharCode(cp);
          } else if ((a & 0xf0) === 0xe0) {
            const b = u8[i++] & 0x3f;
            const c = u8[i++] & 0x3f;
            const cp = ((a & 0x0f) << 12) | (b << 6) | c;
            out += String.fromCharCode(cp);
          } else {
            const b = u8[i++] & 0x3f;
            const c = u8[i++] & 0x3f;
            const d = u8[i++] & 0x3f;
            let cp = ((a & 0x07) << 18) | (b << 12) | (c << 6) | d;
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
          }
        }
        return out;
      },
    };
  }
}

export function getTextEncoder(): TextEncoderLike {
  try {
    // eslint-disable-next-line no-new
    const te = new TextEncoder();
    return te;
  } catch {
    return {
      encode: (s: string) => {
        const out: number[] = [];
        for (let i = 0; i < s.length; i++) {
          let cp = s.charCodeAt(i);
          if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
            const next = s.charCodeAt(++i);
            cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
          }
          if (cp < 0x80) out.push(cp);
          else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
          else if (cp < 0x10000)
            out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          else
            out.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f)
            );
        }
        return new Uint8Array(out);
      },
    };
  }
}
