/**
 * `sha1Hex` — SHA-1 of bytes with a pure-JS fallback for non-secure contexts
 * (`crypto.subtle` is undefined on plain-http LAN origins).
 * See change: add-editor-pane-file-handlers (D3 snapshot token).
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha1Hex, sha1HexSync } from "../sha1.js";

const buf = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const ref = (b: ArrayBuffer): string => createHash("sha1").update(Buffer.from(b)).digest("hex");

afterEach(() => vi.unstubAllGlobals());

describe("sha1Hex", () => {
  it("matches node sha1 for empty, short and multi-block inputs (sync fallback)", () => {
    for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)]) {
      expect(sha1HexSync(buf(s))).toBe(ref(buf(s)));
    }
  });

  it("matches node sha1 for random binary bytes", () => {
    const u = new Uint8Array(4099).map((_, i) => (i * 31 + 7) & 0xff);
    const b = u.buffer as ArrayBuffer;
    expect(sha1HexSync(b)).toBe(ref(b));
  });

  it("uses crypto.subtle when present and the fallback when absent", async () => {
    expect(await sha1Hex(buf("hello"))).toBe(ref(buf("hello")));
    vi.stubGlobal("crypto", {});
    expect(await sha1Hex(buf("hello"))).toBe(ref(buf("hello")));
  });
});
