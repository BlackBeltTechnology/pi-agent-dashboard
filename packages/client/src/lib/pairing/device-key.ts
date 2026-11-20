/**
 * Browser device-key store: one non-extractable Ed25519 WebCrypto key per
 * server fingerprint, kept in IndexedDB of the page's own origin.
 *
 *  - Created only by an explicit `ensureKey(fp)` / `rotateKey(fp)` (a user
 *    starting to pair). Listing, reading and signing never create one.
 *  - A page with no secure context / Ed25519 WebCrypto / IndexedDB reports
 *    "unsupported" and pairs keyless (design D4). The support check never
 *    reads `crypto.subtle` unless `isSecureContext` is true, so plain-http LAN
 *    origins stay untouched.
 *  - A key made for a live request carries a pending marker so a reload resumes
 *    the wait; `settlePending` keeps the key on `approved` and deletes it on
 *    `rejected` / `expired` (never a key that is not pending).
 *  - The private key never leaves the store: callers get the raw public key
 *    (base64url) and signatures only.
 *
 * Signed texts come from the shared builders (`device-key-proof.ts`); this
 * module only signs them.
 *
 * See change: device-key-mutual-check (D3, D4, D5).
 */
import {
  bytesToBase64url,
  type CompanionClaim,
  companionMessage,
  type DeviceProof,
  devbindMessage,
  devcheckMessage,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";

const DB_NAME = "pi-dashboard-device-keys";
const STORE = "keys";

interface KeyRecord {
  fingerprint: string;
  privateKey: CryptoKey;
  /** Raw 32-byte Ed25519 public key, unpadded base64url. */
  publicKey: string;
  createdAt: number;
  /** Present while a pairing request made with this key is live. */
  pending?: { pendingId: string; at: number };
}

export interface PendingMarker {
  pendingId: string;
  at: number;
}

// ── Feature detection ────────────────────────────────────────────────

/** Cheap, synchronous, and never reads `crypto.subtle` outside a secure context. */
function cheapSupport(): boolean {
  if (globalThis.isSecureContext !== true) return false;
  if (typeof globalThis.indexedDB === "undefined" || globalThis.indexedDB === null) return false;
  const c = globalThis.crypto as Crypto | undefined;
  return typeof c?.subtle?.generateKey === "function";
}

let probe: Promise<boolean> | null = null;

/** Test hook: forget the cached Ed25519 probe result. */
export function resetDeviceKeySupportCache(): void {
  probe = null;
}

/** True when this page can hold a device key (secure context, IndexedDB, Ed25519 `generateKey` works). */
export async function detectDeviceKeySupport(): Promise<boolean> {
  if (!cheapSupport()) return false;
  probe ??= crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]).then(
    () => true,
    () => false,
  );
  return probe;
}

// ── IndexedDB plumbing (one short-lived connection per operation) ────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "fingerprint" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      Promise.resolve(run(tx.objectStore(STORE))).then((r) => {
        result = r;
      }, reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecord(fingerprint: string): Promise<KeyRecord | null> {
  if (!cheapSupport()) return null;
  try {
    return await withStore("readonly", async (s) => ((await request(s.get(fingerprint))) as KeyRecord | undefined) ?? null);
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/** True when a key is held for `fingerprint`. Never creates one. */
export async function hasKey(fingerprint: string): Promise<boolean> {
  return (await readRecord(fingerprint)) !== null;
}

/** The raw base64url public key held for `fingerprint`, or `null`. Never creates one. */
export async function getPublicKey(fingerprint: string): Promise<string | null> {
  return (await readRecord(fingerprint))?.publicKey ?? null;
}

/**
 * Create the key for `fingerprint` if none exists; return its public key. Concurrent calls converge on one
 * key (the insert is `get`-then-`put` inside one transaction, so the loser keeps the winner's key).
 * Rejects when the environment is unsupported.
 */
export async function ensureKey(fingerprint: string): Promise<string> {
  if (!(await detectDeviceKeySupport())) throw new Error("device key unsupported in this context");
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return withStore("readwrite", async (s) => {
    const existing = (await request(s.get(fingerprint))) as KeyRecord | undefined;
    if (existing) return existing.publicKey;
    const record: KeyRecord = { fingerprint, privateKey: pair.privateKey, publicKey, createdAt: Date.now() };
    s.put(record);
    return publicKey;
  });
}

/** Delete the key for `fingerprint` (forget the server, or a `401 bearer_expired` discard). Idempotent. */
export async function discardKey(fingerprint: string): Promise<void> {
  if (!cheapSupport()) return;
  try {
    await withStore("readwrite", (s) => {
      s.delete(fingerprint);
    });
  } catch {
    /* nothing to delete / store unavailable */
  }
}

/** "Pair again": discard the old key and create a new one. Returns the new public key. */
export async function rotateKey(fingerprint: string): Promise<string> {
  await discardKey(fingerprint);
  return ensureKey(fingerprint);
}

// ── Pending marker ───────────────────────────────────────────────────

/** Mark the key as belonging to the live request `pendingId` (no-op without a key). */
export async function markPending(fingerprint: string, pendingId: string): Promise<void> {
  if (!cheapSupport()) return;
  try {
    await withStore("readwrite", async (s) => {
      const rec = (await request(s.get(fingerprint))) as KeyRecord | undefined;
      if (rec) s.put({ ...rec, pending: { pendingId, at: Date.now() } });
    });
  } catch {
    /* the request still works; it just cannot resume its key after a reload */
  }
}

export async function getPending(fingerprint: string): Promise<PendingMarker | null> {
  return (await readRecord(fingerprint))?.pending ?? null;
}

/** Drop the marker, keep the key. */
export async function clearPending(fingerprint: string): Promise<void> {
  if (!cheapSupport()) return;
  try {
    await withStore("readwrite", async (s) => {
      const rec = (await request(s.get(fingerprint))) as KeyRecord | undefined;
      if (rec?.pending) {
        const { pending: _drop, ...rest } = rec;
        s.put(rest);
      }
    });
  } catch {
    /* ignore */
  }
}

/**
 * The live request resolved. `approved` keeps the key (marker cleared); `rejected` / `expired` delete it —
 * but only a key that is still pending, so an established key is never lost to a stray resolution.
 */
export async function settlePending(fingerprint: string, outcome: "approved" | "rejected" | "expired"): Promise<void> {
  if (outcome === "approved") return clearPending(fingerprint);
  if (!cheapSupport()) return;
  try {
    await withStore("readwrite", async (s) => {
      const rec = (await request(s.get(fingerprint))) as KeyRecord | undefined;
      if (rec?.pending) s.delete(fingerprint);
    });
  } catch {
    /* ignore */
  }
}

// ── Signing (never creates a key) ────────────────────────────────────

async function signText(fingerprint: string, message: string): Promise<{ pub: string; sig: string } | null> {
  const rec = await readRecord(fingerprint);
  if (!rec) return null;
  try {
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, rec.privateKey, new TextEncoder().encode(message));
    return { pub: rec.publicKey, sig: bytesToBase64url(new Uint8Array(sig)) };
  } catch {
    return null;
  }
}

/** `{deviceNonce,pub,sig}` for `POST /api/pair/device-status` (`pi-devcheck/v2`). Null without a key. */
export async function signDevcheck(fingerprint: string, deviceNonce: string): Promise<DeviceProof | null> {
  const s = await signText(fingerprint, devcheckMessage(fingerprint, deviceNonce));
  return s ? { deviceNonce, ...s } : null;
}

/** `{deviceNonce,pub,sig}` for a knock / redeem / key-bind body (`pi-devbind/v1`). Null without a key. */
export async function signDevbind(fingerprint: string, deviceNonce: string): Promise<DeviceProof | null> {
  const s = await signText(fingerprint, devbindMessage(fingerprint, deviceNonce));
  return s ? { deviceNonce, ...s } : null;
}

/**
 * Companion claim `{pub,ts,sig,origin}` of THIS origin for server `fingerprint` (`pi-companion/v1`).
 * `origin` is signed exactly as given. Null without a key (create one with `ensureKey` first).
 */
export async function signCompanion(fingerprint: string, origin: string, nowMs: number = Date.now()): Promise<CompanionClaim | null> {
  const ts = Math.floor(nowMs / 1000);
  const s = await signText(fingerprint, companionMessage(fingerprint, origin, ts));
  return s ? { pub: s.pub, ts, sig: s.sig, origin } : null;
}
