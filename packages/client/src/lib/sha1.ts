/**
 * SHA-1 of bytes as lower-case hex — the content token the handler snapshot is
 * judged by (server hashes with `createHash("sha1")`). Uses `crypto.subtle`
 * when available; falls back to a pure-JS implementation because the dashboard
 * is also served over plain http (LAN), where `crypto.subtle` is undefined.
 *
 * See change: add-editor-pane-file-handlers (D3).
 */

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

/** SHA-1 round function + constant for step `i`. */
function round(i: number, b: number, c: number, d: number): [number, number] {
  if (i < 20) return [(b & c) | (~b & d), 0x5a827999];
  if (i < 40) return [b ^ c ^ d, 0x6ed9eba1];
  if (i < 60) return [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
  return [b ^ c ^ d, 0xca62c1d6];
}

/** Pure-JS SHA-1 (RFC 3174) over `bytes`. */
export function sha1HexSync(bytes: ArrayBuffer): string {
  const src = new Uint8Array(bytes);
  const len = src.length;
  // Message + 0x80 + zero pad + 64-bit big-endian bit length, in 64-byte blocks.
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(src);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
  dv.setUint32(padded.length - 4, (len << 3) >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] = round(i, b, c, d);
      const tmp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4);
}

/** SHA-1 hex of `bytes` (`crypto.subtle` when present, else the JS fallback). */
export async function sha1Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-1", bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha1HexSync(bytes);
}
