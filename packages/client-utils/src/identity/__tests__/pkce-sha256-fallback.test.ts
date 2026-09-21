/**
 * D17/R1 — PKCE must work in insecure contexts (plain-HTTP non-loopback, e.g.
 * a tailnet IP), where `crypto.subtle` is undefined. The pure-JS SHA-256
 * fallback must be FIPS 180-4-correct and byte-identical to WebCrypto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveCodeChallenge, sha256Bytes } from "../pkce.js";

const hex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("sha256Bytes — FIPS 180-4 known-answer vectors", () => {
  it("empty message", () => {
    expect(hex(sha256Bytes(enc("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("'abc'", () => {
    expect(hex(sha256Bytes(enc("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("448-bit two-block message", () => {
    expect(hex(sha256Bytes(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("padding boundaries (55/56/64 bytes) match WebCrypto", async () => {
    for (const n of [55, 56, 63, 64, 65]) {
      const msg = new Uint8Array(n).fill(0x61);
      const ref = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
      expect(hex(sha256Bytes(msg))).toBe(hex(ref));
    }
  });

  it("parity with WebCrypto on random inputs", async () => {
    for (let i = 0; i < 8; i++) {
      const msg = crypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 200)));
      const ref = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
      expect(hex(sha256Bytes(msg))).toBe(hex(ref));
    }
  });
});

describe("deriveCodeChallenge without crypto.subtle (insecure context)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to pure-JS SHA-256 and still matches the RFC 7636 vector", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
      subtle: undefined,
    });
    expect(globalThis.crypto.subtle).toBeUndefined();
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await deriveCodeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
