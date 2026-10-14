/**
 * Display-name sanitising shared by the knock client (device name) and the
 * Electron server windows (peer label, window title).
 *
 * Strips control characters, bidi overrides/isolates and zero-width characters,
 * collapses whitespace, and truncates to a UTF-8 byte budget on a character
 * boundary (never splits a multi-byte sequence).
 *
 * See change: add-electron-server-windows (test-plan E12, E43).
 */

/** Control chars, bidi embeddings/overrides/isolates, zero-width + BOM, line/paragraph separators. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(value: string, maxBytes: number): string {
  // TextEncoder, not Buffer: this runs in the browser knock path too (no Buffer polyfill there).
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = "";
  for (const ch of value) {
    const n = encoder.encode(ch).length;
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += ch;
  }
  return out;
}

/** Remove invisible/bidi characters and collapse whitespace; may return "". */
export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sanitise an untrusted display name. Empty after sanitising → `fallback`.
 * `maxBytes` defaults to 64.
 */
export function sanitizeDisplayName(raw: unknown, fallback: string, maxBytes = 64): string {
  const cleaned = typeof raw === "string" ? truncateUtf8(stripInvisible(raw), maxBytes).trim() : "";
  return cleaned.length > 0 ? cleaned : fallback;
}
