/**
 * Shell device key: per-server Ed25519 key where WebCrypto supports it,
 * none (and no error) where it does not.
 *
 * See change: device-key-mutual-check (task 5.7; test-plan X13).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceKey, devbindMessage, deviceKeyProofForRedeem, supportsDeviceKey } from "./device-key.js";
import { b64urlToBytes, bytesToB64url } from "./protocol.js";

const fp = `sha256:${"A".repeat(43)}`;
const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));

afterEach(() => vi.unstubAllGlobals());

describe("shell device key", () => {
  it("signed bind text matches the server's layout", () => {
    expect(devbindMessage(fp, nonce)).toBe(`pi-devbind/v1\n${fp}\n${nonce}`);
  });

  it("creates a non-extractable key whose bind proof verifies", async () => {
    expect(await supportsDeviceKey()).toBe(true);
    const key = await createDeviceKey();
    expect(key).not.toBeNull();
    expect(key!.pub).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key!.privateKey.extractable).toBe(false);
    const proof = await deviceKeyProofForRedeem(key!, fp, nonce);
    const pk = await crypto.subtle.importKey("raw", b64urlToBytes(proof.pub) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    expect(proof.deviceNonce).toBe(nonce);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      pk,
      b64urlToBytes(proof.sig) as BufferSource,
      new TextEncoder().encode(devbindMessage(fp, nonce)),
    );
    expect(ok).toBe(true);
    const wrong = await crypto.subtle.verify(
      { name: "Ed25519" },
      pk,
      b64urlToBytes(proof.sig) as BufferSource,
      new TextEncoder().encode(devbindMessage(`sha256:${"B".repeat(43)}`, nonce)),
    );
    expect(wrong).toBe(false);
  });

  it("no Ed25519 → no key, no error", async () => {
    vi.stubGlobal("crypto", { ...globalThis.crypto, subtle: undefined });
    expect(await supportsDeviceKey()).toBe(false);
    expect(await createDeviceKey()).toBeNull();
  });
});
