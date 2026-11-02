/**
 * Kit for the credential-key suites: a counting stub keychain (in-process
 * `EntryFactory`), a sandbox that runs the REAL `credential-key-worker.mjs`
 * against a FAKE `@napi-rs/keyring` package (no real keychain, D9), a worker
 * counter, and `writeVia` which models a store write (ensure the key, then
 * write through the singleton codec under the store lock).
 * See change: encrypt-credentials-at-rest (test-plan E11–E25, X1–X6b, P1–P3, E98).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { CredentialFileId } from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { encodeEnvelope } from "../../auth/credential-envelope.js";
import {
  type EntryFactory,
  ensureCredentialKeyForWrite,
  getCredentialCodec,
} from "../../auth/credential-key.js";
import { withLockedJsonFile, writeJsonAtomic } from "../../auth/locked-json-file.js";

export const KEY_1 = Buffer.alloc(32, 0x11);
export const KEY_2 = Buffer.alloc(32, 0x22);
export const b64 = (key: Buffer): string => key.toString("base64");
export const sha256 = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

export const filePath = (id: CredentialFileId, home = os.homedir()): string =>
  id === "vault"
    ? path.join(home, ".pi", "dashboard", "vault.json")
    : path.join(home, ".pi", "agent", "plugin-credentials.json");

export const lockTarget = (home = os.homedir()): string => path.join(home, ".pi", "dashboard", "credential-key");

/** Remove both credential files, their siblings and the creation lock. */
export function resetCredentialFiles(home = os.homedir()): void {
  for (const dir of [path.join(home, ".pi", "agent"), path.join(home, ".pi", "dashboard")]) {
    fs.mkdirSync(dir, { recursive: true });
    try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
    for (const f of fs.readdirSync(dir)) {
      if (/^(plugin-credentials|vault|credential-key)/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }
  }
}

export function writePlain(id: CredentialFileId, doc: unknown): string {
  const f = filePath(id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  return f;
}

export function writeEnvelopeFile(id: CredentialFileId, doc: unknown, key: Buffer): string {
  const f = filePath(id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, encodeEnvelope(doc, key, id), { mode: 0o600 });
  return f;
}

export function writeKeyFile(content: string, mode = 0o600): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-keyfile-")), "data-key");
  fs.writeFileSync(f, content, { mode });
  fs.chmodSync(f, mode);
  return f;
}

/** A store write: resolve the key first (D4), then write through the singleton codec under the store lock. */
export async function writeVia(id: CredentialFileId, doc: unknown): Promise<void> {
  await ensureCredentialKeyForWrite();
  const f = filePath(id);
  const codec = getCredentialCodec(id);
  await withLockedJsonFile(f, () => writeJsonAtomic(f, doc, undefined, codec), { codec });
}

export interface StubKeychain {
  factory: EntryFactory;
  calls: { get: number; set: number; ctor: unknown[][]; order: string[] };
  /** Current stored value (mutable: tests may delete it to simulate key loss). */
  value: string | null;
  lastSet: string | null;
}

/** In-process stub keychain with call counting. Never touches a real keychain. */
export function stubKeychain(
  initial: string | null = null,
  behaviour: { getThrowsOnce?: boolean; readBackAfterSet?: string } = {},
): StubKeychain {
  let thrown = false;
  let afterSet = false;
  const stub: StubKeychain = {
    value: initial,
    lastSet: null,
    calls: { get: 0, set: 0, ctor: [], order: [] },
    factory: (service, account, options) => {
      stub.calls.ctor.push([service, account, options]);
      return {
        getPassword: () => {
          stub.calls.get++;
          stub.calls.order.push("get");
          if (behaviour.getThrowsOnce && !thrown) {
            thrown = true;
            throw new Error("Couldn't access platform storage: PermissionDenied");
          }
          if (afterSet && behaviour.readBackAfterSet !== undefined) return behaviour.readBackAfterSet;
          return stub.value;
        },
        setPassword: (p) => {
          stub.calls.set++;
          stub.calls.order.push("set");
          stub.lastSet = p;
          afterSet = true;
          stub.value = p;
        },
      };
    },
  };
  return stub;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STUB_WORKER_ENTRY = path.join(HERE, "stub-keychain-worker.mjs");
const REAL_WORKER = path.resolve(HERE, "../../auth/credential-key-worker.mjs");

/** Counts (and can later reap) every Worker the module under test creates. */
export function countingWorkerFactory(): {
  factory: (entry: string | URL, options: WorkerOptions) => Worker;
  readonly count: number;
  reap(): Promise<void>;
} {
  const made: Worker[] = [];
  return {
    factory: (entry, options) => {
      const w = new Worker(entry, options);
      made.push(w);
      return w;
    },
    get count() { return made.length; },
    reap: async () => { await Promise.all(made.map((w) => w.terminate().catch(() => 0))); },
  };
}

export interface KeyringSandbox {
  /** Copy of the real worker entry placed next to a fake `node_modules/@napi-rs/keyring`. */
  workerEntry: string;
  storeFile: string;
  logFile: string;
  /** Parsed fake-keyring call log (`new` with its options, `get`, `set`). */
  log(): Array<{ op: string; service?: string; account?: string; options?: unknown }>;
  /** Env the worker (and any child process) needs to find the fake store/log. */
  env: Record<string, string>;
  cleanup(): void;
}

const FAKE_KEYRING = `
const fs = require("fs");
const store = process.env.FAKE_KEYRING_STORE;
const log = process.env.FAKE_KEYRING_LOG;
if (process.env.FAKE_KEYRING_LOAD_ERROR === "dlopen") {
  const inner = new Error("dlopen(/x/keyring.darwin-arm64.node, 0x0001): code signature in <ABC> not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs");
  const mid = new Error("Cannot find module './keyring.darwin-arm64.node'");
  mid.cause = inner;
  const top = new Error("Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try \`npm i\` again after removing both package-lock.json and node_modules directory.");
  top.cause = [new Error("Cannot find module '@napi-rs/keyring-darwin-arm64'"), mid];
  throw top;
}
const read = () => { try { return JSON.parse(fs.readFileSync(store, "utf8")); } catch { return {}; } };
class Entry {
  constructor(service, account, options) {
    this.k = service + "/" + account;
    fs.appendFileSync(log, JSON.stringify({ op: "new", service, account, options: options === undefined ? null : options }) + "\\n");
  }
  getPassword() {
    fs.appendFileSync(log, JSON.stringify({ op: "get" }) + "\\n");
    const v = read()[this.k];
    return v === undefined ? null : v;
  }
  setPassword(p) {
    fs.appendFileSync(log, JSON.stringify({ op: "set" }) + "\\n");
    const s = read(); s[this.k] = p; fs.writeFileSync(store, JSON.stringify(s));
  }
}
exports.Entry = Entry;
`;

export function createKeyringSandbox(): KeyringSandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-keyring-sandbox-"));
  const pkg = path.join(dir, "node_modules", "@napi-rs", "keyring");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@napi-rs/keyring", version: "0.0.0-fake", main: "index.js" }));
  fs.writeFileSync(path.join(pkg, "index.js"), FAKE_KEYRING);
  const workerEntry = path.join(dir, "credential-key-worker.mjs");
  fs.copyFileSync(REAL_WORKER, workerEntry);
  const storeFile = path.join(dir, "store.json");
  const logFile = path.join(dir, "calls.log");
  fs.writeFileSync(logFile, "");
  return {
    workerEntry,
    storeFile,
    logFile,
    env: { FAKE_KEYRING_STORE: storeFile, FAKE_KEYRING_LOG: logFile },
    log: () =>
      fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Collects `log` lines handed to `initCredentialKey({ log })`. */
export function logSink(): { log: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (l) => lines.push(l), lines };
}
