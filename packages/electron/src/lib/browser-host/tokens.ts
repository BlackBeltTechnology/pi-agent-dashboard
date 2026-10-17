/**
 * Local pairing-token store, per Chrome profile. The Playwright extension's
 * token (the "zero dialog" credential) lives on the operator machine ONLY:
 * stored through `safeStorage` (`browser-host-tokens.json`, 0600); where
 * encryption is unavailable the token is kept in memory for this run and
 * nothing is written. `get` is main-process only — no IPC returns a token and
 * nothing here logs one.
 *
 * Imports nothing from electron — unit-tested in `__tests__/tokens.test.ts`.
 *
 * See change: add-operator-browser-relay (D7).
 */
import path from "node:path";
import { canEncrypt, type CryptoPort, decrypt, encrypt, type EncryptedBlob, type FsPort, nodeFsPort, readVersionedJson, writeJsonAtomic } from "./store.js";

const FILE = "browser-host-tokens.json";
const VERSION = 1;
const MAX_PROFILE = 128;
const MAX_TOKEN = 4096;

interface DiskFile {
  version: number;
  tokens: Record<string, EncryptedBlob>;
}

export interface TokenStore {
  /** Main-process only. */
  get(profileDirectory: string): string | null;
  /** `null` removes. Throws on invalid input. */
  set(profileDirectory: string, token: string | null): void;
}

export interface TokenStoreOptions {
  dir: string;
  crypto: CryptoPort;
  fs?: FsPort;
  log?: (line: string) => void;
  now?: () => number;
}

export function createTokenStore(opts: TokenStoreOptions): TokenStore {
  const fsp = opts.fs ?? nodeFsPort;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const file = path.join(opts.dir, FILE);
  const tokens = new Map<string, string>();

  if (canEncrypt(opts.crypto)) {
    const disk = readVersionedJson<DiskFile>({ fsp, file, asideStem: "browser-host-tokens", now, log }, VERSION);
    for (const [profile, blob] of Object.entries(disk?.tokens ?? {})) {
      const plain = decrypt(opts.crypto, blob);
      if (plain !== null) tokens.set(profile, plain);
    }
  }

  const persist = (): void => {
    // No OS encryption this run: memory only; never write, never clobber an existing encrypted file.
    if (!canEncrypt(opts.crypto)) return;
    const out: Record<string, EncryptedBlob> = {};
    for (const [profile, token] of tokens) out[profile] = encrypt(opts.crypto, token);
    try {
      writeJsonAtomic(fsp, file, { version: VERSION, tokens: out } satisfies DiskFile, now);
    } catch (e) {
      log(`[browser-host] token store write failed: ${(e as Error).message}`);
    }
  };

  return {
    get: (profileDirectory) => tokens.get(profileDirectory) ?? null,
    set(profileDirectory, token) {
      if (typeof profileDirectory !== "string" || profileDirectory.length === 0 || profileDirectory.length > MAX_PROFILE) throw new Error("invalid profile");
      if (token === null) {
        if (tokens.delete(profileDirectory)) persist();
        return;
      }
      if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN) throw new Error("invalid token");
      tokens.set(profileDirectory, token);
      persist();
    },
  };
}
