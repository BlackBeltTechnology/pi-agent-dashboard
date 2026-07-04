/**
 * Persistent keyring of paired servers, backed by IndexedDB.
 *
 * Each entry pins a server's Ed25519 identity (fingerprint + public key) and
 * holds the durable opaque bearer token minted at pairing time. The bearer is
 * a credential — it lives only here, never in a WS URL or subprotocol.
 *
 * When `indexedDB` is unavailable (e.g. some test runners) the store falls
 * back to an in-memory Map so the same API works everywhere.
 */

export interface KeyringEntry {
  /** Pinned server fingerprint (`sha256:<base64url>`) — the primary key. */
  id: string;
  label: string;
  urls: string[];
  /** base64url SPKI DER Ed25519 public key. */
  pinnedPubkey: string;
  pinnedFingerprint: string;
  bearerToken: string;
}

const DB_NAME = "pi-dashboard-shell";
const STORE = "servers";
const DB_VERSION = 1;

const hasIndexedDB = (): boolean =>
  typeof indexedDB !== "undefined" && indexedDB !== null;

// ── In-memory fallback ─────────────────────────────────────────────────────

const memory = new Map<string, KeyringEntry>();

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        // Close the connection on every terminal transaction state, not just
        // oncomplete — a failed request fires onabort/onerror and would
        // otherwise leak the IDBDatabase handle (blocks future upgrades).
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => db.close();
        transaction.onerror = () => db.close();
      }),
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function addServer(entry: KeyringEntry): Promise<void> {
  if (!hasIndexedDB()) {
    memory.set(entry.id, entry);
    return;
  }
  await tx("readwrite", (store) => store.put(entry));
}

export async function listServers(): Promise<KeyringEntry[]> {
  if (!hasIndexedDB()) {
    return [...memory.values()];
  }
  return tx<KeyringEntry[]>("readonly", (store) => store.getAll());
}

export async function removeServer(id: string): Promise<void> {
  if (!hasIndexedDB()) {
    memory.delete(id);
    return;
  }
  await tx("readwrite", (store) => store.delete(id));
}
