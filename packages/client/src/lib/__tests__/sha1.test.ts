import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha1Hex } from "../util/sha1.js";

const ref = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");

describe("sha1Hex", () => {
  it("matches node:crypto for padding boundaries and a large buffer", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
      expect(sha1Hex(b), `len ${n}`).toBe(ref(b));
    }
  });
  it("accepts an ArrayBuffer and a subarray view", () => {
    const b = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(sha1Hex(b.buffer)).toBe(ref(b));
    expect(sha1Hex(b.subarray(2, 5))).toBe(ref(b.subarray(2, 5)));
  });
  it("hashes the empty input", () => {
    expect(sha1Hex(new Uint8Array())).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
});
