/**
 * runtime-overlay-main.ts — real-I/O wiring of the runtime overlay for
 * Electron main: the compatibility gate over real files, cold-launch resolver
 * inputs, `switchRuntime` dependencies, the activation watcher and the
 * app-menu local-folder actions. Pure logic lives in `runtime-overlay.ts`.
 *
 * See change: electron-runtime-overlay-updates (D3, D6, D7, D8).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { isProcessAlive, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  evaluateRuntimeCandidate,
  preflightLocal,
  preflightOverlay,
  type RuntimeGateResult,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/compat.js";
import { readRuntimeManifest } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/manifest.mjs";
import {
  BUNDLED_RUNTIME_ID,
  getRuntimeOverlayDir,
  patchRuntimeState,
  readRuntimeState,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { PortConflictError } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { getBundledNodePath } from "./bundled-node.js";
import {
  execFileSync,
  getBundledCliPath,
  getElectronInstanceId,
  getLocalCliPath,
  getOverlayCliPath,
  type LaunchSource,
  type LaunchSourceOpts,
  type RuntimeLaunchInputs,
  selectLaunchSource,
  spawnFromSource,
} from "./launch-source.js";
import {
  activationTarget as activationTargetFor,
  beginAttempt,
  type ColdSpawnDeps,
  clearBad,
  commitRuntime,
  createSwitchQueue,
  extensionPathFor,
  planColdLaunch,
  pruneVersions,
  recordColdFailure,
  runtimeLocation,
  type SwitchResult,
  shouldCountAttempt,
  spawnColdCandidate,
  switchRuntime,
  undoAttempt,
  watchActivationRequests,
} from "./runtime-overlay.js";
import { localTokenHeaders } from "./local-proof-bootstrap.js";
import { getStoredSpawnedPid, makeServerWatchdog, setSpawnedPid } from "./server-lifecycle.js";

type SpawnableSource = Exclude<LaunchSource, { kind: "attach" }>;

let cachedNodeVersion: string | null = null;

/** Version of the Node the shell runs the server with (bundled, else Electron's). */
function shellNodeVersion(): string {
  if (cachedNodeVersion) return cachedNodeVersion;
  const bundled = getBundledNodePath();
  try {
    if (bundled) cachedNodeVersion = execFileSync(bundled, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
  } catch {
    /* fall through */
  }
  cachedNodeVersion ??= process.versions.node;
  return cachedNodeVersion;
}

function readEnginesNode(checkoutRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path.join(checkoutRoot, "package.json"), "utf8"));
    return typeof pkg?.engines?.node === "string" ? pkg.engines.node : undefined;
  } catch {
    return undefined;
  }
}

/** D6 gate over the real filesystem for a localLink / overlay candidate. */
function gateRuntimeRoot(
  kind: "localLink" | "overlay",
  root: string,
  shellVersion: string,
  nodeVersion: string = shellNodeVersion(),
): RuntimeGateResult {
  if (kind === "overlay") {
    const compat = evaluateRuntimeCandidate({ manifest: readRuntimeManifest(root), shellVersion, nodeVersion });
    return compat.ok ? preflightOverlay(root, existsSync) : compat;
  }
  const files = preflightLocal(root, existsSync);
  if (!files.ok) return files;
  // Spike 1.2 deferred → conservative: the checkout runs under the shell's
  // Node and is refused when that Node is outside its engines range.
  const engines = readEnginesNode(root);
  if (!engines) return { ok: true };
  return evaluateRuntimeCandidate({
    manifest: { version: "local", minShellVersion: "0.0.0", nodeEngines: engines, origin: "bundled" },
    shellVersion,
    nodeVersion,
  });
}

/** Resolver inputs for a cold launch; gate failures are recorded as `lastFailure`. */
function coldLaunchRuntimeInputs(opts: {
  shellVersion: string;
  log: (msg: string) => void;
  exclude?: ReadonlySet<string>;
}): RuntimeLaunchInputs {
  const dir = getRuntimeOverlayDir();
  const plan = planColdLaunch(dir, opts.exclude);
  return {
    ...plan.inputs,
    gate: (c) => gateRuntimeRoot(c.kind, c.root, opts.shellVersion),
    onFallThrough: (f) => {
      opts.log(`[runtime-overlay] ${f.kind} ${f.runtimeId} refused: ${f.reason}`);
      patchRuntimeState(dir, { lastFailure: { id: f.runtimeId, reason: f.reason, at: new Date().toISOString() } });
    },
  };
}

/** Spawnable source for a runtime id (after the gate). */
function sourceFor(runtimeId: string, dir: string, resourcesPath: string, shellVersion: string):
  | { ok: true; source: SpawnableSource }
  | { ok: false; reason: string } {
  const loc = runtimeLocation(runtimeId, dir);
  if (loc.kind === "bundled") {
    const cliPath = getBundledCliPath(resourcesPath);
    if (!existsSync(cliPath)) return { ok: false, reason: `missing_file ${cliPath}` };
    return { ok: true, source: { kind: "bundled", cliPath, cwd: path.join(resourcesPath, "server") } };
  }
  const root = loc.root as string;
  const cliPath = loc.kind === "overlay" ? getOverlayCliPath(root) : getLocalCliPath(root);
  if (!existsSync(cliPath)) return { ok: false, reason: `missing_file ${cliPath}` };
  const gate = gateRuntimeRoot(loc.kind, root, shellVersion);
  if (!gate.ok) return { ok: false, reason: gate.message };
  return { ok: true, source: { kind: loc.kind, cliPath, cwd: root, runtimeId } };
}

/** A PortConflictError, directly or as the `cause` spawnFromSource preserves. */
function isPortConflict(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof PortConflictError) return true;
  }
  return false;
}

/** GET /api/health → pid + runtime id of whatever answers. */
async function probeRuntimeHealth(port: number): Promise<{ pid: number; runtimeId?: string; owner?: string } | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { pid?: unknown; runtime?: { id?: unknown; owner?: unknown } };
    if (typeof body.pid !== "number") return null;
    return {
      pid: body.pid,
      runtimeId: typeof body.runtime?.id === "string" ? body.runtime.id : undefined,
      owner: typeof body.runtime?.owner === "string" ? body.runtime.owner : undefined,
    };
  } catch {
    return null;
  }
}

/** Terminate and wait (SIGTERM → SIGKILL ladder); never throws. */
async function killAndWait(pid: number, log: (m: string) => void): Promise<void> {
  try {
    await killProcess(pid);
  } catch (err) {
    log(`[runtime-overlay] kill ${pid} failed: ${String(err)}`);
  }
}

/**
 * Durable extension re-point (D8). Throws when the target is missing or
 * settings.json cannot be written, so no runtime is spawned with a stale
 * extension. The bundle's AppImage mount path is unstable → skipped (as before).
 */
function registerExtensionStrict(ext: string, log: (m: string) => void): void {
  if (ext.includes("/tmp/.mount_")) {
    log("[runtime-overlay] AppImage mount path — bundled extension not registered (unstable path)");
    return;
  }
  if (!existsSync(path.join(ext, "package.json"))) throw new Error(`extension missing at ${ext}`);
  registerBridgeExtension(ext, { strict: true });
}

export interface RuntimeSwitchContext {
  port: number;
  piPort: number;
  logFile: string;
  resourcesPath: string;
  shellVersion: string;
  log: (msg: string) => void;
  /** Crash of a committed runtime → loading/recovery page (existing watchdog). */
  onCrash: () => void;
  /** Committed server exited for `/api/restart` (ELECTRON_RESTART_EXIT_CODE) → respawn. */
  onRestartRequested?: () => void;
}

function switchOnce(targetId: string, ctx: RuntimeSwitchContext): Promise<SwitchResult> {
  const dir = getRuntimeOverlayDir();
  let committedPid: number | null = null;
  const watchdog = makeServerWatchdog({
    isGraceful: () => false,
    log: ctx.log,
    onCrash: ctx.onCrash,
    onRestartRequested: ctx.onRestartRequested,
    getPid: () => committedPid,
  });
  return switchRuntime(targetId, {
    dir,
    log: ctx.log,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    probeHealth: () => probeRuntimeHealth(ctx.port),
    storedPid: getStoredSpawnedPid,
    // Only a server this app spawned (owner token, survives /api/restart) or
    // adopted (stored PID) may be stopped.
    ownsServer: (h) => h.owner === getElectronInstanceId() || h.pid === getStoredSpawnedPid(),
    // Restart intent (no `userQuit`): sessions stay up and re-attach.
    stopServer: async () => {
      try {
        await fetch(`http://localhost:${ctx.port}/api/shutdown`, { method: "POST", headers: localTokenHeaders(), signal: AbortSignal.timeout(5_000) });
      } catch {
        /* already stopping */
      }
    },
    isPidAlive: (pid) => isProcessAlive(pid),
    isPortFree: async () => {
      const st = await isDashboardRunning(ctx.port, "localhost", { retries: 0, timeoutMs: 1_000 });
      return !st.running && !st.portConflict;
    },
    gateCandidate: (id) => sourceFor(id, dir, ctx.resourcesPath, ctx.shellVersion),
    extensionPathFor: (id) => extensionPathFor(id, dir, ctx.resourcesPath),
    registerExtension: (ext) => registerExtensionStrict(ext, ctx.log),
    spawn: async (source, hooks) => {
      const res = await spawnFromSource(
        source,
        { port: ctx.port, piPort: ctx.piPort },
        { logFile: ctx.logFile, onSpawned: hooks.onSpawned, onChildExit: hooks.onExit },
      );
      committedPid = res.pid;
      setSpawnedPid(res.pid);
      return { reportedPid: res.pid };
    },
    kill: (pid) => killAndWait(pid, ctx.log),
    isPortConflict,
    pruneVersions: (keep) => pruneVersions(dir, keep),
    onCommittedExit: (code, signal) => watchdog(code, signal),
  });
}

// One queue per app: every switch runs to completion before the next starts,
// each with its own target (watcher + app menu cannot interleave).
let queuedContext: RuntimeSwitchContext | null = null;
const enqueueSwitch = createSwitchQueue((targetId) => switchOnce(targetId, queuedContext as RuntimeSwitchContext));

/** Run a runtime switch with real I/O, serialized behind any in-flight switch. */
export function runRuntimeSwitch(targetId: string, ctx: RuntimeSwitchContext): Promise<SwitchResult> {
  queuedContext = ctx;
  return enqueueSwitch(targetId);
}

let activeContext: { ctx: RuntimeSwitchContext; onResult: (r: SwitchResult) => void } | null = null;
let stopWatcher: (() => void) | null = null;

/** Live switch context for the app menu (null until main started the watcher). */
export function getActiveRuntimeContext(): { ctx: RuntimeSwitchContext; onResult: (r: SwitchResult) => void } | null {
  return activeContext;
}

/** Start (or restart) the 2 s activation watcher; records `handledNonce` after each switch. */
export function startActivationWatcher(ctx: RuntimeSwitchContext, onResult: (r: SwitchResult) => void): void {
  const dir = getRuntimeOverlayDir();
  activeContext = { ctx, onResult };
  stopWatcher?.();
  stopWatcher = watchActivationRequests({
    dir,
    onActivate: (request) => {
      const nonce = request.activateNonce;
      // Explicit user action (Activate): clear the pending id's bad entry AND
      // attempts so it gets its full retry-once allowance (D2).
      if (typeof request.pending === "string") clearBad(dir, request.pending);
      const target = activationTargetFor(dir);
      ctx.log(`[runtime-overlay] activation nonce=${nonce} → ${target}`);
      runRuntimeSwitch(target, ctx)
        .then((r) => {
          patchRuntimeState(dir, { handledNonce: nonce });
          onResult(r);
        })
        .catch((err: unknown) => ctx.log(`[runtime-overlay] activation ${nonce} failed: ${String(err)}`));
    },
  });
}

// ── Cold launch ─────────────────────────────────────────────────────────────

type ColdLaunchResult =
  | { kind: "attach"; source: Extract<LaunchSource, { kind: "attach" }> }
  | { kind: "spawned"; source: SpawnableSource; pid: number };

export interface ColdLaunchOpts {
  resolver: Omit<LaunchSourceOpts, "runtime">;
  port: number;
  piPort: number;
  logFile: string;
  shellVersion: string;
  log: (msg: string) => void;
  registerBundledExtension: () => void;
  /** Exit of the accepted server, with its PID (PID-scoped watchdog ownership). */
  onChildExit: (code: number | null, signal: NodeJS.Signals | null, pid: number) => void;
}

function runtimeIdOfSource(source: SpawnableSource): string | null {
  if (source.kind === "overlay" || source.kind === "localLink") return source.runtimeId;
  return source.kind === "bundled" ? BUNDLED_RUNTIME_ID : null; // devMonorepo: not tracked
}

/**
 * Overlay/local: strict re-point — returns the error so the candidate is
 * refused. Bundle/dev: best-effort, as before (never an error).
 */
function tryRegisterExtensionFor(source: SpawnableSource, opts: ColdLaunchOpts): unknown {
  try {
    if (source.kind === "overlay" || source.kind === "localLink") {
      registerExtensionStrict(extensionPathFor(source.runtimeId, getRuntimeOverlayDir(), opts.resolver.resourcesPath), opts.log);
    } else {
      opts.registerBundledExtension();
    }
    return null;
  } catch (err) {
    return source.kind === "overlay" || source.kind === "localLink" ? err : null;
  }
}

/**
 * Cold launch: resolve (attach → devMonorepo → localLink → overlay → bundled),
 * re-point the extension, count the attempt, spawn, verify identity, commit.
 * A failing overlay/local candidate is recorded (retry-once rule) and
 * excluded, then the next source is tried — the bundle is the last fallback.
 * Port conflicts are environmental: attempt undone, error rethrown.
 */
export async function resolveAndSpawnRuntime(opts: ColdLaunchOpts): Promise<ColdLaunchResult> {
  const exclude = new Set<string>();
  for (;;) {
    const source = await selectLaunchSource({
      ...opts.resolver,
      skipAttach: opts.resolver.skipAttach || exclude.size > 0,
      runtime: coldLaunchRuntimeInputs({ shellVersion: opts.shellVersion, log: opts.log, exclude }),
    });
    if (source.kind === "attach") return { kind: "attach", source };
    const round = await launchCandidate(source, opts);
    if ("excluded" in round) exclude.add(round.excluded);
    else return round;
  }
}

/** One cold-launch round for a resolved source: spawned, or the id to exclude (throws for bundle/dev/port conflict). */
async function launchCandidate(source: SpawnableSource, opts: ColdLaunchOpts): Promise<ColdLaunchResult | { excluded: string }> {
  const dir = getRuntimeOverlayDir();
  const runtimeId = runtimeIdOfSource(source);
  const tracked = source.kind === "overlay" || source.kind === "localLink" ? source.runtimeId : null;
  const registerError = tryRegisterExtensionFor(source, opts);
  if (registerError) return { excluded: recordFallback(dir, runtimeId, registerError, opts.log) };

  const state = readRuntimeState(dir);
  const counted = runtimeId !== null && shouldCountAttempt(state, runtimeId);
  if (counted && runtimeId) beginAttempt(dir, runtimeId);

  const res = await spawnColdCandidate(source, tracked, coldSpawnDeps(opts));
  if (res.ok) {
    commitColdLaunch(dir, runtimeId, state.current, opts.log, `${source.kind} pid=${res.pid}`);
    return { kind: "spawned", source, pid: res.pid };
  }
  if (res.portConflict) {
    // Environmental: not an attempt of this runtime; surface as before.
    if (counted && runtimeId) undoAttempt(dir, runtimeId, state.attempts?.[runtimeId]);
    throw res.err;
  }
  return { excluded: recordFallback(dir, runtimeId, res.err, opts.log) };
}

function coldSpawnDeps(opts: ColdLaunchOpts): ColdSpawnDeps {
  return {
    spawn: async (src, hooks) => {
      const r = await spawnFromSource(
        src,
        { port: opts.port, piPort: opts.piPort },
        { logFile: opts.logFile, onSpawned: hooks.onSpawned, onChildExit: hooks.onExit },
      );
      return { reportedPid: r.pid };
    },
    probeHealth: () => probeRuntimeHealth(opts.port),
    kill: (pid) => killAndWait(pid, opts.log),
    isPortConflict,
    onAcceptedExit: opts.onChildExit,
  };
}

function commitColdLaunch(dir: string, runtimeId: string | null, current: string | undefined, log: (m: string) => void, what: string): void {
  if (runtimeId && runtimeId !== current) commitRuntime(dir, runtimeId, current ?? BUNDLED_RUNTIME_ID);
  log(`[runtime-overlay] cold launch ${runtimeId ?? "devMonorepo"} (${what})`);
}

/** A failed cold-launch candidate: rethrow for the bundle/dev, else record + return the id to exclude. */
function recordFallback(dir: string, runtimeId: string | null, err: unknown, log: (m: string) => void): string {
  if (!runtimeId || runtimeId === BUNDLED_RUNTIME_ID) throw err;
  const reason = err instanceof Error ? err.message : String(err);
  recordColdFailure(dir, runtimeId, reason);
  log(`[runtime-overlay] cold launch of ${runtimeId} failed (${reason}); falling back`);
  return runtimeId;
}
