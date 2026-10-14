/**
 * D8 — the bridge pins the server's Ed25519 fingerprint and refuses any
 * endpoint that cannot answer the nonce challenge with the pinned key.
 *
 * See change: add-pi-gateway-transport-identity (tasks 7.1–7.5).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  challengePinnedServer,
  decidePinnedIdentity,
  fingerprintFromPublicKeyB64,
  type ServerPin,
} from "../server-pinning.js";

function makeServer() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyB64 = der.toString("base64url");
  const fingerprint = `sha256:${crypto.createHash("sha256").update(der).digest("base64url")}`;
  return {
    publicKeyB64,
    fingerprint,
    sign: (nonce: string) => crypto.sign(null, Buffer.from(nonce, "utf-8"), privateKey).toString("base64url"),
  };
}

function pinOf(s: ReturnType<typeof makeServer>): ServerPin {
  return { fingerprint: s.fingerprint, publicKeyB64: s.publicKeyB64 };
}

describe("fingerprintFromPublicKeyB64", () => {
  it("derives the same fingerprint the server publishes", () => {
    const s = makeServer();
    expect(fingerprintFromPublicKeyB64(s.publicKeyB64)).toBe(s.fingerprint);
  });

  it("returns null for material that is not an SPKI public key", () => {
    expect(fingerprintFromPublicKeyB64("not-a-key")).toBeNull();
  });
});

describe("decidePinnedIdentity", () => {
  const nonce = "nonce-abcdefgh";

  it("accepts a genuine server answering with the pinned key", () => {
    const s = makeServer();
    const d = decidePinnedIdentity({
      pin: pinOf(s),
      nonce,
      response: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) },
    });
    expect(d).toMatchObject({ accept: true, cause: "verified" });
  });

  it("refuses an impostor presenting its own key under the pinned fingerprint", () => {
    const pinned = makeServer();
    const impostor = makeServer();
    const d = decidePinnedIdentity({
      pin: pinOf(pinned),
      nonce,
      // Claims the pinned fingerprint but can only sign with its own key.
      response: {
        fingerprint: pinned.fingerprint,
        publicKey: impostor.publicKeyB64,
        signature: impostor.sign(nonce),
      },
    });
    expect(d.accept).toBe(false);
    expect(d.cause).toBe("fingerprint-mismatch");
  });

  it("refuses a server whose fingerprint differs from the pin", () => {
    const pinned = makeServer();
    const other = makeServer();
    const d = decidePinnedIdentity({
      pin: pinOf(pinned),
      nonce,
      response: { fingerprint: other.fingerprint, publicKey: other.publicKeyB64, signature: other.sign(nonce) },
    });
    expect(d.accept).toBe(false);
    expect(d.cause).toBe("fingerprint-mismatch");
    expect(d.reason).toContain(pinned.fingerprint);
  });

  it("refuses possession failure distinctly from a fingerprint mismatch", () => {
    const s = makeServer();
    const d = decidePinnedIdentity({
      pin: pinOf(s),
      nonce,
      // Right key material, but it cannot sign — no private key.
      response: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign("a-different-nonce") },
    });
    expect(d.accept).toBe(false);
    expect(d.cause).toBe("signature-invalid");
  });

  it("refuses when nothing is pinned rather than trusting on sight", () => {
    const s = makeServer();
    const d = decidePinnedIdentity({
      pin: undefined,
      nonce,
      response: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) },
    });
    expect(d.accept).toBe(false);
    expect(d.cause).toBe("not-pinned");
  });
});

describe("challengePinnedServer", () => {
  const okFetch = (s: ReturnType<typeof makeServer>) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      const nonce = JSON.parse(String(init?.body)).nonce as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it("accepts a pinned identity reached at a NEW address, without re-pairing (7.4)", async () => {
    const s = makeServer();
    const pin = pinOf(s);
    const first = await challengePinnedServer({ baseUrl: "http://old.example:8000", pin, fetchImpl: okFetch(s) });
    const moved = await challengePinnedServer({ baseUrl: "http://new.example:9100", pin, fetchImpl: okFetch(s) });
    expect(first.accept).toBe(true);
    expect(moved.accept).toBe(true);
    expect(moved.cause).toBe("verified");
  });

  it("refuses an impostor at the EXPECTED address (7.5)", async () => {
    const pinned = makeServer();
    const impostor = makeServer();
    const res = await challengePinnedServer({
      baseUrl: "http://dash.example:8000",
      pin: pinOf(pinned),
      fetchImpl: okFetch(impostor),
    });
    expect(res.accept).toBe(false);
    expect(res.cause).toBe("fingerprint-mismatch");
  });

  it("sends a fresh nonce per challenge, so a captured signature cannot be replayed", async () => {
    const s = makeServer();
    const seen: string[] = [];
    const capturing = (async (_u: string | URL | Request, init?: RequestInit) => {
      const nonce = JSON.parse(String(init?.body)).nonce as string;
      seen.push(nonce);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          // Replays the FIRST nonce's signature on every later challenge.
          data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(seen[0]) },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const pin = pinOf(s);
    const a = await challengePinnedServer({ baseUrl: "http://x:8000", pin, fetchImpl: capturing });
    const b = await challengePinnedServer({ baseUrl: "http://x:8000", pin, fetchImpl: capturing });
    expect(seen[0]).not.toBe(seen[1]);
    expect(a.accept).toBe(true);
    expect(b.accept).toBe(false);
    expect(b.cause).toBe("signature-invalid");
  });

  it("collapses an unreachable or non-OK endpoint to a refusal, never a pass", async () => {
    const s = makeServer();
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const notOk = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const a = await challengePinnedServer({ baseUrl: "http://x:8000", pin: pinOf(s), fetchImpl: dead });
    const b = await challengePinnedServer({ baseUrl: "http://x:8000", pin: pinOf(s), fetchImpl: notOk });
    expect(a).toMatchObject({ accept: false, cause: "unreachable" });
    expect(b).toMatchObject({ accept: false, cause: "unreachable" });
  });
});

// ── proveServerIdentity (test-plan #X1) ────────────────────────────────────
// See change: stabilize-mdns-server-identity
import { proveServerIdentity } from "../server-pinning.js";

describe("proveServerIdentity", () => {
  const challengeFetch = (
    s: ReturnType<typeof makeServer>,
    opts: { fp?: string; badSig?: boolean; nonces?: string[] } = {},
  ): typeof fetch =>
    (async (_url: unknown, init?: RequestInit) => {
      const nonce = (JSON.parse(String(init?.body)) as { nonce: string }).nonce;
      opts.nonces?.push(nonce);
      return new Response(
        JSON.stringify({
          data: {
            fingerprint: opts.fp ?? s.fingerprint,
            publicKey: s.publicKeyB64,
            signature: opts.badSig ? s.sign("other") : s.sign(nonce),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

  it("proves a genuine server and returns its fingerprint", async () => {
    const s = makeServer();
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: challengeFetch(s) });
    // `publicKey` is the key whose possession was proven (callers may pin it)
    expect(r).toEqual({ proven: s.fingerprint, publicKey: s.publicKeyB64 });
  });

  it("refuses a bad signature and flags it as an identity failure (impostor), not a transport failure", async () => {
    const s = makeServer();
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: challengeFetch(s, { badSig: true }) });
    expect("proven" in r).toBe(false);
    expect(r).toMatchObject({ refused: "signature invalid", identityFailure: true });
  });

  it("a transport failure is NOT flagged as an identity failure", async () => {
    const f = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: f });
    expect("identityFailure" in r).toBe(false);
  });

  it("derives the fingerprint from the presented key, not the body field", async () => {
    const s = makeServer();
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: challengeFetch(s, { fp: "sha256:forged" }) });
    expect(r).toEqual({ proven: s.fingerprint, publicKey: s.publicKeyB64 });
  });

  it("refuses a 500", async () => {
    const f = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: f });
    expect("proven" in r).toBe(false);
  });

  it("refuses a redirect and sends redirect:manual", async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 302, headers: { location: "http://evil/" } });
    }) as typeof fetch;
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: f });
    expect(seen?.redirect).toBe("manual");
    expect("proven" in r).toBe(false);
  });

  it("refuses a body larger than 4 KiB", async () => {
    const s = makeServer();
    const big = JSON.stringify({
      data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign("x"), pad: "a".repeat(5 * 1024) },
    });
    const f = (async () => new Response(big, { status: 200 })) as typeof fetch;
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: f });
    expect("proven" in r).toBe(false);
  });

  it("refuses a hanging endpoint within the timeout", async () => {
    const f = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as typeof fetch;
    const t0 = Date.now();
    const r = await proveServerIdentity("http://h:8000", { fetchImpl: f, timeoutMs: 200 });
    expect(Date.now() - t0).toBeLessThan(600);
    expect("proven" in r).toBe(false);
  });

  it("uses a fresh nonce per call", async () => {
    const s = makeServer();
    const nonces: string[] = [];
    const f = challengeFetch(s, { nonces });
    await proveServerIdentity("http://h:8000", { fetchImpl: f });
    await proveServerIdentity("http://h:8000", { fetchImpl: f });
    expect(new Set(nonces).size).toBe(2);
  });
});
