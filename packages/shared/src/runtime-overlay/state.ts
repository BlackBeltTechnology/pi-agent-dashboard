/**
 * Runtime-overlay state files + effective-source derivation (pure core).
 *
 * `~/.pi/dashboard/runtime/` holds two files, ONE writer each:
 *   - `request.json` — written ONLY by the dashboard server (Settings →
 *     Updates): `source`, `sourceEpoch` (uuid, created with the file),
 *     `sourceSeq` (int ≥ 1, +1 per selection), `channel`, `pin`, `pending`,
 *     `activateNonce`.
 *   - `state.json`   — written ONLY by Electron main: `localPath`,
 *     `localBinding {epoch, seq}`, `current`, `previous`, `bad`, `attempts`,
 *     `handledNonce`, `lastFailure`.
 *
 * Both writers preserve unknown keys (forward compat across runtime
 * versions) and write atomically (tmp + rename, Windows EPERM retry). A
 * missing/corrupt file reads as defaults and never throws.
 *
 * The effective source is DERIVED, never stored: `local` only when
 * `state.localPath` is set AND `state.localBinding` deep-equals the request's
 * valid `{sourceEpoch, sourceSeq}` — so local can only ever turn OFF without
 * an app-menu action (fail-closed).
 *
 * See change: electron-runtime-overlay-updates (D2).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type DashboardPathsEnv, getDashboardConfigDir } from "../dashboard-paths.js";
import { headShaOr, statusPorcelainOr } from "../platform/git.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Sources the SERVER may select (never `local` — D7). */
export type RuntimeSource = "bundled" | "npm" | "github";
export type EffectiveSource = RuntimeSource | "local";
export type RuntimeChannel = "stable" | "beta";

export interface RuntimeRequest {
  source: RuntimeSource;
  sourceEpoch?: string;
  sourceSeq?: number;
  channel?: RuntimeChannel;
  /** Exact version pin; overrides `channel` when set. */
  pin?: string;
  /** Staged runtime id awaiting activation. */
  pending?: string;
  activateNonce?: string;
  [unknownKey: string]: unknown;
}

export interface RuntimeBinding {
  epoch: string;
  seq: number;
}

export interface LocalSnapshot {
  gitSha: string | null;
  dirty: boolean;
}

export interface RuntimeFailure {
  id: string;
  reason: string;
  at?: string;
  snapshot?: LocalSnapshot;
}

export interface RuntimeState {
  localPath?: string;
  localBinding?: RuntimeBinding;
  current?: string;
  previous?: string;
  bad?: Record<string, { reason: string; snapshot?: LocalSnapshot }>;
  attempts?: Record<string, number>;
  handledNonce?: string;
  lastFailure?: RuntimeFailure;
  [unknownKey: string]: unknown;
}

// ── Paths + ids ─────────────────────────────────────────────────────────────

export const RUNTIME_REQUEST_FILE = "request.json";
export const RUNTIME_STATE_FILE = "state.json";
export const BUNDLED_RUNTIME_ID = "bundled";

/** `~/.pi/dashboard/runtime/`. */
export function getRuntimeOverlayDir(env?: DashboardPathsEnv): string {
  return path.join(getDashboardConfigDir(env), "runtime");
}

/** Runtime id of a linked checkout: `local:<realpath>`. */
export function localRuntimeId(realPath: string): string {
  return `local:${realPath}`;
}

/**
 * Identity of a linked checkout. The id is keyed on the realpath ONLY; git
 * SHA + dirty flag are an informational snapshot (not part of the key).
 */
export function deriveLocalIdentity(checkoutPath: string): { id: string; realPath: string; snapshot: LocalSnapshot } {
  const realPath = fs.realpathSync(checkoutPath);
  const gitSha = headShaOr({ cwd: realPath }) ?? null;
  const dirty = gitSha !== null && statusPorcelainOr({ cwd: realPath }).trim() !== "";
  return { id: localRuntimeId(realPath), realPath, snapshot: { gitSha, dirty } };
}

// ── Validation + derivation ─────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES: ReadonlySet<string> = new Set<RuntimeSource>(["bundled", "npm", "github"]);

function isValidBinding(epoch: unknown, seq: unknown): boolean {
  return typeof epoch === "string" && UUID_RE.test(epoch) && Number.isInteger(seq) && (seq as number) >= 1;
}

function isRuntimeSource(v: unknown): v is RuntimeSource {
  return typeof v === "string" && SOURCES.has(v);
}

/**
 * Effective runtime source (fail-closed). `local` in exactly one case:
 * localPath set, request binding valid, state binding valid, and equal.
 * Otherwise the request's source, or `bundled` when the request is invalid.
 */
export function deriveEffectiveSource(request: RuntimeRequest | null, state: RuntimeState): EffectiveSource {
  const base: RuntimeSource = request && isRuntimeSource(request.source) ? request.source : "bundled";
  if (!request || typeof state.localPath !== "string" || state.localPath === "") return base;
  const b = state.localBinding;
  if (!b || !isValidBinding(request.sourceEpoch, request.sourceSeq) || !isValidBinding(b.epoch, b.seq)) return base;
  return b.epoch === request.sourceEpoch && b.seq === request.sourceSeq ? "local" : base;
}

// ── IO ──────────────────────────────────────────────────────────────────────

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Atomic JSON write: tmp + rename; retries Windows rename EPERM/EBUSY (AV / reader locks). */
export function atomicWriteJson(file: string, value: unknown, attempts = 5): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (i >= attempts || !RETRYABLE.has(code)) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(20 * i);
    }
  }
}

/**
 * Read `request.json`. Null when missing, unparsable, or not an object —
 * callers that must bind to it (the app-menu local pick) refuse on null.
 * A parsed object is returned as-is (unknown keys included); validation is
 * `deriveEffectiveSource`'s job.
 */
export function readRuntimeRequest(dir: string): RuntimeRequest | null {
  return readJsonObject(path.join(dir, RUNTIME_REQUEST_FILE)) as RuntimeRequest | null;
}

/** Read `state.json`; missing/corrupt → `{}`. */
export function readRuntimeState(dir: string): RuntimeState {
  return (readJsonObject(path.join(dir, RUNTIME_STATE_FILE)) ?? {}) as RuntimeState;
}

/**
 * SERVER writer: record a source selection. Bumps `sourceSeq` (which turns
 * any local binding off) or, when the file is missing/corrupt/legacy
 * (no valid epoch), starts a fresh epoch at seq 1. Unknown keys preserved.
 */
export function selectRuntimeSource(
  dir: string,
  selection: { source: RuntimeSource; channel?: RuntimeChannel; pin?: string | null },
): RuntimeRequest {
  const raw = readJsonObject(path.join(dir, RUNTIME_REQUEST_FILE)) ?? {};
  const hasBinding = isValidBinding(raw.sourceEpoch, raw.sourceSeq);
  const next: RuntimeRequest = {
    ...raw,
    source: selection.source,
    sourceEpoch: hasBinding ? (raw.sourceEpoch as string) : randomUUID(),
    sourceSeq: hasBinding ? (raw.sourceSeq as number) + 1 : 1,
  };
  if (selection.channel !== undefined) next.channel = selection.channel;
  if (selection.pin === null) delete next.pin;
  else if (selection.pin !== undefined) next.pin = selection.pin;
  atomicWriteJson(path.join(dir, RUNTIME_REQUEST_FILE), next);
  return next;
}

/**
 * SERVER writer: patch non-selection fields (`pending`, `activateNonce`, …)
 * without touching the source binding. Creates the file (fresh epoch, seq 1,
 * source `bundled`) when missing/corrupt. Unknown keys preserved.
 */
export function patchRuntimeRequest(
  dir: string,
  patch: Partial<Omit<RuntimeRequest, "source" | "sourceEpoch" | "sourceSeq">>,
): RuntimeRequest {
  const raw = readJsonObject(path.join(dir, RUNTIME_REQUEST_FILE));
  const base: Record<string, unknown> =
    raw && isValidBinding(raw.sourceEpoch, raw.sourceSeq)
      ? raw
      : { ...(raw ?? {}), source: isRuntimeSource(raw?.source) ? raw.source : "bundled", sourceEpoch: randomUUID(), sourceSeq: 1 };
  const next = { ...base, ...patch } as RuntimeRequest;
  atomicWriteJson(path.join(dir, RUNTIME_REQUEST_FILE), next);
  return next;
}

/**
 * ELECTRON writer: merge a patch — or an updater's result — over `state.json`.
 * Both forms merge onto the current object, so unknown keys survive even when
 * an updater returns only the fields it changed. Clear a key by setting it to
 * `undefined` (dropped by JSON serialization).
 */
export function patchRuntimeState(
  dir: string,
  patch: Partial<RuntimeState> | ((current: RuntimeState) => Partial<RuntimeState>),
): RuntimeState {
  const current = readRuntimeState(dir);
  const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
  atomicWriteJson(path.join(dir, RUNTIME_STATE_FILE), next);
  return next;
}
