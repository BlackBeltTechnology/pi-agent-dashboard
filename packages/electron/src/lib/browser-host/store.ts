/**
 * Small persistence helpers shared by the browser-host stores (key, tokens,
 * consents): the safeStorage posture, an atomic owner-only JSON write and a
 * set-aside-on-corruption read. Same rules as `server-keyring.ts`.
 *
 * Imports nothing from electron.
 *
 * See change: add-operator-browser-relay (D2, D7).
 */
import path from "node:path";
import { type CryptoPort, type FsPort, nodeFsPort } from "../server-keyring.js";

export { type CryptoPort, type FsPort, nodeFsPort };

/** True when a secret may be written to disk (OS encryption present and not Linux `basic_text`). */
export function canEncrypt(crypto: CryptoPort): boolean {
  try {
    if (!crypto.isEncryptionAvailable()) return false;
    return crypto.getSelectedStorageBackend?.() !== "basic_text";
  } catch {
    return false;
  }
}

/** `{ enc: "safeStorage", data }` — the only at-rest secret shape. */
export interface EncryptedBlob {
  enc: "safeStorage";
  data: string;
}

export const encrypt = (crypto: CryptoPort, plain: string): EncryptedBlob => ({
  enc: "safeStorage",
  data: crypto.encryptString(plain).toString("base64"),
});

/** Decrypt a blob; `null` when it is malformed or cannot be decrypted. */
export function decrypt(crypto: CryptoPort, blob: unknown): string | null {
  const b = blob as Partial<EncryptedBlob> | null;
  if (!b || b.enc !== "safeStorage" || typeof b.data !== "string") return null;
  try {
    return crypto.decryptString(Buffer.from(b.data, "base64"));
  } catch {
    return null;
  }
}

/** Atomic write: temp file (`wx`, 0600) → fsync → rename. Throws on failure (temp removed). */
export function writeJsonAtomic(fsp: FsPort, file: string, body: unknown, now: () => number): void {
  fsp.mkdirp(path.dirname(file));
  const tmp = `${file}.${process.pid}.${now()}.tmp`;
  try {
    fsp.writeExclusive(tmp, `${JSON.stringify(body, null, 2)}\n`, 0o600);
    fsp.rename(tmp, file);
  } catch (e) {
    fsp.unlink(tmp);
    throw e;
  }
}

export interface ReadOptions {
  fsp: FsPort;
  file: string;
  /** Aside name stem, e.g. `browser-host-consent` → `browser-host-consent.corrupt-<ts>.json`. */
  asideStem: string;
  now: () => number;
  log: (line: string) => void;
  platform?: NodeJS.Platform;
}

/**
 * Read a versioned JSON file. Absent → `null`. Unreadable / not JSON / wrong
 * version → renamed `<stem>.corrupt-<ts>.json`, one log line, `null`. POSIX
 * load tightens a broader mode to 0600.
 */
export function readVersionedJson<T extends { version: number }>(opts: ReadOptions, version: number): T | null {
  const { fsp, file } = opts;
  const setAside = (reason: string): null => {
    const aside = path.join(path.dirname(file), `${opts.asideStem}.corrupt-${opts.now()}.json`);
    try {
      fsp.rename(file, aside);
    } catch {
      /* start empty regardless */
    }
    opts.log(`[browser-host] ${path.basename(file)} set aside: ${reason}`);
    return null;
  };
  let raw: string | null;
  try {
    raw = fsp.readFile(file);
  } catch (e) {
    return setAside(`unreadable (${(e as Error).message})`);
  }
  if (raw === null) return null;
  if ((opts.platform ?? process.platform) !== "win32") {
    const mode = fsp.mode(file);
    if (mode !== null && (mode & 0o077) !== 0) {
      try {
        fsp.chmod(file, 0o600);
      } catch {
        /* best effort */
      }
    }
  }
  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    return setAside("not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== version) return setAside("unsupported version");
  return parsed;
}
