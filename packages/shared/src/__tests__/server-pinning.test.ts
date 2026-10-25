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
  classifyProof,
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

// ── Scheme-aware server-side proof (test-plan #X3) ─────────────────────────
// The dashboard server proves a stored `https` route over https with the
// platform's normal certificate verification, no redirect followed, 2 s, 4 KiB.
// See change: group-servers-by-identity (task 11.30).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, vi } from "vitest";

describe("proveServerIdentity over https (#X3)", () => {
  const challengeAnswer = (s: ReturnType<typeof makeServer>, init?: RequestInit) => {
    const nonce = (JSON.parse(String(init?.body)) as { nonce: string }).nonce;
    return JSON.stringify({ data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) } });
  };

  describe("request options (injected fetch)", () => {
    function recordingFetch(s: ReturnType<typeof makeServer>, status = 200) {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl = (async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(status === 200 ? challengeAnswer(s, init) : "", { status, headers: { location: "https://evil.example/" } });
      }) as typeof fetch;
      return { calls, fetchImpl };
    }

    it("posts to https://<host>:<port>/api/pair/challenge, redirect manual, no TLS override", async () => {
      const s = makeServer();
      const { calls, fetchImpl } = recordingFetch(s);
      const r = await proveServerIdentity("https://lab.example.org:8443/", { fetchImpl });
      expect(r).toEqual({ proven: s.fingerprint, publicKey: s.publicKeyB64 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://lab.example.org:8443/api/pair/challenge");
      expect(calls[0].init.redirect).toBe("manual");
      expect(calls[0].init.method).toBe("POST");
      // No certificate-verification override of any kind rides on the request.
      expect(Object.keys(calls[0].init).sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0");
    });

    it("keeps the scheme it was given: http stays http, https stays https", async () => {
      const s = makeServer();
      const a = recordingFetch(s);
      await proveServerIdentity("http://192.168.16.9:8000", { fetchImpl: a.fetchImpl });
      await proveServerIdentity("https://lab.example.org", { fetchImpl: a.fetchImpl });
      expect(a.calls.map((c) => c.url)).toEqual([
        "http://192.168.16.9:8000/api/pair/challenge",
        "https://lab.example.org/api/pair/challenge",
      ]);
    });

    it("the default timeout is 2 s", async () => {
      const spy = vi.spyOn(AbortSignal, "timeout");
      try {
        await proveServerIdentity("https://lab.example.org", { fetchImpl: recordingFetch(makeServer()).fetchImpl });
        expect(spy).toHaveBeenCalledWith(2000);
      } finally {
        spy.mockRestore();
      }
    });

    it("a redirect answer is not followed and is not a proof", async () => {
      const { calls, fetchImpl } = recordingFetch(makeServer(), 302);
      const r = await proveServerIdentity("https://lab.example.org", { fetchImpl });
      expect(r).toEqual({ refused: "challenge answered 302" });
      expect(calls).toHaveLength(1);
    });

    it("an oversized (> 4 KiB) answer is refused", async () => {
      const fetchImpl = (async () => new Response("x".repeat(64 * 1024), { status: 200 })) as typeof fetch;
      expect(await proveServerIdentity("https://lab.example.org", { fetchImpl })).toEqual({ refused: "challenge response too large" });
    });
  });

  describe("self-signed https server (real TLS handshake, default fetch)", () => {
    let dir = "";
    let server: https.Server | undefined;
    let cert = "";
    let port = 0;
    let requests = 0;
    let identity: ReturnType<typeof makeServer>;
    let ready = false;

    beforeAll(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-selfsigned-"));
      try {
        execFileSync(
          "openssl",
          [
            "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
            "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "2",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
          ],
          { stdio: "ignore" },
        );
      } catch {
        return; // no openssl on this machine: the real-handshake tests skip, the injected-fetch ones above still run
      }
      cert = fs.readFileSync(path.join(dir, "cert.pem"), "utf-8");
      identity = makeServer();
      server = https.createServer({ key: fs.readFileSync(path.join(dir, "key.pem")), cert }, (req, res) => {
        requests++;
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          res.end(challengeAnswer(identity, { body } as RequestInit));
        });
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      port = (server.address() as AddressInfo).port;
      ready = true;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("the fixture answers the challenge when its certificate is trusted explicitly (control)", async (ctx) => {
      if (!ready) return ctx.skip();
      const body = await new Promise<string>((resolve, reject) => {
        const req = https.request({ host: "127.0.0.1", port, path: "/api/pair/challenge", method: "POST", ca: cert, servername: "localhost" }, (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve(text));
        });
        req.on("error", reject);
        req.end(JSON.stringify({ nonce: "n" }));
      });
      expect(JSON.parse(body).data.fingerprint).toBe(identity.fingerprint);
      requests = 0;
    });

    it("a self-signed certificate is 'can't prove identity' — never a pinned fingerprint — and no challenge reaches the server", async (ctx) => {
      if (!ready) return ctx.skip();
      requests = 0;
      const r = await proveServerIdentity(`https://localhost:${port}`);
      expect("proven" in r).toBe(false);
      expect(r).toEqual({ refused: "challenge failed" });
      expect(requests).toBe(0);
    });

    it("the same server over plain http is not reachable as https and is not proven", async (ctx) => {
      if (!ready) return ctx.skip();
      const plain = http.createServer((_req, res) => res.end("{}"));
      await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
      try {
        const r = await proveServerIdentity(`https://127.0.0.1:${(plain.address() as AddressInfo).port}`, { timeoutMs: 1000 });
        expect("proven" in r).toBe(false);
      } finally {
        await new Promise<void>((resolve) => plain.close(() => resolve()));
      }
    });
  });
});

// See change: harden-peer-address-identity (test-plan #E1)
describe("classifyProof (#E1)", () => {
  const F = "sha256:F";
  const L = "sha256:L";
  const P = "sha256:P";
  const invalid = { refused: "signature invalid", identityFailure: true } as const;
  const transport = { refused: "challenge failed" } as const;

  it.each([
    [{ proven: F }, L],
    [{ proven: F }, undefined],
    [{ proven: F }, "none"],
  ] as const)("the pin is ok for every localFp (%j, %s)", (proven, localFp) => {
    expect(classifyProof(proven, { pin: F, localFp })).toBe("ok");
  });

  it("own fingerprint is self", () => {
    expect(classifyProof({ proven: L }, { pin: F, localFp: L })).toBe("self");
  });
  it("another fingerprint is foreign", () => {
    expect(classifyProof({ proven: P }, { pin: F, localFp: L })).toBe("foreign");
  });
  it("an invalid signature is foreign", () => {
    expect(classifyProof(invalid, { pin: F, localFp: L })).toBe("foreign");
  });
  it("a non-pin proof is unverified while localFp is unresolved", () => {
    expect(classifyProof({ proven: L }, { pin: F, localFp: undefined })).toBe("unverified");
    expect(classifyProof({ proven: P }, { pin: F, localFp: undefined })).toBe("unverified");
  });
  it("without a local server there is no self", () => {
    expect(classifyProof({ proven: L }, { pin: F, localFp: "none" })).toBe("foreign");
  });
  it("a transport refusal proves nothing", () => {
    expect(classifyProof(transport, { pin: F, localFp: L })).toBe("unverified");
  });
});

describe("challengePinnedServer TLS validation (prove-vault-bridge-tls D7)", () => {
  const OFF = { NODE_TLS_REJECT_UNAUTHORIZED: "0" };

  it("refuses an https origin with tls-verify-disabled and makes no request", async () => {
    const s = makeServer();
    const fetchImpl = vi.fn();
    const res = await challengePinnedServer({
      baseUrl: "https://dash.example:8443",
      pin: pinOf(s),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: OFF,
    });
    expect(res).toMatchObject({ accept: false, cause: "tls-verify-disabled" });
    expect(res.reason).toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leaves an http origin alone while validation is disabled", async () => {
    const s = makeServer();
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const nonce = JSON.parse(String(init?.body)).nonce as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) } }),
      } as unknown as Response;
    });
    const res = await challengePinnedServer({
      baseUrl: "http://dash.example:8000",
      pin: pinOf(s),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: OFF,
    });
    expect(res.accept).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("validates an https origin as before when validation is enabled", async () => {
    const s = makeServer();
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const nonce = JSON.parse(String(init?.body)).nonce as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { fingerprint: s.fingerprint, publicKey: s.publicKeyB64, signature: s.sign(nonce) } }),
      } as unknown as Response;
    });
    const res = await challengePinnedServer({
      baseUrl: "https://dash.example:8443",
      pin: pinOf(s),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
    });
    expect(res.accept).toBe(true);
  });
});
