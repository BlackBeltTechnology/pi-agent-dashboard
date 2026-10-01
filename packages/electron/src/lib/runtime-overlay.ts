/**
 * runtime-overlay.ts — Electron-main side of the runtime overlay.
 *
 *   - planColdLaunch()          — resolver inputs from request.json + state.json,
 *                                  applying the pending / attempts / bad rules.
 *   - beginAttempt / recordColdFailure / shouldCountAttempt — the retry-once rule.
 *   - pickLocalFolder / stopUsingLocalFolder — app-menu local link (D7).
 *   - watchActivationRequests()  — 2 s poll of request.json#activateNonce (D3).
 *   - switchRuntime()            — stop old (PID-gated) → gate → re-point
 *                                  extension → spawn → pid+id health gate →
 *                                  commit | rollback | environmental abort.
 *
 * Electron writes ONLY state.json; request.json is read-only here (D2).
 * All process/network I/O of switchRuntime is injected (SwitchRuntimeDeps).
 *
 * See change: electron-runtime-overlay-updates (D2, D3, D8, D9).
 */
import fs from "node:fs";
import path from "node:path";
import {
  BUNDLED_RUNTIME_ID,
  deriveEffectiveSource,
  localRuntimeId,
  patchRuntimeState,
  type RuntimeRequest,
  type RuntimeState,
  readRuntimeRequest,
  readRuntimeState,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import type { LaunchSource, RuntimeLaunchInputs } from "./launch-source.js";
import { claimCandidate, expectExit, releaseCandidate, releaseRuntimeSwitchOwnership } from "./runtime-switch-ownership.js";

/** Old server must exit within this window, else the switch aborts (D3). */
export const SWITCH_OLD_EXIT_DEADLINE_MS = 60_000;
/** A pending runtime is tried at most this many times before it is marked bad. */
const MAX_ATTEMPTS = 2;
const ACTIVATION_POLL_MS = 2_000;
const STOP_POLL_MS = 250;

// ── ids ↔ roots ─────────────────────────────────────────────────────────────

const LOCAL_PREFIX = "local:";

function overlayVersionRoot(dir: string, version: string): string {
  return path.join(dir, "versions", version);
}

/** Directory holding a runtime's bridge extension (D8). */
export function extensionPathFor(runtimeId: string, dir: string, resourcesPath: string): string {
  if (runtimeId === BUNDLED_RUNTIME_ID) return path.join(resourcesPath, "server", "packages", "extension");
  if (runtimeId.startsWith(LOCAL_PREFIX)) return path.join(runtimeId.slice(LOCAL_PREFIX.length), "packages", "extension");
  return path.join(overlayVersionRoot(dir, runtimeId), "node_modules", "@blackbelt-technology", "pi-dashboard-extension");
}

/** Runtime kind + root for an id. */
export function runtimeLocation(runtimeId: string, dir: string): { kind: "bundled" | "localLink" | "overlay"; root: string | null } {
  if (runtimeId === BUNDLED_RUNTIME_ID) return { kind: "bundled", root: null };
  if (runtimeId.startsWith(LOCAL_PREFIX)) return { kind: "localLink", root: runtimeId.slice(LOCAL_PREFIX.length) };
  return { kind: "overlay", root: overlayVersionRoot(dir, runtimeId) };
}

function isOverlayId(id: string | undefined): id is string {
  return !!id && id !== BUNDLED_RUNTIME_ID && !id.startsWith(LOCAL_PREFIX);
}

// ── Cold launch planning (pure over the two files) ──────────────────────────

export interface ColdLaunchPlan {
  inputs: RuntimeLaunchInputs;
  /** Pending runtime this launch would activate (null when nothing to activate). */
  activating: string | null;
}

/**
 * Resolver inputs for a cold launch. Side effect: a pending runtime that
 * already used all its attempts without committing (the app died mid-
 * activation) is marked bad here — "retry at most once" (E12).
 */
export function planColdLaunch(dir: string, exclude: ReadonlySet<string> = new Set()): ColdLaunchPlan {
  consumeExplicitUpdate(dir);
  const request = readRuntimeRequest(dir);
  const pending = typeof request?.pending === "string" ? request.pending : undefined;
  const state = markExhaustedPending(dir, readRuntimeState(dir), pending);
  const effectiveSource = deriveEffectiveSource(request, state);
  const skip = (id: string) => exclude.has(id) || !!state.bad?.[id];

  const inputs: RuntimeLaunchInputs = { effectiveSource };
  let activating: string | null = null;

  const localId = effectiveSource === "local" && state.localPath ? localRuntimeId(state.localPath) : null;
  if (localId && state.localPath && !skip(localId)) {
    inputs.local = { runtimeId: localId, root: state.localPath };
    if (localId !== state.current) activating = localId;
  }

  const overlays = overlayCandidateIds(state, pending, skip);
  const pendingFirst = pending !== undefined && pending !== state.current && overlays[0] === pending;
  if (pendingFirst && (effectiveSource === "npm" || effectiveSource === "github")) activating = pending;
  inputs.overlays = overlays.map((id) => ({ runtimeId: id, root: overlayVersionRoot(dir, id) }));
  return { inputs, activating };
}

/** Pending that used all attempts without committing (app died mid-activation) → bad (E12). */
function markExhaustedPending(dir: string, state: RuntimeState, pending: string | undefined): RuntimeState {
  if (!pending || pending === state.current || state.bad?.[pending]) return state;
  if ((state.attempts?.[pending] ?? 0) < MAX_ATTEMPTS) return state;
  return patchRuntimeState(dir, (s) => ({
    bad: { ...s.bad, [pending]: { reason: "crashed_before_commit" } },
    lastFailure: { id: pending, reason: "crashed_before_commit", at: new Date().toISOString() },
  }));
}

/** Overlay ids in preference order: pending, current, previous — minus skipped/duplicates. */
function overlayCandidateIds(state: RuntimeState, pending: string | undefined, skip: (id: string) => boolean): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (isOverlayId(id) && !skip(id) && !ids.includes(id)) ids.push(id);
  };
  if (pending !== state.current) add(pending);
  add(state.current);
  add(state.previous);
  return ids;
}

/**
 * An explicit Update (server writes a fresh `request.pendingNonce`) is a user
 * action on the pending id: clear its bad entry + attempts exactly once.
 * Returns true when a new nonce was consumed.
 */
function consumeExplicitUpdate(dir: string): boolean {
  const request = readRuntimeRequest(dir);
  const nonce = request?.pendingNonce;
  const pending = request?.pending;
  if (typeof nonce !== "string" || typeof pending !== "string") return false;
  if (readRuntimeState(dir).handledPendingNonce === nonce) return false;
  clearBad(dir, pending);
  patchRuntimeState(dir, { handledPendingNonce: nonce });
  return true;
}

/** An attempt is counted only for a runtime that is not already committed (E11). */
export function shouldCountAttempt(state: RuntimeState, runtimeId: string): boolean {
  return runtimeId !== BUNDLED_RUNTIME_ID && runtimeId !== state.current;
}

export function beginAttempt(dir: string, runtimeId: string): void {
  patchRuntimeState(dir, (s) => ({ attempts: { ...s.attempts, [runtimeId]: (s.attempts?.[runtimeId] ?? 0) + 1 } }));
}

/** Cold-launch health failure: record it; mark bad once the attempts are used up. */
export function recordColdFailure(dir: string, runtimeId: string, reason: string): void {
  patchRuntimeState(dir, (s) => ({
    lastFailure: { id: runtimeId, reason, at: new Date().toISOString() },
    ...((s.attempts?.[runtimeId] ?? 0) >= MAX_ATTEMPTS || runtimeId.startsWith(LOCAL_PREFIX)
      ? { bad: { ...s.bad, [runtimeId]: { reason } } }
      : {}),
  }));
}

/** Commit `runtimeId` as current; the prior current becomes previous. */
export function commitRuntime(dir: string, runtimeId: string, priorId: string): RuntimeState {
  return patchRuntimeState(dir, (s) => {
    const attempts = { ...s.attempts };
    delete attempts[runtimeId];
    return {
      current: runtimeId,
      previous: priorId !== runtimeId ? priorId : s.previous,
      attempts,
    };
  });
}

function markBad(dir: string, runtimeId: string, reason: string): void {
  patchRuntimeState(dir, (s) => ({
    bad: { ...s.bad, [runtimeId]: { reason } },
    lastFailure: { id: runtimeId, reason, at: new Date().toISOString() },
  }));
}

/** Explicit user action on an id clears its bad entry and attempts (D2). */
export function clearBad(dir: string, runtimeId: string): void {
  patchRuntimeState(dir, (s) => {
    const bad = { ...s.bad };
    const attempts = { ...s.attempts };
    delete bad[runtimeId];
    delete attempts[runtimeId];
    return { bad, attempts };
  });
}

/** Delete `versions/*` except the kept ids (D9). Staging dirs (`*.partial`) are the stager's. */
export function pruneVersions(dir: string, keep: ReadonlyArray<string | undefined>): void {
  const versions = path.join(dir, "versions");
  let entries: string[];
  try {
    entries = fs.readdirSync(versions);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.endsWith(".partial") || keep.includes(name)) continue;
    fs.rmSync(path.join(versions, name), { recursive: true, force: true });
  }
}

// ── Local folder (app menu only — D7) ───────────────────────────────────────

export type PickLocalResult =
  | { ok: true; runtimeId: string }
  | { ok: false; error: "request_unreadable" | "invalid_folder"; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bind a picked checkout to the current `{sourceEpoch, sourceSeq}`. Refuses
 * when request.json is missing/unreadable/legacy (E3) or the folder is not a
 * dashboard checkout. Re-picking clears the id's bad + attempts (E13b).
 */
export function pickLocalFolder(dir: string, picked: string): PickLocalResult {
  const request = readRuntimeRequest(dir);
  const epoch = request?.sourceEpoch;
  const seq = request?.sourceSeq;
  if (!request || typeof epoch !== "string" || !UUID_RE.test(epoch) || !Number.isInteger(seq) || (seq as number) < 1) {
    return { ok: false, error: "request_unreadable" };
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync(picked);
  } catch {
    return { ok: false, error: "invalid_folder", detail: picked };
  }
  const cli = path.join(realPath, "packages", "server", "src", "cli.ts");
  if (!fs.existsSync(cli)) return { ok: false, error: "invalid_folder", detail: `missing ${cli}` };

  const runtimeId = localRuntimeId(realPath);
  clearBad(dir, runtimeId);
  patchRuntimeState(dir, { localPath: realPath, localBinding: { epoch, seq: seq as number } });
  return { ok: true, runtimeId };
}

/** "Runtime → Stop using local folder". */
export function stopUsingLocalFolder(dir: string): void {
  patchRuntimeState(dir, { localPath: undefined, localBinding: undefined });
}

// ── Activation watcher (D3) ─────────────────────────────────────────────────

/** Runtime to activate for the current request: pending/current overlay, local, or bundled. */
export function activationTarget(dir: string): string {
  const request = readRuntimeRequest(dir);
  const state = readRuntimeState(dir);
  const source = deriveEffectiveSource(request, state);
  if (source === "local" && state.localPath) return localRuntimeId(state.localPath);
  if (source === "npm" || source === "github") {
    if (typeof request?.pending === "string") return request.pending;
    if (isOverlayId(state.current)) return state.current;
  }
  return BUNDLED_RUNTIME_ID;
}

/**
 * Poll request.json every 2 s; call `onActivate` once per new `activateNonce`
 * that differs from `state.handledNonce`. The caller records `handledNonce`.
 * Returns a stop function.
 */
export function watchActivationRequests(opts: {
  dir: string;
  onActivate: (request: RuntimeRequest) => void;
  intervalMs?: number;
}): () => void {
  let delivered: string | undefined;
  const timer = setInterval(() => {
    consumeExplicitUpdate(opts.dir);
    const request = readRuntimeRequest(opts.dir);
    const nonce = request?.activateNonce;
    if (!request || typeof nonce !== "string" || nonce === delivered) return;
    if (nonce === readRuntimeState(opts.dir).handledNonce) {
      delivered = nonce;
      return;
    }
    delivered = nonce;
    opts.onActivate(request);
  }, opts.intervalMs ?? ACTIVATION_POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ── switchRuntime (D3) ──────────────────────────────────────────────────────

type SpawnableSource = Exclude<LaunchSource, { kind: "attach" }>;

export interface SwitchRuntimeDeps {
  dir: string;
  log: (msg: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** GET /api/health → the answering server's pid, `runtime.id` and `runtime.owner`. */
  probeHealth: () => Promise<{ pid: number; runtimeId?: string; owner?: string } | null>;
  storedPid: () => number | null;
  /**
   * True only for a server this app spawned (owner token — survives
   * `/api/restart`) or adopted (stored PID). Never a foreign/Standalone one.
   */
  ownsServer: (health: { pid: number; owner?: string }) => boolean;
  /** Graceful stop with restart intent (sessions re-attach) — NOT user-quit. */
  stopServer: () => Promise<void>;
  isPidAlive: (pid: number) => boolean;
  isPortFree: () => Promise<boolean>;
  /** Compat gate + preflight → spawnable source (D6). */
  gateCandidate: (runtimeId: string) => { ok: true; source: SpawnableSource } | { ok: false; reason: string };
  extensionPathFor: (runtimeId: string) => string;
  /** Durable (fsync) settings.json re-point (D8). Throws when it could not be written. */
  registerExtension: (extensionPath: string) => void;
  /**
   * Spawn + readiness wait. Calls `onSpawned` (child PID) before readiness;
   * resolves with the PID the readiness probe reported; rejects on failure.
   */
  spawn: (
    source: SpawnableSource,
    hooks: { onSpawned: (pid: number) => void; onExit: (code: number | null, signal: NodeJS.Signals | null) => void },
  ) => Promise<{ reportedPid: number }>;
  /** Terminate a failed candidate; resolves once it is gone (port released). */
  kill: (pid: number) => Promise<void>;
  isPortConflict: (err: unknown) => boolean;
  pruneVersions: (keep: ReadonlyArray<string | undefined>) => void;
  /** Exit of a runtime AFTER it was committed → the normal crash watchdog. */
  onCommittedExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export type SwitchResult =
  | { kind: "committed"; runtimeId: string }
  | { kind: "rolledBack"; runtimeId: string; failedId: string; reason: string }
  | { kind: "aborted"; reason: "old_server_alive" | "port_in_use" | "extension_register_failed" | "not_owned"; detail?: string }
  | { kind: "failed"; reason: string };

type EnvironmentalReason = "port_in_use" | "extension_register_failed";
type StartOutcome =
  | { ok: true; pid: number }
  | { ok: false; environmental: EnvironmentalReason; reason: string }
  | { ok: false; environmental: null; reason: string };

async function startRuntime(runtimeId: string, oldPid: number | null, deps: SwitchRuntimeDeps): Promise<StartOutcome> {
  const gate = deps.gateCandidate(runtimeId);
  if (!gate.ok) return { ok: false, environmental: null, reason: gate.reason };

  // Re-point the bridge extension BEFORE the spawn (D8). A failed re-point is
  // environmental: never spawn with the wrong extension registered.
  try {
    deps.registerExtension(deps.extensionPathFor(runtimeId));
  } catch (err) {
    return { ok: false, environmental: "extension_register_failed", reason: err instanceof Error ? err.message : String(err) };
  }

  const stateBefore = readRuntimeState(deps.dir);
  const counted = shouldCountAttempt(stateBefore, runtimeId);
  const attemptsBefore = stateBefore.attempts?.[runtimeId];
  if (counted) beginAttempt(deps.dir, runtimeId);

  let pid: number | null = null;
  let committed = false;
  const hooks = {
    onSpawned: (p: number) => {
      pid = p;
      claimCandidate(p);
    },
    onExit: (code: number | null, signal: NodeJS.Signals | null) => {
      if (committed) deps.onCommittedExit(code, signal);
      // pre-commit exits are handled right here (rollback), never by the watchdog
    },
  };

  const fail = async (environmental: EnvironmentalReason | null, reason: string): Promise<StartOutcome> => {
    if (pid !== null) await deps.kill(pid); // never start a fallback while the candidate holds the port
    // An environmental failure is not an attempt of X (D3).
    if (environmental && counted) undoAttempt(deps.dir, runtimeId, attemptsBefore);
    return environmental ? { ok: false, environmental, reason } : { ok: false, environmental: null, reason };
  };

  let reportedPid: number;
  try {
    ({ reportedPid } = await deps.spawn(gate.source, hooks));
  } catch (err) {
    if (deps.isPortConflict(err)) return fail("port_in_use", "port_in_use");
    return fail(null, err instanceof Error ? err.message : String(err));
  }

  // No false commits: the answering server must be the one this spawn reported,
  // must serve this runtime id, and must not be the old server.
  const health = await deps.probeHealth();
  if (!health || health.pid !== reportedPid || health.pid === oldPid || health.runtimeId !== runtimeId) {
    return fail(null, `health_identity_mismatch pid=${health?.pid ?? "none"} runtime=${health?.runtimeId ?? "none"}`);
  }
  committed = true;
  releaseCandidate(reportedPid); // a crash from here on is the watchdog's (X8)
  return { ok: true, pid: reportedPid };
}

async function waitOldExit(oldPid: number | null, deps: SwitchRuntimeDeps): Promise<boolean> {
  const deadline = deps.now() + SWITCH_OLD_EXIT_DEADLINE_MS;
  while (true) {
    const alive = oldPid !== null && deps.isPidAlive(oldPid);
    if (!alive && (await deps.isPortFree())) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(STOP_POLL_MS);
  }
}

/** Mark the candidate bad, then start previous → bundle (extension re-pointed before each spawn). */
async function rollback(
  targetId: string,
  priorId: string,
  oldPid: number | null,
  reason: string,
  deps: SwitchRuntimeDeps,
): Promise<SwitchResult> {
  markBad(deps.dir, targetId, reason);
  deps.log(`[runtime-overlay] rollback: ${targetId} bad (${reason})`);
  for (const fallback of [priorId, BUNDLED_RUNTIME_ID]) {
    if (fallback === targetId) continue;
    const res = await startRuntime(fallback, oldPid, deps);
    if (res.ok) {
      if (fallback !== priorId) commitRuntime(deps.dir, fallback, priorId);
      deps.log(`[runtime-overlay] rolled back to ${fallback}`);
      return { kind: "rolledBack", runtimeId: fallback, failedId: targetId, reason };
    }
    deps.log(`[runtime-overlay] rollback target ${fallback} failed: ${res.reason}`);
  }
  return { kind: "failed", reason };
}

/**
 * Switch the running dashboard to `targetId`. Never attaches, never touches
 * the global graceful flag (PID-scoped ownership instead), never writes
 * request.json. See D3 for the full contract.
 */
export async function switchRuntime(targetId: string, deps: SwitchRuntimeDeps): Promise<SwitchResult> {
  const health = await deps.probeHealth();
  if (health && !deps.ownsServer(health)) {
    // Attached to a Standalone/Bridge/foreign server: never stop it.
    deps.log(`[runtime-overlay] abort: server pid=${health.pid} is not managed by this app`);
    return { kind: "aborted", reason: "not_owned" };
  }
  const oldPid = health?.pid ?? deps.storedPid();
  const priorId = health?.runtimeId ?? readRuntimeState(deps.dir).current ?? BUNDLED_RUNTIME_ID;
  deps.log(`[runtime-overlay] switch ${priorId} → ${targetId} (old pid=${oldPid ?? "none"})`);

  try {
    if (oldPid !== null) expectExit(oldPid);
    if (health) await deps.stopServer();
    if (!(await waitOldExit(oldPid, deps))) {
      deps.log(`[runtime-overlay] abort: old server pid=${oldPid} still alive after ${SWITCH_OLD_EXIT_DEADLINE_MS}ms`);
      return { kind: "aborted", reason: "old_server_alive" };
    }

    const started = await startRuntime(targetId, oldPid, deps);
    if (started.ok) {
      const state = commitRuntime(deps.dir, targetId, priorId);
      deps.pruneVersions([state.current, state.previous]);
      deps.log(`[runtime-overlay] commit ${targetId} (previous=${state.previous ?? "none"})`);
      return { kind: "committed", runtimeId: targetId };
    }

    if (started.environmental) {
      deps.log(`[runtime-overlay] abort: ${started.reason} starting ${targetId}; restoring ${priorId}`);
      const restored = await startRuntime(priorId, oldPid, deps);
      if (!restored.ok) deps.log(`[runtime-overlay] restore of ${priorId} failed: ${restored.reason}`);
      return { kind: "aborted", reason: started.environmental, detail: started.reason };
    }

    return await rollback(targetId, priorId, oldPid, started.reason, deps);
  } finally {
    releaseRuntimeSwitchOwnership();
  }
}

/**
 * Serialize switches: each request runs after the previous one finished, with
 * its OWN target, and resolves with its own result (so a nonce is recorded as
 * handled only for the switch that actually served it).
 */
export function createSwitchQueue(run: (targetId: string) => Promise<SwitchResult>): (targetId: string) => Promise<SwitchResult> {
  let tail: Promise<unknown> = Promise.resolve();
  return (targetId) => {
    const next = tail.then(() => run(targetId));
    tail = next.catch(() => undefined);
    return next;
  };
}

// ── Cold-launch candidate spawn ─────────────────────────────────────────────

export interface ColdSpawnDeps {
  spawn: SwitchRuntimeDeps["spawn"];
  probeHealth: SwitchRuntimeDeps["probeHealth"];
  /** Terminate a failed candidate; resolves once it is gone (port released). */
  kill: (pid: number) => Promise<void>;
  isPortConflict: (err: unknown) => boolean;
  /** Exit of an ACCEPTED server (→ crash watchdog), with its PID for ownership. */
  onAcceptedExit: (code: number | null, signal: NodeJS.Signals | null, pid: number) => void;
}

export type ColdSpawnResult =
  | { ok: true; pid: number }
  | { ok: false; portConflict: boolean; err: unknown };

/**
 * Spawn one cold-launch candidate. Exits before acceptance never reach the
 * watchdog (the spawn rejects instead; the loading page must not flash while
 * falling back). With `verifyRuntimeId` (overlay/localLink) the answering
 * server must be the reported PID serving that runtime id — no false commits.
 * A failed candidate is killed so it cannot hold the port.
 */
export async function spawnColdCandidate(
  source: SpawnableSource,
  verifyRuntimeId: string | null,
  deps: ColdSpawnDeps,
): Promise<ColdSpawnResult> {
  let childPid: number | null = null;
  let acceptedPid: number | null = null;
  const hooks = {
    onSpawned: (pid: number) => {
      childPid = pid;
    },
    onExit: (code: number | null, signal: NodeJS.Signals | null) => {
      if (acceptedPid !== null) deps.onAcceptedExit(code, signal, acceptedPid);
    },
  };
  const fail = async (err: unknown, portConflict: boolean): Promise<ColdSpawnResult> => {
    if (childPid !== null) await deps.kill(childPid);
    return { ok: false, portConflict, err };
  };
  let reportedPid: number;
  try {
    ({ reportedPid } = await deps.spawn(source, hooks));
  } catch (err) {
    return fail(err, deps.isPortConflict(err));
  }
  if (verifyRuntimeId !== null) {
    const health = await deps.probeHealth();
    if (!health || health.pid !== reportedPid || health.runtimeId !== verifyRuntimeId) {
      return fail(new Error(`health_identity_mismatch pid=${health?.pid ?? "none"} runtime=${health?.runtimeId ?? "none"}`), false);
    }
  }
  acceptedPid = reportedPid;
  return { ok: true, pid: reportedPid };
}

/** Undo an attempt counted for a candidate that failed for environmental reasons. */
export function undoAttempt(dir: string, runtimeId: string, previous: number | undefined): void {
  patchRuntimeState(dir, (s) => {
    const attempts = { ...s.attempts };
    if (previous === undefined) delete attempts[runtimeId];
    else attempts[runtimeId] = previous;
    return { attempts };
  });
}
