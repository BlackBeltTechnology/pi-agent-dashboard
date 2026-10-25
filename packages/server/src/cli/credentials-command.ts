/**
 * `pi-dashboard credentials status|decrypt|reset` (design D7, D8, D11; decisions
 * G6, G10, G11). Local-only: no HTTP route, no value ever printed. Output carries
 * file basenames, state tokens, reason codes and the key `kid` only; errors are
 * reduced to an errno-style code (never a message that could echo content).
 *
 *  - `status`  read-only. Reads the keychain only when a credential file exists
 *              and NEVER creates a key.
 *  - `decrypt` rollback: refuse on any live server, confirm, hold BOTH store locks
 *              (plugin-credentials → vault) for the run, decode ALL files before
 *              writing ANY, rewrite each as 0600 plaintext.
 *  - `reset`   key loss: same server check + confirm + locks; rename the LOCKED
 *              file(s) to `<basename>.undecryptable-<stamp>`; release the store
 *              locks; only THEN (keychain source, no key, no envelope left) create
 *              a key under `credential-key.lock`. Never creates a key file.
 *
 * Lock order matches the server (D4): store locks and the key-creation lock are
 * never held together. See change: encrypt-credentials-at-rest (task 8.1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  CREDENTIAL_FILE_BASENAMES,
  CREDENTIAL_FILE_IDS,
  type CredentialFileId,
  DATA_KEY_FILE_ENV,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { localDialHost } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { classify, type EnvelopeClass } from "../auth/credential-envelope.js";
import {
  type CredentialFilesProbe,
  type CredentialKeyState,
  getCredentialCodec,
  getCredentialKeyState,
  type InitCredentialKeyOptions,
  initCredentialKey,
  resetCredentialKeyState,
} from "../auth/credential-key.js";
import { acquireLock, writeJsonAtomic } from "../auth/locked-json-file.js";
import { getLockPath, getMetaPath, type LockMetadata, readMetadata } from "../lifecycle/home-lock.js";
import { isProcessAlive as defaultIsProcessAlive, readPid } from "../spawn-process/server-pid.js";

export const CREDENTIALS_USAGE =
  "usage: pi-dashboard credentials status | decrypt [--yes] | reset [--vault] [--plugin-credentials] [--yes]";

/** Exit codes: 0 ok, 1 refused or any file failed, 2 usage. */
const CREDENTIALS_EXIT = { ok: 0, failed: 1, usage: 2 } as const;

const LOCK_BUDGET_MS = 2_000;
const HEALTH_TIMEOUT_MS = 3_000;
/** Flags `buildConfig` consumes (and their values) that may precede the verb. */
const CONFIG_VALUE_FLAGS: ReadonlySet<string> = new Set(["--port", "--host", "--pi-port"]);

/** Injectable seams (tests); production passes none. */
export interface CredentialsDeps {
  /** Default `os.homedir()`. */
  homeDir?: string;
  /** Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  err?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /** `/api/health` bound (ms). Default 3000. */
  timeoutMs?: number;
  /** Default: `<home>/.pi/dashboard/server.pid`. */
  readPid?: () => number | null;
  isProcessAlive?: (pid: number) => boolean;
  /** Default: the per-HOME lock metadata under `<home>/.pi/dashboard`. */
  readLockMeta?: () => LockMetadata | null;
  /** Interactive confirmation: `isTTY` selects the prompt. Default `process.stdin`. */
  stdin?: { isTTY?: boolean };
  prompt?: (question: string) => Promise<string>;
  /** Default `new Date()` (the `.undecryptable-<stamp>`). */
  now?: () => Date;
  /** Key-source seams forwarded to `initCredentialKey` (stub keychain / stub worker in tests, D9). */
  keyOptions?: Pick<
    InitCredentialKeyOptions,
    "entryFactory" | "workerEntry" | "workerData" | "workerFactory" | "platform" | "deadlineMs" | "lockTarget"
  >;
  /** Test seam: runs once BOTH store locks are held, before any file is read. */
  afterLocked?: () => void | Promise<void>;
}

type Verb = "status" | "decrypt" | "reset";
interface Parsed {
  verb: Verb;
  yes: boolean;
  vault: boolean;
  plugin: boolean;
}

interface Ctx {
  home: string;
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  deps: CredentialsDeps;
  port: number;
  host: string | undefined;
  files: FileSpec[];
}

interface FileSpec {
  id: CredentialFileId;
  name: string;
  file: string;
}

/** Lock order: plugin credentials first, then vault (D7). `CREDENTIAL_FILE_IDS` is already in that order. */
function credentialFiles(home: string): FileSpec[] {
  const dirOf = (id: CredentialFileId) => (id === "vault" ? path.join(home, ".pi", "dashboard") : path.join(home, ".pi", "agent"));
  return CREDENTIAL_FILE_IDS.map((id) => ({
    id,
    name: CREDENTIAL_FILE_BASENAMES[id],
    file: path.join(dirOf(id), CREDENTIAL_FILE_BASENAMES[id]),
  }));
}

// ── argv ────────────────────────────────────────────────────────────

const FLAG_KEYS: Readonly<Record<string, "yes" | "vault" | "plugin">> = {
  "--yes": "yes",
  "-y": "yes",
  "--vault": "vault",
  "--plugin-credentials": "plugin",
};
const isVerb = (v: string | undefined): v is Verb => v === "status" || v === "decrypt" || v === "reset";

type Scanned = { words: string[]; set: { yes: boolean; vault: boolean; plugin: boolean } } | { error: string };

function scanArgs(argv: readonly string[]): Scanned {
  const set = { yes: false, vault: false, plugin: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (CONFIG_VALUE_FLAGS.has(a)) { i++; continue; }
    const key = FLAG_KEYS[a];
    if (key) set[key] = true;
    else if (a.startsWith("-")) return { error: `unknown flag '${a.slice(0, 40)}'` };
    else words.push(a);
  }
  return { words, set };
}

function parseCredentialsArgs(argv: readonly string[]): Parsed | { error: string } {
  const scanned = scanArgs(argv);
  if ("error" in scanned) return scanned;
  const { words, set } = scanned;
  const verb = words[0];
  if (words.length > 1) return { error: "expected exactly one verb" };
  if (!isVerb(verb)) return { error: verb === undefined ? "missing verb" : `unknown verb '${verb.slice(0, 40)}'` };
  if (verb === "status" && (set.yes || set.vault || set.plugin)) return { error: "status takes no flags" };
  if (verb === "decrypt" && (set.vault || set.plugin)) return { error: "--vault/--plugin-credentials apply to reset only" };
  return { verb, ...set };
}

// ── helpers ─────────────────────────────────────────────────────────

/** An errno-style code, never an error message (messages can echo paths or content). */
const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Z0-9_]{2,32}$/.test(c) ? c : "error";
};

function readBytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function classOf(file: string): EnvelopeClass {
  try {
    return classify(readBytes(file));
  } catch {
    return "corrupt";
  }
}

/**
 * Resolve the key for THIS command from a fresh singleton. `map` rewrites what the
 * key module believes is on disk, so the command never triggers a creation it did
 * not mean to (`status`/`decrypt`/`reset`'s first pass never create a key):
 *  - `plaintext→absent`: only envelopes make the module touch the keychain;
 *  - `plaintext→envelope`: any file counts, but a missing key is read-only `key_missing`;
 *  - `absent→plaintext`: the creating pass of `reset` (an envelope still blocks creation).
 */
async function freshInit(ctx: Ctx, map: (c: EnvelopeClass) => EnvelopeClass): Promise<CredentialKeyState> {
  // One-shot CLI process, but the singleton may carry an earlier state (tests, repeated runs).
  resetCredentialKeyState();
  const filesProbe = (): CredentialFilesProbe => {
    const p = {} as CredentialFilesProbe;
    for (const f of ctx.files) p[f.id] = map(classOf(f.file));
    return p;
  };
  return initCredentialKey({
    ...ctx.deps.keyOptions,
    env: ctx.env,
    homeDir: ctx.home,
    filesProbe,
    log: () => {},
  });
}

// ── running-server check (D7 step 1, G11) ───────────────────────────

const isRefused = (e: unknown): boolean => {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED";
};

/**
 * `null` = no live server. Any HTTP reply (401 included) refuses; ONLY a refused
 * connection proceeds (timeout, reset or any other outcome cannot prove absence).
 * A live pid named by `server.pid` or the per-HOME lock metadata also refuses,
 * so a second dashboard on another port cannot re-encrypt the files afterwards.
 */
async function liveServerRefusal(ctx: Ctx): Promise<string | null> {
  const { deps } = ctx;
  const alive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const pidPath = path.join(ctx.home, ".pi", "dashboard", "server.pid");
  const pid = (deps.readPid ?? (() => readPid({ pidPath })))();
  if (pid !== null && alive(pid)) {
    return `[credentials] a dashboard server of this HOME is running (pid ${pid}); stop it first`;
  }
  const meta = (deps.readLockMeta ?? (() => readMetadata(getMetaPath(getLockPath(ctx.home)))))();
  if (meta && Number.isInteger(meta.pid) && alive(meta.pid)) {
    return `[credentials] a dashboard server of this HOME is running (pid ${meta.pid}, port ${meta.httpPort}); stop it first`;
  }
  if (!(ctx.port > 0)) return null; // port 0 (temp-HOME guard): nothing to dial
  const url = `http://${localDialHost(ctx.host)}:${ctx.port}/api/health`;
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? HEALTH_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return `[credentials] a server answers on port ${ctx.port} (HTTP ${res.status}); stop it first`;
  } catch (e) {
    if (isRefused(e)) return null;
    return `[credentials] cannot confirm that no server runs on port ${ctx.port} (${codeOf(e)}); stop it first`;
  }
}

// ── confirmation ────────────────────────────────────────────────────

async function defaultPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

/** `--yes`, or a `y`/`yes` answer on a TTY. No TTY and no `--yes` refuses. */
async function confirmed(ctx: Ctx, question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  const stdin = ctx.deps.stdin ?? process.stdin;
  if (!stdin.isTTY) {
    ctx.err("[credentials] confirmation needed: run in a terminal or pass --yes; nothing changed");
    return false;
  }
  const answer = (await (ctx.deps.prompt ?? defaultPrompt)(question)).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  ctx.err("[credentials] aborted; nothing changed");
  return false;
}

// ── store locks (plugin-credentials → vault) ────────────────────────

/** Hold BOTH store locks, in file order, for the whole of `fn`. Released in reverse. */
async function withStoreLocks(ctx: Ctx, fn: () => Promise<number>): Promise<number> {
  const released: Array<() => Promise<void>> = [];
  try {
    for (const f of ctx.files) {
      fs.mkdirSync(path.dirname(f.file), { recursive: true });
      try {
        released.push(await acquireLock(f.file, LOCK_BUDGET_MS, () => {}));
      } catch (e) {
        ctx.err(`[credentials] cannot lock ${f.name} (${codeOf(e)}); is another process writing it? nothing changed`);
        return CREDENTIALS_EXIT.failed;
      }
    }
    await ctx.deps.afterLocked?.();
    return await fn();
  } finally {
    for (const release of released.reverse()) {
      try { await release(); } catch { /* ignore cleanup errors */ }
    }
  }
}

// ── status ──────────────────────────────────────────────────────────

function countSiblings(f: FileSpec, kind: "corrupt" | "undecryptable"): number {
  try {
    const prefix = `${f.name}.${kind}-`;
    return fs.readdirSync(path.dirname(f.file)).filter((n) => n.startsWith(prefix)).length;
  } catch {
    return 0;
  }
}

function fileStateLine(f: FileSpec): string {
  let bytes: Buffer | null;
  try {
    bytes = readBytes(f.file);
  } catch (e) {
    return `${f.name}: unreadable ${codeOf(e)}`;
  }
  if (bytes === null) return `${f.name}: absent`;
  const out = getCredentialCodec(f.id).decode(bytes);
  if (out.kind === "absent") return `${f.name}: absent`;
  if (out.kind === "locked") return `${f.name}: locked ${out.reason}`;
  if (out.kind === "corrupt") return `${f.name}: corrupt`;
  return `${f.name}: ${out.encrypted ? "encrypted" : "plaintext"}`;
}

async function runStatus(ctx: Ctx): Promise<number> {
  const classes = ctx.files.map((f) => classOf(f.file));
  // Any existing file makes the key module read the key; a missing key stays a read-only `key_missing`.
  let st = await freshInit(ctx, (c) => (c === "plaintext" ? "envelope" : c));
  const encryptedOnDisk = classes.some((c) => c === "envelope" || c === "unsupported" || c === "damaged");
  const keyFile = Boolean(ctx.env[DATA_KEY_FILE_ENV]);
  // Plaintext only and no key yet: the server creates it on its next start/write. Not a failure.
  if (st.state === "unavailable" && st.reason === "key_missing" && !keyFile && !encryptedOnDisk) {
    st = { state: "deferred", source: "keychain" };
  }
  const source = st.state === "deferred" ? "keychain" : st.state === "uninitialized" ? "keychain" : st.source;
  const parts = [`source=${source}`, `state=${st.state}`];
  if (st.state === "unavailable") parts.push(`reason=${st.reason}`);
  if (st.state === "ready") parts.push(`kid=${st.kid}`);
  ctx.out(parts.join(" "));
  for (const f of ctx.files) ctx.out(fileStateLine(f));
  const corrupt = ctx.files.reduce((n, f) => n + countSiblings(f, "corrupt"), 0);
  const undecryptable = ctx.files.reduce((n, f) => n + countSiblings(f, "undecryptable"), 0);
  ctx.out(`corrupt=${corrupt} undecryptable=${undecryptable}`);
  return CREDENTIALS_EXIT.ok;
}

// ── decrypt ─────────────────────────────────────────────────────────

type DecryptPlan =
  | { kind: "decrypt"; f: FileSpec; doc: Record<string, unknown> }
  | { kind: "result"; f: FileSpec; line: string; failed: boolean }
  | { kind: "blocked"; f: FileSpec; reason: string };

function planDecrypt(f: FileSpec): DecryptPlan {
  let bytes: Buffer | null;
  try {
    bytes = readBytes(f.file);
  } catch (e) {
    return { kind: "blocked", f, reason: codeOf(e) };
  }
  if (bytes === null) return { kind: "result", f, line: `${f.name}: absent`, failed: false };
  const out = getCredentialCodec(f.id).decode(bytes);
  if (out.kind === "absent") return { kind: "result", f, line: `${f.name}: absent`, failed: false };
  if (out.kind === "locked") return { kind: "blocked", f, reason: out.reason };
  if (out.kind === "corrupt") return { kind: "result", f, line: `${f.name}: failed corrupt`, failed: true };
  if (!out.encrypted) return { kind: "result", f, line: `${f.name}: already-plaintext`, failed: false };
  return { kind: "decrypt", f, doc: out.data };
}

/** Atomic plaintext rewrite (0600). A failed rename must not leave a plaintext `.tmp` behind. */
function writePlaintext(f: FileSpec, doc: Record<string, unknown>): string | null {
  try {
    writeJsonAtomic(f.file, doc, 0o600);
    return null;
  } catch (e) {
    try { fs.rmSync(`${f.file}.tmp`, { force: true }); } catch { /* best effort */ }
    return codeOf(e);
  }
}

async function runDecrypt(ctx: Ctx, parsed: Parsed): Promise<number> {
  const refusal = await liveServerRefusal(ctx);
  if (refusal) { ctx.err(refusal); return CREDENTIALS_EXIT.failed; }
  if (!(await confirmed(ctx, "Rewrite the encrypted credential files as PLAINTEXT? [y/N] ", parsed.yes))) {
    return CREDENTIALS_EXIT.failed;
  }
  // Only envelopes need the key; plaintext-only hosts never touch the keychain here.
  await freshInit(ctx, (c) => (c === "plaintext" ? "absent" : c));
  return withStoreLocks(ctx, async () => (applyDecrypt(ctx, ctx.files.map(planDecrypt)) ? CREDENTIALS_EXIT.failed : CREDENTIALS_EXIT.ok));
}

/**
 * Report (and, only when EVERY file decoded, write) the plans. All-or-nothing:
 * one blocked file means no write at all. Returns `true` when any file is not decrypted.
 */
function applyDecrypt(ctx: Ctx, plans: DecryptPlan[]): boolean {
  const blocked = plans.some((p) => p.kind === "blocked");
  let failed = blocked;
  for (const p of plans) {
    if (p.kind === "result") {
      ctx.out(p.line);
      failed ||= p.failed;
    } else if (p.kind === "blocked") {
      ctx.out(`${p.f.name}: failed ${p.reason}`);
    } else if (blocked) {
      ctx.out(`${p.f.name}: failed not-written`);
    } else {
      const code = writePlaintext(p.f, p.doc);
      ctx.out(code === null ? `${p.f.name}: decrypted` : `${p.f.name}: failed ${code}`);
      failed ||= code !== null;
    }
  }
  return failed;
}

// ── reset ───────────────────────────────────────────────────────────

/** `YYYYMMDDTHHMMSSZ` (G6). */
const stampOf = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** Rename `file` aside to `<file>.undecryptable-<stamp>[-N]`; returns the backup basename. Never overwrites. */
function renameAside(file: string, stamp: string): string {
  const base = `${file}.undecryptable-${stamp}`;
  let target = base;
  for (let n = 1; fs.existsSync(target); n++) target = `${base}-${n}`;
  fs.renameSync(file, target);
  return path.basename(target);
}

function resetFile(ctx: Ctx, f: FileSpec, stamp: string): { line: string; renamed: boolean; failed: boolean } {
  let bytes: Buffer | null;
  try {
    bytes = readBytes(f.file);
  } catch (e) {
    return { line: `${f.name}: failed ${codeOf(e)}`, renamed: false, failed: true };
  }
  const out = bytes === null ? { kind: "absent" as const } : getCredentialCodec(f.id).decode(bytes);
  if (out.kind !== "locked") return { line: `${f.name}: not-locked`, renamed: false, failed: false };
  try {
    return { line: `${f.name}: reset (kept as ${renameAside(f.file, stamp)})`, renamed: true, failed: false };
  } catch (e) {
    return { line: `${f.name}: failed ${codeOf(e)}`, renamed: false, failed: true };
  }
}

/** After the store locks are released: remedy for a key file, or create the keychain key (E76). */
async function afterReset(ctx: Ctx, first: CredentialKeyState): Promise<number> {
  const keyFile = ctx.env[DATA_KEY_FILE_ENV];
  if (keyFile) {
    const st = getCredentialKeyState();
    if (st.state !== "unavailable") return CREDENTIALS_EXIT.ok;
    // The server never creates a key file. An insecure file may hold the right key: do not suggest overwriting it.
    ctx.out(
      st.reason === "key_file_insecure"
        ? `chmod 600 ${keyFile}`
        : `openssl rand -base64 32 > ${keyFile}; chmod 600 ${keyFile}`,
    );
    ctx.err(`[credentials] the key file is not usable (${st.reason}); the server refuses credential writes until it is`);
    return CREDENTIALS_EXIT.failed;
  }
  if (first.state !== "unavailable") return CREDENTIALS_EXIT.ok; // a key exists (or nothing to resolve)
  if (first.reason !== "key_missing") {
    ctx.err(`[credentials] no key was created (${first.reason}); fix the key source and restart the server`);
    return CREDENTIALS_EXIT.failed;
  }
  // Fresh singleton: creates under `credential-key.lock` unless an envelope still blocks creation.
  const second = await freshInit(ctx, (c) => (c === "absent" ? "plaintext" : c));
  if (second.state === "ready" && second.created) ctx.out("key: created");
  else if (second.state === "unavailable" && second.reason !== "key_missing") {
    ctx.err(`[credentials] no key was created (${second.reason}); fix the key source and restart the server`);
    return CREDENTIALS_EXIT.failed;
  }
  return CREDENTIALS_EXIT.ok;
}

async function runReset(ctx: Ctx, parsed: Parsed): Promise<number> {
  const refusal = await liveServerRefusal(ctx);
  if (refusal) { ctx.err(refusal); return CREDENTIALS_EXIT.failed; }
  if (!(await confirmed(ctx, "Rename the undecryptable credential file(s) aside? [y/N] ", parsed.yes))) {
    return CREDENTIALS_EXIT.failed;
  }
  const both = !parsed.vault && !parsed.plugin;
  const inScope = (f: FileSpec) => both || (f.id === "vault" ? parsed.vault : parsed.plugin);
  let renamed = 0;
  let failed = false;
  const stamp = stampOf((ctx.deps.now ?? (() => new Date()))());
  // First pass never creates a key: only an envelope makes the module read the keychain.
  const first = await freshInit(ctx, (c) => (c === "plaintext" ? "absent" : c));
  const locksCode = await withStoreLocks(ctx, async () => {
    for (const f of ctx.files) {
      if (!inScope(f)) continue;
      const r = resetFile(ctx, f, stamp);
      ctx.out(r.line);
      if (r.renamed) renamed++;
      failed ||= r.failed;
    }
    return CREDENTIALS_EXIT.ok;
  });
  // Store locks are released here (withStoreLocks' finally) BEFORE any key creation.
  if (locksCode !== CREDENTIALS_EXIT.ok) return locksCode;
  if (renamed === 0) return failed ? CREDENTIALS_EXIT.failed : CREDENTIALS_EXIT.ok;
  const after = await afterReset(ctx, first);
  return failed ? CREDENTIALS_EXIT.failed : after;
}

// ── entry ───────────────────────────────────────────────────────────

/** Returns the process exit code. `argv` = everything but the `credentials` word. */
export async function cmdCredentials(
  argv: readonly string[],
  opts: { port: number; host?: string },
  deps: CredentialsDeps = {},
): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const parsed = parseCredentialsArgs(argv);
  if ("error" in parsed) {
    err(`[credentials] ${parsed.error}`);
    err(CREDENTIALS_USAGE);
    return CREDENTIALS_EXIT.usage;
  }
  const home = deps.homeDir ?? os.homedir();
  const ctx: Ctx = { home, env: deps.env ?? process.env, out, err, deps, port: opts.port, host: opts.host, files: credentialFiles(home) };
  try {
    if (parsed.verb === "status") return await runStatus(ctx);
    if (parsed.verb === "decrypt") return await runDecrypt(ctx, parsed);
    return await runReset(ctx, parsed);
  } catch (e) {
    err(`[credentials] ${parsed.verb} failed (${codeOf(e)})`);
    return CREDENTIALS_EXIT.failed;
  }
}
