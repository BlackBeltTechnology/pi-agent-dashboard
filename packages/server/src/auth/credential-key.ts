/**
 * Process-wide credential data key (design D4, D6, D9, D11).
 *
 * ONE 32-byte AES key per OS user, resolved lazily, held only in this process's
 * memory, never logged, never in argv, env, HTTP or bridge messages:
 *
 *  - `PI_DASHBOARD_DATA_KEY_FILE` set → the ONLY source (owner-only file, base64
 *    of 32 bytes, at most one trailing newline). Never created by the server.
 *  - otherwise the OS keychain (service `pi-dashboard-credential-key`, account
 *    `data-key-v1`) through a `worker_threads` Worker (`credential-key-worker.mjs`),
 *    so a macOS prompt or a Secret Service unlock never blocks the event loop.
 *    `initCredentialKey` is bounded by ONE total 10 s deadline; on expiry the
 *    state is `unavailable: keychain_timeout`, the worker is abandoned and a late
 *    answer ignored. A failure is cached for the process, except failing to take
 *    the key-creation lock (not cached: that one write is refused).
 *  - Lazy: with no credential file on disk init touches no keychain (`deferred`);
 *    a key is created only for a plaintext migration or the first credential
 *    write, under `credential-key.lock`, and never over an existing envelope.
 *
 * Tests never touch a real keychain: inject `entryFactory` (in-process provider)
 * or `workerEntry`/`workerFactory` (stub worker). Under VITEST with nothing
 * injected the keychain is refused instead of loading the native binding.
 * See change: encrypt-credentials-at-rest.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import {
  CREDENTIAL_KEYCHAIN_ACCOUNT,
  CREDENTIAL_KEYCHAIN_SERVICE,
  type CredentialFileId,
  type CredentialKeyFailureReason,
  DATA_KEY_FILE_ENV,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { checkOwnerOnly } from "../vault/vault-permissions.js";
import {
  CredentialLockedError,
  classify,
  createEnvelopeCodec,
  deriveKid,
  type EnvelopeClass,
  type KeyAvailability,
} from "./credential-envelope.js";
import { acquireLock, type JsonFileCodec } from "./locked-json-file.js";

export type { EntryFactory, KeychainEntryLike } from "./credential-key-worker.mjs";

import type { EntryFactory } from "./credential-key-worker.mjs";

/** One total deadline for `initCredentialKey`; a later `ensureCredentialKey` job gets its own. */
export const KEYCHAIN_DEADLINE_MS = 10_000;
/** Retry budget for taking `credential-key.lock` (G7). */
const CREATION_LOCK_BUDGET_MS = 2_000;
const DEFAULT_WORKER_ENTRY = new URL("./credential-key-worker.mjs", import.meta.url);
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

export type CredentialKeySource = "keychain" | "key-file";

export type CredentialKeyState =
  /** `initCredentialKey` has not run (or is still running). Reads of envelopes are locked `key_uninitialized`. */
  | { state: "uninitialized"; reason: "key_uninitialized" }
  /** Init found no credential file, so it touched no keychain. The first credential write resolves the key. */
  | { state: "deferred"; source: "keychain" }
  | { state: "ready"; source: CredentialKeySource; kid: string; created: boolean }
  | {
      state: "unavailable";
      source: CredentialKeySource;
      reason: CredentialKeyFailureReason;
      /** Short, non-secret log detail (e.g. the deepest `dlopen` reason). */
      detail?: string;
      /** `ensureCredentialKey` only: a transient refusal that was NOT cached (creation-lock contention). */
      transient?: boolean;
    };

/** What the two credential files hold on disk right now. */
export type CredentialFilesProbe = Record<CredentialFileId, EnvelopeClass>;

export interface InitCredentialKeyOptions {
  /** Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** In-process keychain provider (tests, D9). Production uses the worker. */
  entryFactory?: EntryFactory;
  /** Override the worker entry file (stub worker for tests). */
  workerEntry?: string | URL;
  /** Extra `workerData`, merged next to `job` (scripts for a stub worker). */
  workerData?: Record<string, unknown>;
  /** Override how the Worker is constructed (a constructor that throws, a counter). */
  workerFactory?: (entry: string | URL, options: WorkerOptions) => Worker;
  /** What the credential files hold. Default: classify the two real files under `homeDir`. */
  filesProbe?: () => CredentialFilesProbe;
  /** Default `os.homedir()`. */
  homeDir?: string;
  /** Platform for the key-file owner-only check (win32 injection in tests). */
  platform?: NodeJS.Platform;
  /** proper-lockfile target of the creation lock. Default `<home>/.pi/dashboard/credential-key` (lock dir `credential-key.lock`). */
  lockTarget?: string;
  /** Keychain service/account override. Spike/test seam only (a throwaway entry); production uses the shared constants. */
  keychainService?: string;
  keychainAccount?: string;
  /** Default 10 000. */
  deadlineMs?: number;
  /** Sink for `[credential-key]` lines. Default `console.log`. Never receives key material. */
  log?: (line: string) => void;
}

interface Resolved extends InitCredentialKeyOptions {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  log: (line: string) => void;
}

interface Singleton {
  opts: Resolved;
  state: CredentialKeyState;
  key?: Buffer;
  init?: Promise<CredentialKeyState>;
  ensuring?: Promise<CredentialKeyState>;
}

const UNINITIALIZED: CredentialKeyState = { state: "uninitialized", reason: "key_uninitialized" };
let current: Singleton | undefined;

export function getCredentialKeyState(): CredentialKeyState {
  return current?.state ?? UNINITIALIZED;
}

/** Test seam: forget the process key and state. */
/**
 * Drop the process-wide key state so the next `initCredentialKey` resolves again
 * (a cached failure such as `key_missing` included). Production use: the CLI
 * `credentials reset`, which renames the locked files and then creates a fresh
 * key in the same process.
 */
export function resetCredentialKeyState(): void {
  current = undefined;
}

export function _resetCredentialKeyForTests(): void {
  resetCredentialKeyState();
}

// ── helpers ──────────────────────────────────────────────────────────

const short = (text: unknown): string => {
  const line = String(text ?? "").split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
};

/** Strict base64 of exactly 32 bytes (canonical padding). `undefined` when invalid. */
function parseKeyValue(value: string): Buffer | undefined {
  if (!BASE64_32.test(value)) return undefined;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : undefined;
}

class Deadline {
  private readonly at: number;
  constructor(ms: number) { this.at = Date.now() + ms; }
  remaining(): number { return Math.max(0, this.at - Date.now()); }
}

type Timed<T> = { timedOut: false; value: T } | { timedOut: true };

function withDeadline<T>(p: Promise<T>, d: Deadline): Promise<Timed<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), d.remaining());
    p.then(
      (value) => { clearTimeout(timer); resolve({ timedOut: false, value }); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function defaultProbe(home: string): () => CredentialFilesProbe {
  const read = (file: string): EnvelopeClass => {
    try {
      return classify(fs.readFileSync(file));
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "corrupt";
    }
  };
  return () => ({
    "plugin-credentials": read(path.join(home, ".pi", "agent", "plugin-credentials.json")),
    vault: read(path.join(home, ".pi", "dashboard", "vault.json")),
  });
}

const summarize = (p: CredentialFilesProbe) => {
  const all = Object.values(p);
  return {
    envelope: all.some((c) => c === "envelope" || c === "unsupported" || c === "damaged"),
    plaintext: all.some((c) => c === "plaintext"),
  };
};

// ── key file source ─────────────────────────────────────────────────

type Failure = { ok: false; reason: CredentialKeyFailureReason; detail?: string; transient?: boolean };
type KeyResult = { ok: true; key: Buffer; created: boolean } | Failure;

function readKeyFile(file: string, o: Resolved): KeyResult {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" || code === "ENOTDIR" ? "key_file_missing" : "key_file_invalid" };
  }
  if (!st.isFile()) return { ok: false, reason: "key_file_invalid", detail: "not a regular file" };
  const own = checkOwnerOnly(file, { platform: o.platform, home: o.homeDir });
  if (!own.ok) {
    return own.basis === "missing"
      ? { ok: false, reason: "key_file_missing" }
      : { ok: false, reason: "key_file_insecure", detail: own.basis };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { ok: false, reason: "key_file_invalid", detail: (err as NodeJS.ErrnoException).code };
  }
  const key = parseKeyValue(raw.replace(/\r?\n$/, "")); // at most ONE trailing newline
  return key ? { ok: true, key, created: false } : { ok: false, reason: "key_file_invalid", detail: "not base64 of 32 bytes" };
}

// ── keychain source ─────────────────────────────────────────────────

type JobOutcome =
  | { ok: true; value: string | null; created: boolean }
  | { ok: false; reason: "keychain_unavailable" | "keychain_timeout"; detail?: string };

interface Job { op: "read" | "create"; service: string; account: string }

const isInjected = (o: Resolved) => Boolean(o.entryFactory || o.workerEntry || o.workerFactory);

async function runInProcess(job: Job, factory: EntryFactory, d: Deadline): Promise<JobOutcome> {
  try {
    const { runKeychainJob } = await import("./credential-key-worker.mjs");
    const r = await withDeadline(Promise.resolve().then(() => runKeychainJob(job, factory)), d);
    return r.timedOut ? { ok: false, reason: "keychain_timeout" } : { ok: true, ...r.value };
  } catch (err) {
    return { ok: false, reason: "keychain_unavailable", detail: short((err as Error)?.message) };
  }
}

function runInWorker(job: Job, o: Resolved, d: Deadline): Promise<JobOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: JobOutcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let worker: Worker;
    try {
      const make = o.workerFactory ?? ((entry, options) => new Worker(entry, options));
      worker = make(o.workerEntry ?? DEFAULT_WORKER_ENTRY, { workerData: { ...o.workerData, job } });
    } catch (err) {
      done({ ok: false, reason: "keychain_unavailable", detail: `worker start failed: ${short((err as Error)?.message)}` });
      return;
    }
    // Handlers stay attached after settling: an abandoned worker's late message/error must be absorbed, not thrown.
    timer = setTimeout(() => {
      worker.unref(); // abandoned: it can neither keep the process alive nor answer us any more
      done({ ok: false, reason: "keychain_timeout" });
    }, d.remaining());
    worker.on("message", (m: unknown) => {
      const msg = m as { ok?: boolean; value?: unknown; created?: unknown; detail?: unknown } | null;
      if (msg?.ok === true && (typeof msg.value === "string" || msg.value === null)) {
        done({ ok: true, value: msg.value, created: msg.created === true });
      } else {
        done({ ok: false, reason: "keychain_unavailable", detail: short(msg?.detail ?? "malformed worker message") });
      }
    });
    worker.on("error", (err: Error) => done({ ok: false, reason: "keychain_unavailable", detail: short(err?.message) }));
    // A message posted before exit is delivered first; setImmediate guards the ordering.
    worker.on("exit", (code) =>
      setImmediate(() => done({ ok: false, reason: "keychain_unavailable", detail: `worker exited (code ${code}) before answering` })),
    );
  });
}

function runJob(op: Job["op"], o: Resolved, d: Deadline): Promise<JobOutcome> {
  const job: Job = {
    op,
    service: o.keychainService ?? CREDENTIAL_KEYCHAIN_SERVICE,
    account: o.keychainAccount ?? CREDENTIAL_KEYCHAIN_ACCOUNT,
  };
  return o.entryFactory ? runInProcess(job, o.entryFactory, d) : runInWorker(job, o, d);
}

/** Turn a job outcome into a key. A malformed stored value is `keychain_unavailable` and was never overwritten. */
function toKey(out: JobOutcome, op: Job["op"]): KeyResult {
  if (!out.ok) return { ok: false, reason: out.reason, detail: out.detail };
  if (out.value === null) {
    return op === "read"
      ? { ok: false, reason: "key_missing" }
      : { ok: false, reason: "keychain_unavailable", detail: "keychain returned no value after creation" };
  }
  const key = parseKeyValue(out.value);
  return key
    ? { ok: true, key, created: out.created }
    : { ok: false, reason: "keychain_unavailable", detail: "stored value is not base64 of 32 bytes" };
}

/**
 * Take the creation lock, then read-or-create. With an envelope on disk the job
 * is a plain read (never created over ciphertext). Lock contention or an
 * unwritable lock dir is `transient` (not cached). The wait shares `d`.
 */
async function resolveUnderLock(o: Resolved, probe: () => CredentialFilesProbe, d: Deadline): Promise<KeyResult> {
  const target = o.lockTarget ?? path.join(o.homeDir, ".pi", "dashboard", "credential-key");
  let release: (() => Promise<void>) | undefined;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const acquiring = acquireLock(target, Math.min(CREATION_LOCK_BUDGET_MS, d.remaining()), (err) => {
      o.log(`[credential-key] creation lock compromised (${(err as { code?: string }).code ?? "unknown"})`);
    });
    const got = await withDeadline(acquiring, d);
    if (got.timedOut) {
      // A late acquisition must not leave the lock held.
      void acquiring.then((rel) => rel().catch(() => undefined), () => undefined);
      return { ok: false, reason: "keychain_timeout" };
    }
    release = got.value;
  } catch (err) {
    return { ok: false, reason: "keychain_unavailable", detail: `creation lock: ${(err as NodeJS.ErrnoException).code ?? "failed"}`, transient: true };
  }
  try {
    const op: Job["op"] = summarize(probe()).envelope ? "read" : "create";
    return toKey(await runJob(op, o, d), op);
  } finally {
    try { await release(); } catch { /* ignore cleanup errors */ }
  }
}

// ── state transitions ───────────────────────────────────────────────

const sourceOf = (o: Resolved): CredentialKeySource => (o.env[DATA_KEY_FILE_ENV] ? "key-file" : "keychain");

function logState(o: Resolved, st: CredentialKeyState): void {
  if (st.state === "uninitialized") return;
  const parts = [`source=${st.state === "deferred" ? "keychain" : st.source}`, `state=${st.state}`];
  if (st.state === "unavailable") parts.push(`reason=${st.reason}`);
  if (st.state === "ready") parts.push(`kid=${st.kid}`);
  parts.push(`created=${st.state === "ready" ? st.created : false}`);
  o.log(`[credential-key] ${parts.join(" ")}`);
  if (st.state === "unavailable" && st.detail) o.log(`[credential-key] keychain detail: ${st.detail}`);
}

function applyResult(s: Singleton, r: KeyResult, source: CredentialKeySource, announce: "startup" | "later"): CredentialKeyState {
  if (r.ok) {
    s.key = r.key;
    s.state = { state: "ready", source, kid: deriveKid(r.key), created: r.created };
    if (announce === "startup") logState(s.opts, s.state);
    else if (r.created) s.opts.log(`[credential-key] created source=${source} kid=${s.state.kid}`);
    else logState(s.opts, s.state);
  } else {
    s.state = { state: "unavailable", source, reason: r.reason, detail: r.detail };
    logState(s.opts, s.state);
  }
  return s.state;
}

async function runInit(s: Singleton): Promise<CredentialKeyState> {
  const o = s.opts;
  const keyFile = o.env[DATA_KEY_FILE_ENV];
  if (keyFile) return applyResult(s, readKeyFile(keyFile, o), "key-file", "startup");

  const probe = o.filesProbe ?? defaultProbe(o.homeDir);
  const has = summarize(probe());
  if (!has.envelope && !has.plaintext) {
    s.state = { state: "deferred", source: "keychain" };
    logState(o, s.state);
    return s.state;
  }
  if (!isInjected(o) && o.env.VITEST) {
    return applyResult(s, { ok: false, reason: "keychain_unavailable", detail: "VITEST: no keychain provider injected" }, "keychain", "startup");
  }

  const d = new Deadline(o.deadlineMs ?? KEYCHAIN_DEADLINE_MS);
  const read = toKey(await runJob("read", o, d), "read");
  if (read.ok || read.reason !== "key_missing" || has.envelope) return applyResult(s, read, "keychain", "startup");

  // Only plaintext on disk and no key: create it (under the lock) to migrate.
  const created = await resolveUnderLock(o, probe, d);
  if (!created.ok && created.transient) {
    // Not cached: a later credential write retries (G7).
    s.state = { state: "deferred", source: "keychain" };
    logState(o, s.state);
    if (created.detail) o.log(`[credential-key] keychain detail: ${created.detail}`);
    return s.state;
  }
  return applyResult(s, created, "keychain", "startup");
}

/**
 * Resolve the data key once per process. Never throws: every failure becomes an
 * `unavailable` state. Must be awaited before the credential stores are created.
 */
export function initCredentialKey(options: InitCredentialKeyOptions = {}): Promise<CredentialKeyState> {
  if (current?.init) return current.init;
  const opts: Resolved = {
    ...options,
    env: options.env ?? process.env,
    homeDir: options.homeDir ?? os.homedir(),
    log: options.log ?? ((line) => console.log(line)),
  };
  const s: Singleton = { opts, state: UNINITIALIZED };
  current = s;
  s.init = runInit(s).catch((err: unknown) =>
    applyResult(s, { ok: false, reason: "keychain_unavailable", detail: short((err as Error)?.message) }, sourceOf(opts), "startup"),
  );
  return s.init;
}

/**
 * Resolve the key for the first credential write while the state is `deferred`
 * (read it, or create it under the lock when no envelope is on disk). Its own
 * 10 s deadline. Returns the current state otherwise; never throws. A transient
 * refusal (creation-lock contention) is returned as `unavailable` with
 * `transient: true` and is NOT cached.
 */
export async function ensureCredentialKey(): Promise<CredentialKeyState> {
  const s = current;
  if (!s?.init) return UNINITIALIZED;
  await s.init;
  if (s.state.state !== "deferred") return s.state;
  if (s.ensuring) return s.ensuring;
  const o = s.opts;
  s.ensuring = (async (): Promise<CredentialKeyState> => {
    if (!isInjected(o) && o.env.VITEST) {
      return applyResult(s, { ok: false, reason: "keychain_unavailable", detail: "VITEST: no keychain provider injected" }, "keychain", "later");
    }
    const r = await resolveUnderLock(o, o.filesProbe ?? defaultProbe(o.homeDir), new Deadline(KEYCHAIN_DEADLINE_MS));
    if (!r.ok && r.transient) {
      if (r.detail) o.log(`[credential-key] keychain detail: ${r.detail}`);
      return { state: "unavailable", source: "keychain", reason: r.reason, detail: r.detail, transient: true };
    }
    return applyResult(s, r, "keychain", "later");
  })().finally(() => { s.ensuring = undefined; });
  return s.ensuring;
}

/**
 * Store write prologue: resolve the key (D4), or throw `CredentialLockedError`
 * with the state's reason. Call BEFORE taking the store lock.
 */
export async function ensureCredentialKeyForWrite(): Promise<void> {
  const st = await ensureCredentialKey();
  if (st.state === "ready") return;
  throw new CredentialLockedError(st.state === "unavailable" ? st.reason : "key_uninitialized");
}

// ── codec ───────────────────────────────────────────────────────────

function singletonKey(): KeyAvailability {
  const s = current;
  if (s?.state.state === "ready" && s.key) return { ok: true, key: s.key };
  if (s?.state.state === "unavailable") return { ok: false, reason: s.state.reason };
  // uninitialized or deferred: no key has been resolved in this process.
  return { ok: false, reason: "key_uninitialized" };
}

const codecs = new Map<CredentialFileId, JsonFileCodec>();

/** The fail-closed process codec for a credential file. Reads the live singleton on every call. */
export function getCredentialCodec(fileId: CredentialFileId): JsonFileCodec {
  let codec = codecs.get(fileId);
  if (!codec) {
    codec = createEnvelopeCodec(fileId, singletonKey);
    codecs.set(fileId, codec);
  }
  return codec;
}
