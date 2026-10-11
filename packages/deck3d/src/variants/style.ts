/**
 * `style.json` — types, validation and atomic I/O (spec deck3d-variant-loop
 * "style.json grammar and validation"). Every finding names its JSON path.
 */
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { type ErrorObject } from "ajv";
import { formatPath, validateOverridesFragment } from "../ir/validate.js";
import { pkgRoot } from "../util/paths.js";

export interface Variant {
  name: string;
  label: string;
  overrides: Record<string, unknown>;
}

export interface Step {
  id: string;
  title: string;
  question: string;
  slides: string[];
  round: number;
  variants: Variant[];
  picked?: string | null;
  note?: string;
  pickedAt?: string;
  pending?: boolean;
  drop?: string[];
  replaceStep?: string;
}

export interface Style {
  version: 1;
  source?: string;
  steps: Step[];
}

export interface StyleIssue {
  path: string;
  message: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(JSON.parse(readFileSync(join(pkgRoot(), "src", "variants", "schema.json"), "utf8")) as object);

function message(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "minItems":
      return `needs at least ${String(p.limit)} entries`;
    case "maxItems":
      return `allows at most ${String(p.limit)} entries`;
    case "additionalProperties":
      return `unknown key '${String(p.additionalProperty)}'`;
    case "required":
      return `missing required key '${String(p.missingProperty)}'`;
    case "type":
      return `expected ${String(p.type)}`;
    case "pattern":
      return `must match ${String(p.pattern)}`;
    default:
      return e.message ?? e.keyword;
  }
}

export const STYLE_FILE = "style.json";

/** Validate a parsed `style.json`; `slideIds` (when known) turns dangling samples into warnings. */
export function validateStyle(style: unknown, slideIds?: Set<string>): { errors: StyleIssue[]; warnings: StyleIssue[] } {
  const errors: StyleIssue[] = [];
  const warnings: StyleIssue[] = [];
  if (!check(style)) {
    for (const e of check.errors ?? []) errors.push({ path: formatPath(e.instancePath), message: message(e) });
    return { errors, warnings };
  }
  const s = style as Style;
  s.steps.forEach((step, i) => {
    const names = new Set<string>();
    step.variants.forEach((v, j) => {
      if (names.has(v.name)) errors.push({ path: `steps[${i}].variants[${j}].name`, message: `duplicate variant name '${v.name}'` });
      names.add(v.name);
      for (const issue of validateOverridesFragment(v.overrides)) {
        errors.push({ path: `steps[${i}].variants[${j}].overrides${issue.path === "(root)" ? "" : `.${issue.path}`}`, message: issue.message });
      }
    });
    if (typeof step.picked === "string" && !names.has(step.picked)) {
      errors.push({ path: `steps[${i}].picked`, message: `'${step.picked}' names no variant (one of ${[...names].join(", ")})` });
    }
    if (slideIds) {
      for (const id of step.slides) {
        if (!slideIds.has(id)) warnings.push({ path: `steps[${i}].slides`, message: `sample slide '${id}' is not in the deck (skipped)` });
      }
    }
  });
  const ids = new Set<string>();
  s.steps.forEach((step, i) => {
    if (ids.has(step.id)) errors.push({ path: `steps[${i}].id`, message: `duplicate step id '${step.id}'` });
    ids.add(step.id);
  });
  return { errors, warnings };
}

export function stylePath(deckDir: string): string {
  return join(deckDir, STYLE_FILE);
}

export function readStyle(path: string): Style | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Style;
}

/**
 * Write via a temp file + rename, so a reader never sees a half-written file.
 * The temp name is unique per call: a PID alone collided between two writers
 * (or two writes) in one process.
 */
export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, path);
  } catch (err) {
    // Do not leave the temp file behind when the swap fails.
    rmSync(tmp, { force: true });
    throw err;
  }
}

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export interface LockOptions {
  /** How long to wait for a LIVE holder before giving up (default: fail at once). */
  waitMs?: number;
  /** Test seams for forced interleavings. */
  hooks?: {
    /** After a stale lock was inspected, before the recovery lock is taken. */
    afterInspect?: (lock: string) => void;
    /** Holding the recovery lock, after re-reading the lock, right before removing it. */
    beforeUnlink?: (lock: string) => void;
  };
}

const POLL_MS = 40;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `pid:token` → pid; undefined for anything else (empty, garbage). */
function ownerOf(content: string): number | undefined {
  const m = /^(\d+):/.exec(content);
  return m ? Number(m[1]) : undefined;
}

type Attempt = { token: string } | { retry: true } | { busy: string };

/**
 * Create `path` atomically WITH its owner inside it: the content goes to a
 * private temp file that is `link`ed to `path` (atomic, EEXIST when it already
 * exists), so no other process can ever observe the file empty or half-written.
 * Returns the owner token, or undefined when `path` already exists.
 */
function createWithOwner(path: string): string | undefined {
  const token = `${process.pid}:${randomBytes(6).toString("hex")}`;
  const tmp = `${path}.${token.replace(":", "-")}.tmp`;
  writeFileSync(tmp, token);
  try {
    linkSync(tmp, path);
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return undefined;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
  }
}

/** Remove `path` only if it still holds `token` (never a lock that is not ours). */
function releaseOwned(path: string, token: string): void {
  try {
    if (readFileSync(path, "utf8") === token) unlinkSync(path);
  } catch {
    // Already gone: nothing left to release.
  }
}

/**
 * One acquisition attempt. A held lock is only taken over when its owner is
 * provably dead, and only under a separate recovery lock, re-reading the lock
 * first: if it is no longer the one we inspected we leave it alone and
 * re-inspect. A lock we cannot identify is treated as live. The recovery lock
 * is never expired by age — a recoverer that is merely slow is still the
 * recoverer — so one left by a crash is reported with its pid for manual removal.
 */
function tryAcquire(lock: string, hooks: LockOptions["hooks"]): Attempt {
  const token = createWithOwner(lock);
  if (token) return { token };
  let content: string;
  try {
    content = readFileSync(lock, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { retry: true }; // released meanwhile
    throw err;
  }
  const owner = ownerOf(content);
  if (owner === undefined) return { busy: `unidentifiable lock ${lock}; if no other deck3d process is running, remove it` };
  if (alive(owner)) return { busy: `another deck3d process is writing this deck (pid ${owner}); if it crashed, remove ${lock}` };

  hooks?.afterInspect?.(lock);
  const recover = `${lock}.recover`;
  const rtoken = createWithOwner(recover);
  if (!rtoken) {
    let who = "unknown";
    try {
      who = String(ownerOf(readFileSync(recover, "utf8")) ?? "unknown");
    } catch {
      // Released meanwhile; the next attempt decides.
    }
    return { busy: `another process is recovering ${lock} (pid ${who}); if it crashed, remove ${recover}` };
  }
  try {
    // Only the holder of the recovery lock may remove a lock, and only the one inspected.
    if (readFileSync(lock, "utf8") === content) {
      hooks?.beforeUnlink?.(lock);
      unlinkSync(lock);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  } finally {
    releaseOwned(recover, rtoken);
  }
  return { retry: true };
}

function release(lock: string, token: string): void {
  releaseOwned(lock, token);
}

function lockPathOf(deckDir: string): string {
  return `${stylePath(deckDir)}.lock`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` holding the deck's exclusive lock. A pick is a read-validate step
 * and three writes (style pending → deck.json → style final); two writers
 * interleaving them can leave the deck and the recorded pick from different
 * decisions. The lock is released on every path out, success or throw.
 */
export function withStyleLock<T>(deckDir: string, fn: () => T, opts: LockOptions = {}): T {
  const lock = lockPathOf(deckDir);
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    const got = tryAcquire(lock, opts.hooks);
    if ("token" in got) {
      try {
        return fn();
      } finally {
        release(lock, got.token);
      }
    }
    if ("busy" in got && Date.now() >= deadline) throw new LockError(got.busy);
    if ("busy" in got) sleepSync(POLL_MS);
  }
}

/** Async twin for callers that hold the lock across awaits (serve's rebuild). */
export async function withStyleLockAsync<T>(deckDir: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const lock = lockPathOf(deckDir);
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    const got = tryAcquire(lock, opts.hooks);
    if ("token" in got) {
      try {
        return await fn();
      } finally {
        release(lock, got.token);
      }
    }
    if ("busy" in got && Date.now() >= deadline) throw new LockError(got.busy);
    if ("busy" in got) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export const serialize = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/** First step with `pending: true` (an interrupted pick), if any. */
export function pendingStep(style: Style): Step | undefined {
  return style.steps.find((s) => s.pending === true);
}

export function interruptedMessage(step: Step): string {
  const name = step.picked ?? step.variants[0]?.name ?? "<variant>";
  return `an earlier pick of step '${step.id}' was interrupted (style.json has pending: true); re-run: deck3d variants pick ${step.id} ${name}`;
}
