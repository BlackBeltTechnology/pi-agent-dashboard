/**
 * Browser device-key store: one non-extractable Ed25519 key per server
 * fingerprint in IndexedDB. Real WebCrypto + fake-indexeddb.
 * See change: device-key-mutual-check (tasks 4.1/4.2, D3, D4).
 */
import "fake-indexeddb/auto";
import {
  base64urlToBytes,
  companionMessage,
  devbindMessage,
  devcheckMessage,
  encodeCompanionFragment,
  isDevicePub,
  isDeviceSig,
  parseCompanionFragment,
  shortKeyId,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPending,
  detectDeviceKeySupport,
  discardKey,
  ensureKey,
  getPending,
  getPublicKey,
  hasKey,
  markPending,
  resetDeviceKeySupportCache,
  rotateKey,
  settlePending,
  signCompanion,
  signDevbind,
  signDevcheck,
} from "../device-key.js";

const FP_A = "sha256:AAAA";
const FP_B = "sha256:BBBB";
const NONCE = "A".repeat(43);

async function verify(pub: string, sig: string, message: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", base64urlToBytes(pub) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, base64urlToBytes(sig) as BufferSource, new TextEncoder().encode(message));
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  vi.stubGlobal("isSecureContext", true);
  resetDeviceKeySupportCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("feature detection", () => {
  it("is supported in a secure context with Ed25519 WebCrypto", async () => {
    expect(await detectDeviceKeySupport()).toBe(true);
  });

  it("is unsupported on an insecure context and never touches crypto.subtle", async () => {
    vi.stubGlobal("isSecureContext", false);
    const subtle = vi.fn(() => crypto.subtle);
    const fake = {};
    Object.defineProperty(fake, "subtle", { get: subtle });
    vi.stubGlobal("crypto", fake);
    expect(await detectDeviceKeySupport()).toBe(false);
    expect(subtle).not.toHaveBeenCalled();
  });

  it("is unsupported when crypto.subtle is absent", async () => {
    vi.stubGlobal("crypto", {});
    expect(await detectDeviceKeySupport()).toBe(false);
  });

  it("is unsupported when Ed25519 generateKey throws (NotSupportedError)", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        generateKey: async () => {
          throw new DOMException("no", "NotSupportedError");
        },
      },
    });
    expect(await detectDeviceKeySupport()).toBe(false);
  });

  it("is unsupported without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await detectDeviceKeySupport()).toBe(false);
  });
});

describe("key store", () => {
  it("creates no key on listing: hasKey / getPublicKey / signers are read-only", async () => {
    expect(await hasKey(FP_A)).toBe(false);
    expect(await getPublicKey(FP_A)).toBeNull();
    expect(await signDevcheck(FP_A, NONCE)).toBeNull();
    expect(await signDevbind(FP_A, NONCE)).toBeNull();
    expect(await hasKey(FP_A)).toBe(false);
  });

  it("ensureKey creates one raw 32-byte base64url key and is idempotent", async () => {
    const pub = await ensureKey(FP_A);
    expect(isDevicePub(pub)).toBe(true);
    expect(await ensureKey(FP_A)).toBe(pub);
    expect(await getPublicKey(FP_A)).toBe(pub);
    expect(await hasKey(FP_A)).toBe(true);
  });

  it("concurrent ensureKey calls converge on one key", async () => {
    const [a, b] = await Promise.all([ensureKey(FP_A), ensureKey(FP_A)]);
    expect(a).toBe(b);
    expect(await getPublicKey(FP_A)).toBe(a);
  });

  it("keeps a separate key per fingerprint", async () => {
    const a = await ensureKey(FP_A);
    const b = await ensureKey(FP_B);
    expect(a).not.toBe(b);
  });

  it("the stored private key is non-extractable", async () => {
    await ensureKey(FP_A);
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("pi-dashboard-device-keys");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const stores = Array.from(db.objectStoreNames);
    const rec: { privateKey: CryptoKey } = await new Promise((res, rej) => {
      const r = db.transaction(stores[0]).objectStore(stores[0]).get(FP_A);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    expect(rec.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", rec.privateKey)).rejects.toBeTruthy();
  });

  it("discardKey deletes the key (forget / 401 bearer_expired)", async () => {
    await ensureKey(FP_A);
    await discardKey(FP_A);
    expect(await hasKey(FP_A)).toBe(false);
    await discardKey(FP_A); // idempotent
  });

  it("rotateKey replaces the key with a new one (pair again)", async () => {
    const old = await ensureKey(FP_A);
    const fresh = await rotateKey(FP_A);
    expect(fresh).not.toBe(old);
    expect(await getPublicKey(FP_A)).toBe(fresh);
  });

  it("rotateKey on a fingerprint with no key still creates one", async () => {
    expect(isDevicePub(await rotateKey(FP_A))).toBe(true);
  });
});

describe("signing", () => {
  it("signDevcheck / signDevbind produce {deviceNonce,pub,sig} over the right text", async () => {
    const pub = await ensureKey(FP_A);
    const check = await signDevcheck(FP_A, NONCE);
    const bind = await signDevbind(FP_A, NONCE);
    expect(check).toMatchObject({ deviceNonce: NONCE, pub });
    expect(bind).toMatchObject({ deviceNonce: NONCE, pub });
    expect(isDeviceSig(check?.sig)).toBe(true);
    expect(await verify(pub, check!.sig, devcheckMessage(FP_A, NONCE))).toBe(true);
    expect(await verify(pub, bind!.sig, devbindMessage(FP_A, NONCE))).toBe(true);
    // purposes and servers never cross-verify
    expect(await verify(pub, check!.sig, devbindMessage(FP_A, NONCE))).toBe(false);
    expect(await verify(pub, bind!.sig, devbindMessage(FP_B, NONCE))).toBe(false);
  });

  it("signCompanion signs fp|origin|ts and round-trips through the fragment codec", async () => {
    const pub = await ensureKey(FP_A);
    const claim = await signCompanion(FP_A, "http://192.168.16.31:8000", 1_700_000_000_000);
    expect(claim).toMatchObject({ pub, ts: 1_700_000_000, origin: "http://192.168.16.31:8000" });
    expect(await verify(pub, claim!.sig, companionMessage(FP_A, claim!.origin, claim!.ts))).toBe(true);
    expect(parseCompanionFragment(`#${encodeCompanionFragment(claim!)}`)).toEqual(claim);
  });

  it("signCompanion without a key is null (it never creates one)", async () => {
    expect(await signCompanion(FP_A, "http://h:1")).toBeNull();
    expect(await hasKey(FP_A)).toBe(false);
  });

  it("the public key's short id is dk: + 12 chars", async () => {
    const pub = await ensureKey(FP_A);
    expect(await shortKeyId(pub)).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
  });
});

describe("pending marker (live request survives a reload)", () => {
  it("markPending keeps the key across a fresh module read and is readable", async () => {
    const pub = await ensureKey(FP_A);
    await markPending(FP_A, "pend-1");
    expect(await getPending(FP_A)).toMatchObject({ pendingId: "pend-1" });
    expect(await getPublicKey(FP_A)).toBe(pub);
  });

  it("getPending is null with no marker or no key", async () => {
    expect(await getPending(FP_A)).toBeNull();
    await ensureKey(FP_A);
    expect(await getPending(FP_A)).toBeNull();
  });

  it("approved clears the marker and keeps the key", async () => {
    const pub = await ensureKey(FP_A);
    await markPending(FP_A, "p");
    await settlePending(FP_A, "approved");
    expect(await getPending(FP_A)).toBeNull();
    expect(await getPublicKey(FP_A)).toBe(pub);
  });

  it.each(["rejected", "expired"] as const)("%s deletes the pending key", async (outcome) => {
    await ensureKey(FP_A);
    await markPending(FP_A, "p");
    await settlePending(FP_A, outcome);
    expect(await hasKey(FP_A)).toBe(false);
  });

  it("settling a rejected request never deletes a key that is not pending", async () => {
    const pub = await ensureKey(FP_A); // an established key
    await settlePending(FP_A, "rejected");
    expect(await getPublicKey(FP_A)).toBe(pub);
  });

  it("clearPending drops only the marker", async () => {
    const pub = await ensureKey(FP_A);
    await markPending(FP_A, "p");
    await clearPending(FP_A);
    expect(await getPending(FP_A)).toBeNull();
    expect(await getPublicKey(FP_A)).toBe(pub);
  });
});

describe("unsupported environment", () => {
  it("ensureKey rejects when unsupported, reads degrade to none", async () => {
    vi.stubGlobal("isSecureContext", false);
    await expect(ensureKey(FP_A)).rejects.toThrow(/unsupported/i);
    expect(await hasKey(FP_A)).toBe(false);
    expect(await getPublicKey(FP_A)).toBeNull();
    expect(await signDevcheck(FP_A, NONCE)).toBeNull();
  });
});
