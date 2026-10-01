import { describe, expect, it } from "vitest";
import { createDpopProof, generateDpopKey, isDpopBound } from "../dpop.js";

function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
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
    const key = await generateDpopKey();
    expect(key.keyPair.privateKey.extractable).toBe(false);
    expect(key.publicJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(key.publicJwk.x).toBeTruthy();
    expect(key.publicJwk.y).toBeTruthy();
    expect(key.publicJwk).not.toHaveProperty("d"); // private scalar never exported
  });

  it("mints a verifiable proof binding htm/htu, with a fresh jti per call", async () => {
    const key = await generateDpopKey();
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
    const key = await generateDpopKey();
    const proof = await createDpopProof(key, "get", "https://dash.example/api/sessions");
    expect(decodeSegment(proof.split(".")[1]!)).not.toHaveProperty("nonce");
  });
});
