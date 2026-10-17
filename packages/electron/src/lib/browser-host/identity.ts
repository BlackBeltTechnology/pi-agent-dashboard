/**
 * Operator host identity: an Ed25519 key pair generated on first use, the
 * derived `hostId`, the registration payload and `sign(nonce, serverId)`.
 *
 * - The private key is stored ONLY through `safeStorage` (`browser-host-key.json`,
 *   0600); where encryption is unavailable (or Linux `basic_text`) the key pair
 *   lives in memory for this run, nothing is written, and the next launch mints
 *   a fresh identity. It never leaves this module.
 * - `sign` refuses unless `serverId` equals the `/api/health` `instanceId` main
 *   fetches from the target the window is switched to (a rogue/other server's
 *   challenge cannot be signed). It signs
 *   `"pi-browser-host-v1\n" + nonce + "\n" + serverId`.
 * - Profile rows are bounded (≤64; `profileDirectory` ≤128 without path
 *   separators; label ≤128; email ≤254) — the same bounds the server enforces.
 *
 * Imports nothing from electron — unit-tested in `__tests__/identity.test.ts`.
 *
 * See change: add-operator-browser-relay (D2, D8).
 */
import { createPrivateKey, generateKeyPairSync, type KeyObject, sign as edSign } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildHostSignedMessage, hostIdFromPublicKey } from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import type { BrowserHostIdentity } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type { BrowserHostProfileRow } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { chromeUserDataDir, listChromeProfiles, type ProfileDiscoveryDeps } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { canEncrypt, type CryptoPort, decrypt, encrypt, type EncryptedBlob, type FsPort, nodeFsPort, readVersionedJson, writeJsonAtomic } from "./store.js";
import type { TargetPort } from "./target.js";

const KEY_FILE = "browser-host-key.json";
const KEY_VERSION = 1;
const MAX_LABEL = 128;
const MAX_PROFILES = 64;
const MAX_EMAIL = 254;
const MAX_NONCE = 256;
const PATH_SEPARATOR = /[\\/]/;

/** Local Chrome facts the registration carries; swapped for a fake in tests. */
export interface ChromePort {
  /** A desktop Chrome user-data directory exists on this machine. */
  canOpen(): boolean;
  listProfiles(): Promise<BrowserHostProfileRow[]>;
}

/** Real Chrome port over the shared pure helpers (the same ones the browser plugin uses). */
export function createChromePort(deps: ProfileDiscoveryDeps = {}): ChromePort {
  const platform = deps.platform ?? process.platform;
  const userDataDir = deps.userDataDir ?? chromeUserDataDir(platform, deps.env ?? process.env);
  const exists = deps.exists ?? existsSync;
  return {
    canOpen: () => exists(userDataDir),
    listProfiles: async () => (await listChromeProfiles({ ...deps, userDataDir, platform })).profiles,
  };
}

/** Drop rows that violate the bounds; truncate over-long labels. */
function boundProfiles(rows: BrowserHostProfileRow[]): BrowserHostProfileRow[] {
  const out: BrowserHostProfileRow[] = [];
  for (const r of rows) {
    if (out.length >= MAX_PROFILES) break;
    if (!r || typeof r.profileDirectory !== "string" || r.profileDirectory.length === 0 || r.profileDirectory.length > MAX_LABEL) continue;
    if (PATH_SEPARATOR.test(r.profileDirectory) || r.profileDirectory.includes("..")) continue;
    const row: BrowserHostProfileRow = {
      profileDirectory: r.profileDirectory,
      label: String(r.label ?? r.profileDirectory).slice(0, MAX_LABEL),
      installed: r.installed === true,
    };
    if (typeof r.email === "string" && r.email.length > 0 && r.email.length <= MAX_EMAIL) row.email = r.email;
    out.push(row);
  }
  return out;
}

export interface HostIdentityOptions {
  dir: string;
  crypto: CryptoPort;
  label: () => string;
  platform: string;
  chrome: ChromePort;
  target: TargetPort;
  fs?: FsPort;
  log?: (line: string) => void;
  now?: () => number;
}

export interface HostIdentity {
  identity(): Promise<BrowserHostIdentity>;
  sign(nonce: string, serverId: string): Promise<string>;
}

interface KeyDisk {
  version: number;
  publicKey: string;
  privateKey: EncryptedBlob;
}

interface Loaded {
  publicKey: string;
  hostId: string;
  privateKey: KeyObject;
}

export function createHostIdentity(opts: HostIdentityOptions): HostIdentity {
  const fsp = opts.fs ?? nodeFsPort;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const file = path.join(opts.dir, KEY_FILE);
  let loaded: Loaded | undefined;

  const fromPrivateDer = (publicKey: string, pkcs8Base64: string): Loaded =>
    ({ publicKey, hostId: hostIdFromPublicKey(publicKey), privateKey: createPrivateKey({ key: Buffer.from(pkcs8Base64, "base64"), format: "der", type: "pkcs8" }) });

  const restore = (): Loaded | undefined => {
    if (!canEncrypt(opts.crypto)) return undefined;
    const disk = readVersionedJson<KeyDisk>({ fsp, file, asideStem: "browser-host-key", now, log }, KEY_VERSION);
    if (!disk || typeof disk.publicKey !== "string") return undefined;
    const plain = decrypt(opts.crypto, disk.privateKey);
    if (plain === null) return undefined;
    try {
      const k = fromPrivateDer(disk.publicKey, plain);
      return k.hostId === hostIdFromPublicKey(disk.publicKey) ? k : undefined;
    } catch {
      return undefined;
    }
  };

  const generate = (): Loaded => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    if (canEncrypt(opts.crypto)) {
      try {
        writeJsonAtomic(fsp, file, { version: KEY_VERSION, publicKey: pub, privateKey: encrypt(opts.crypto, priv) } satisfies KeyDisk, now);
      } catch (e) {
        log(`[browser-host] identity write failed: ${(e as Error).message}`); // memory-only for this run
      }
    }
    return { publicKey: pub, hostId: hostIdFromPublicKey(pub), privateKey };
  };

  const key = (): Loaded => (loaded ??= restore() ?? generate());

  return {
    async identity() {
      const k = key();
      return {
        hostId: k.hostId,
        publicKey: k.publicKey,
        label: opts.label().slice(0, MAX_LABEL),
        platform: opts.platform,
        canOpenChrome: opts.chrome.canOpen(),
        profiles: boundProfiles(await opts.chrome.listProfiles()),
      };
    },
    async sign(nonce, serverId) {
      if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > MAX_NONCE) throw new Error("invalid nonce");
      if (typeof serverId !== "string" || serverId.length === 0) throw new Error("invalid serverId");
      const targetId = await opts.target.instanceId(); // rejects when unverifiable
      if (targetId !== serverId) throw new Error("serverId does not match the target server");
      return edSign(null, Buffer.from(buildHostSignedMessage(nonce, serverId), "utf-8"), key().privateKey).toString("base64");
    },
  };
}
