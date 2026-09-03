import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { challengePinnedServer } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeFingerprint,
  ensureServerIdentity,
  signNonce,
  verifyNonceSignature,
} from "../auth/identity.js";

let tmpDir: string;
let keyPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-identity-"));
  keyPath = path.join(tmpDir, "sub", "identity.key");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureServerIdentity", () => {
  it("generates a keypair on first start and writes 0600", () => {
    const id = ensureServerIdentity(keyPath);
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(id.fingerprint).toMatch(/^sha256:/);
    expect(id.publicKeyB64.length).toBeGreaterThan(0);
    // POSIX permission bits: 0600.
    if (process.platform !== "win32") {
      const mode = fs.statSync(keyPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("reuses the same key across restarts (stable fingerprint)", () => {
    const a = ensureServerIdentity(keyPath);
    const b = ensureServerIdentity(keyPath);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.publicKeyB64).toBe(a.publicKeyB64);
  });

  it("derives fingerprint deterministically from the public key", () => {
    const id = ensureServerIdentity(keyPath);
    expect(computeFingerprint(id.publicKey)).toBe(id.fingerprint);
  });
});

describe("nonce challenge-response", () => {
  it("verifies a valid signature against the server public key", () => {
    const id = ensureServerIdentity(keyPath);
    const nonce = crypto.randomBytes(32).toString("base64url");
    const sig = signNonce(id, nonce);
    expect(verifyNonceSignature(id.publicKeyB64, nonce, sig)).toBe(true);
  });

  it("detects an impostor signing with a different key", () => {
    const real = ensureServerIdentity(keyPath);
    const impostor = ensureServerIdentity(path.join(tmpDir, "impostor.key"));
    const nonce = crypto.randomBytes(32).toString("base64url");
    const impostorSig = signNonce(impostor, nonce);
    // Client pinned `real`, but the reachable server signed with impostor key.
    expect(verifyNonceSignature(real.publicKeyB64, nonce, impostorSig)).toBe(false);
  });

  it("rejects a signature over a different nonce (replay/tamper)", () => {
    const id = ensureServerIdentity(keyPath);
    const sig = signNonce(id, "nonce-a");
    expect(verifyNonceSignature(id.publicKeyB64, "nonce-b", sig)).toBe(false);
  });

  it("returns false on malformed inputs instead of throwing", () => {
    const id = ensureServerIdentity(keyPath);
    expect(verifyNonceSignature("not-a-key", "n", "not-a-sig")).toBe(false);
    expect(verifyNonceSignature(id.publicKeyB64, "n", "@@@bad@@@")).toBe(false);
  });
});

/**
 * #X12 (task 12.31) — the bridge's pinned-identity check against the REAL
 * `/api/pair/challenge` handler, not a hand-rolled stand-in. A live route that
 * answers correctly for its own key must still be refused when the pin names a
 * different server: reachability at the expected address proves nothing.
 */
describe("impostor at the expected address (#X12)", () => {
  const challengeOf = (identity: ReturnType<typeof ensureServerIdentity>) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      // The server's own handler body (routes/pairing-routes.ts).
      const nonce = JSON.parse(String(init?.body)).nonce as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            fingerprint: identity.fingerprint,
            publicKey: identity.publicKeyB64,
            signature: signNonce(identity, nonce),
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it("refuses a server that cannot answer the challenge for the PINNED key", async () => {
    const pinned = ensureServerIdentity(path.join(tmpDir, "pinned.key"));
    const impostor = ensureServerIdentity(path.join(tmpDir, "impostor.key"));
    const verdict = await challengePinnedServer({
      baseUrl: "http://dash.example:8000",
      pin: { fingerprint: pinned.fingerprint, publicKeyB64: pinned.publicKeyB64 },
      fetchImpl: challengeOf(impostor),
    });
    expect(verdict.accept).toBe(false);
    expect(verdict.cause).toBe("fingerprint-mismatch");
    expect(verdict.reason).toContain(pinned.fingerprint);
  });

  it("accepts the genuine server at that same address", async () => {
    const pinned = ensureServerIdentity(path.join(tmpDir, "pinned.key"));
    const verdict = await challengePinnedServer({
      baseUrl: "http://dash.example:8000",
      pin: { fingerprint: pinned.fingerprint, publicKeyB64: pinned.publicKeyB64 },
      fetchImpl: challengeOf(pinned),
    });
    expect(verdict).toMatchObject({ accept: true, cause: "verified" });
  });
});
