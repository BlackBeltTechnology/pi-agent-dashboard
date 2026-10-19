/**
 * Pure-JS SHA-1 (hex) over bytes. `crypto.subtle` is undefined on the plain-http
 * LAN origin a knock pairs onto (non-secure context), so the handler snapshot
 * bracket hashes with this instead of referencing it (the secure-context scan
 * forbids bare `crypto.subtle` in client bundles). SHA-1 here is a content
 * token compared against the server's `sha1`, not a security primitive.
 *
 * See change: add-editor-pane-file-handlers (D3).
 */

const W = new Int32Array(80);

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc | 0, 0xca62c1d6 | 0];

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** Round function of step `i` (choose / parity / majority / parity). */
function f(i: number, b: number, c: number, d: number): number {
  if (i < 20) return (b & c) | (~b & d);
  if (i >= 40 && i < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

/** Hex SHA-1 of `input` (an `ArrayBuffer` or any `Uint8Array` view). */
export function sha1Hex(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const len = bytes.length;
  const h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0];

  const compress = (b: Uint8Array, o: number): void => {
    for (let i = 0; i < 16; i++, o += 4) W[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    for (let i = 16; i < 80; i++) W[i] = rotl(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
    let [a, bb, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const t = (rotl(a, 5) + f(i, bb, c, d) + e + K[(i / 20) | 0] + W[i]) | 0;
      e = d;
      d = c;
      c = rotl(bb, 30);
      bb = a;
      a = t;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + bb) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
  };

  const full = len - (len % 64);
  for (let o = 0; o < full; o += 64) compress(bytes, o);

  // Tail: remaining bytes, 0x80, zero pad, 64-bit big-endian bit length.
  const rem = len - full;
  const tail = new Uint8Array(rem < 56 ? 64 : 128);
  tail.set(bytes.subarray(full));
  tail[rem] = 0x80;
  const bits = len * 8;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(tail.length - 4, bits % 0x100000000);
  for (let o = 0; o < tail.length; o += 64) compress(tail, o);

  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
