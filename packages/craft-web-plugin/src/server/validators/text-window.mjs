// Bounded byte windows for the text-format validators (D7): at most the first 1 MiB and the last 4 KiB.
// See change: extend-craft-web-to-all-apps.
export const HEAD_MAX = 1024 * 1024;
export const TAIL_MAX = 4 * 1024;

/** Latin-1 text of `bytes[from, to)` (byte-preserving, no decoding errors). */
export const latin1 = (bytes, from, to) => Buffer.from(bytes.subarray(from, to)).toString("latin1");

/** First `n` (≤ HEAD_MAX) bytes as latin-1. */
export const head = (bytes, n = HEAD_MAX) => latin1(bytes, 0, Math.min(bytes.length, n));

/** Last `n` (≤ TAIL_MAX) bytes as latin-1. */
export const tail = (bytes, n = TAIL_MAX) => latin1(bytes, Math.max(0, bytes.length - n), bytes.length);

export const reject = (reason) => ({ ok: false, reason });
export const OK = Object.freeze({ ok: true });
