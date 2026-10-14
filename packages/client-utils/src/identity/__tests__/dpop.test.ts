import { afterEach, describe, expect, it, vi } from "vitest";
import { createDpopProof, type DpopKey, generateDpopKey, isDpopAvailable, isDpopBound } from "../dpop.js";

function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

/** WebCrypto is present in the test env; `generateDpopKey` resolving null here is a bug. */
async function mustGenerateKey(): Promise<DpopKey> {
  const key = await generateDpopKey();
  if (!key) throw new Error("DPoP unexpectedly unavailable");
  return key;
}

describe("isDpopBound (§12.5 — conditional)", () => {
  it("true only when the token response carries a non-empty cnf.jkt", () => {
    expect(isDpopBound({ cnf: { jkt: "thumb" } })).toBe(true);
    expect(isDpopBound({ cnf: { jkt: "" } })).toBe(false);
    expect(isDpopBound({ cnf: {} })).toBe(false);
    expect(isDpopBound({})).toBe(false); // unbound ⇒ no proof path
  });
});

describe("DPoP proof (§12.5, RFC 9449)", () => {
  it("generates a NON-extractable ES256 keypair exposing only public coords", async () => {
    const key = await mustGenerateKey();
    expect(key.keyPair.privateKey.extractable).toBe(false);
    expect(key.publicJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(key.publicJwk.x).toBeTruthy();
    expect(key.publicJwk.y).toBeTruthy();
    expect(key.publicJwk).not.toHaveProperty("d"); // private scalar never exported
  });

  it("mints a verifiable proof binding htm/htu, with a fresh jti per call", async () => {
    const key = await mustGenerateKey();
    const p1 = await createDpopProof(key, "post", "https://dash.example/api/ws-ticket", "n0");
    const [h, pl, sig] = p1.split(".");
    expect(decodeSegment(h!)).toMatchObject({ typ: "dpop+jwt", alg: "ES256" });
    const payload = decodeSegment(pl!);
    expect(payload).toMatchObject({ htm: "POST", htu: "https://dash.example/api/ws-ticket", nonce: "n0" });
    expect(payload.jti).toBeTruthy();
    expect(sig).toBeTruthy();

    // Signature verifies against the exported public key (proof is genuine).
    const pub = await crypto.subtle.importKey(
      "jwk",
      key.publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const [sh, spl, ssig] = p1.split(".");
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      Uint8Array.from(atob(ssig!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(`${sh}.${spl}`),
    );
    expect(ok).toBe(true);

    // A second proof for the same request has a DIFFERENT jti (never reused).
    const p2 = await createDpopProof(key, "post", "https://dash.example/api/ws-ticket", "n0");
    expect(decodeSegment(p2.split(".")[1]!).jti).not.toBe(payload.jti);
  });

  it("omits the nonce claim when the server supplied none", async () => {
    const key = await mustGenerateKey();
    const proof = await createDpopProof(key, "get", "https://dash.example/api/sessions");
    expect(decodeSegment(proof.split(".")[1]!)).not.toHaveProperty("nonce");
  });
});

describe("DPoP in a non-secure context (crypto.subtle undefined) — E31", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports unavailable and resolves null instead of throwing a TypeError", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real), subtle: undefined });
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(isDpopAvailable()).toBe(false);
    await expect(generateDpopKey()).resolves.toBeNull();
  });

  it("reports available when crypto.subtle exists", () => {
    expect(isDpopAvailable()).toBe(true);
  });
});
