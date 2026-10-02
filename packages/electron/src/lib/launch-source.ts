/**
 * launch-source.ts — LaunchSource resolver for the Electron main process.
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the resolver collapses to:
 *
 *   1. attach       — a compatible server is already running on the port;
 *                     just attach the BrowserWindow.
 *   2. devMonorepo  — running from the checked-out monorepo
 *                     (ELECTRON_DEV=1 gated; not a packaged-app code path).
 *   3. localLink    — a user-linked checkout (effective runtime source
 *                     `local`), run in place.
 *   4. overlay      — a staged runtime release (effective source `npm` or
 *                     `github`); pending before current.
 *   5. bundled      — spawn the server from `<resourcesPath>/server/`;
 *                     immutable, no extraction, no install. Last fallback.
 *
 * `localLink` / `overlay` candidates that fail their gate (compat + preflight)
 * fall through to the next kind and are reported via `onFallThrough`
 * (`lastFailure`). See change: electron-runtime-overlay-updates (D4).
 *
 * Pre-R3 source kinds (`piExtension`, `npmGlobal`, `extracted`) are gone:
 * they only existed to defend against runtime-install / mutable-managed-dir
 * failure modes that cannot occur when the bundle is read-only.
 *
 * All I/O probes are injectable so unit tests never touch the real filesystem,
 * network, or child-process layer.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { launchDashboardServer } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { isValidHeapMb, stampHeapFlag } from "@blackbelt-technology/pi-dashboard-shared/heap-flags.js";
import { DEFAULT_SERVER_HEAP } from "@blackbelt-technology/pi-dashboard-shared/heap-limits.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getBundledNodeDir, getResourcesPath } from "./bundled-node.js";
import { pickNodeForServer } from "./pick-node.js";
import type { LaunchSource, SourceKind } from "@blackbelt-technology/pi-dashboard-shared/launch-source-types.js";
import type { DashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import type { EffectiveSource } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import type { RuntimeGateResult } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/compat.js";
import { getRuntimeOverlayDir } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import { extensionPathFor } from "./runtime-overlay.js";

export type { LaunchSource, SourceKind };

// ── Constants ────────────────────────────────────────────────────────────────

export const VALID_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "attach",
  "devMonorepo",
  "bundled",
  "localLink",
  "overlay",
]);

// ── Server-startup deadlines ─────────────────────────────────────────────────
//
// Mode-aware readiness deadline. The dev-monorepo path uses jiti to compile
// ~400 TS files on cold start — measured cold boot on dev workstations can
// reach 25–60s. The bundled path is pre-compiled and reliably ready well
// under 15s; beyond that the failure is almost always terminal (port conflict,
// missing loader, bad Node) and the loading page is the recovery surface.
//
// Re-exported from `server-lifecycle.ts` for back-compat with existing
// imports/tests. See change: fix-mode-aware-server-ready-deadlines.
export const SERVER_READY_DEADLINE_MS = 15_000;
export const SERVER_READY_DEADLINE_DEV_MS = 60_000;

/**
 * Returns the readiness deadline for the given launch-source kind.
 * Pure helper. `devMonorepo` / `localLink` (TS checkout cold boot) → 60s;
 * everything else (`bundled`, `overlay` — installed-tree shape, `attach`) → 15s.
 */
export function getServerReadyDeadlineMs(sourceKind: string): number {
  return sourceKind === "devMonorepo" || sourceKind === "localLink"
    ? SERVER_READY_DEADLINE_DEV_MS
    : SERVER_READY_DEADLINE_MS;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class PinnedSourceUnavailableError extends Error {
  constructor(public readonly sourceKind: SourceKind) {
    super(
      `Pinned source "${sourceKind}" is not available. ` +
        `Check DASHBOARD_PREFER_SOURCE or remove the override.`,
    );
    this.name = "PinnedSourceUnavailableError";
  }
}

export class BundledServerMissingError extends Error {
  constructor(public readonly cliPath: string) {
    super(
      `Bundled dashboard server not found at "${cliPath}". ` +
        `The installation may be corrupted; reinstall the application.`,
    );
    this.name = "BundledServerMissingError";
  }
}

// ── Env parsing ───────────────────────────────────────────────────────────────

/**
 * Parse `DASHBOARD_PREFER_SOURCE` env var.
 * Returns a `SourceKind` or `null` when unset, empty, or invalid.
 * Logs a warning on invalid value.
 */
export function parsePreferOverride(
  env: Record<string, string | undefined>,
): SourceKind | null {
  const raw = env["DASHBOARD_PREFER_SOURCE"];
  if (!raw) return null;
  if (VALID_SOURCE_KINDS.has(raw as SourceKind)) return raw as SourceKind;
  logLaunchSource(
    "warn",
    `[launch-source] Unknown DASHBOARD_PREFER_SOURCE value "${raw}"; ignoring override.`,
  );
  return null;
}

// ── Probe interfaces ──────────────────────────────────────────────────────────

export interface HealthProbeResult {
  running: boolean;
  starter?: DashboardStarter;
  url?: string;
}

export interface LaunchSourceProbes {
  healthProbe(port: number): Promise<HealthProbeResult>;
  existsSync(p: string): boolean;
}

// ── Options ───────────────────────────────────────────────────────────────────

/** A `localLink` / `overlay` launch candidate, identified by its runtime id. */
interface RuntimeCandidate {
  runtimeId: string;
  /** Checkout root (localLink) or `versions/<X>/` (overlay). */
  root: string;
}

/**
 * Runtime-overlay inputs, computed by the caller from `request.json` +
 * `state.json` (pending/attempts/bad handling lives there, not here).
 * Absent → today's `attach → devMonorepo → bundled` behaviour.
 */
export interface RuntimeLaunchInputs {
  effectiveSource: EffectiveSource;
  local?: RuntimeCandidate;
  /** Overlay candidates in preference order (pending before current). */
  overlays?: RuntimeCandidate[];
  /** Compat gate + preflight (D6). Absent → only the server entry is checked. */
  gate?: (candidate: RuntimeCandidate & { kind: "localLink" | "overlay" }) => RuntimeGateResult;
  /** Called for each considered candidate that fails and falls through (`lastFailure`). */
  onFallThrough?: (failure: { kind: "localLink" | "overlay"; runtimeId: string; reason: string }) => void;
}

export interface LaunchSourceOpts {
  isPackaged: boolean;
  cwd: string;
  preferOverride: SourceKind | null;
  resourcesPath: string;
  port?: number;
  probes?: Partial<LaunchSourceProbes>;
  /** Runtime activation: never attach, even if a server still answers health. */
  skipAttach?: boolean;
  runtime?: RuntimeLaunchInputs;
}

// ── Default probe implementations ─────────────────────────────────────────────

import { existsSync as fsExistsSync, mkdirSync as fsMkdirSync, openSync as fsOpenSync, readFileSync as fsReadFileSync, writeSync as fsWriteSync, closeSync as fsCloseSync } from "node:fs";

function defaultHealthProbe(port: number): Promise<HealthProbeResult> {
  return fetch(`http://localhost:${port}/api/health`, {
    signal: AbortSignal.timeout(3000),
  })
    .then(async (res) => {
      if (!res.ok) return { running: false };
      const data = (await res.json()) as Record<string, unknown>;
      if (!data || data.ok !== true || typeof data.pid !== "number") {
        return { running: false };
      }
      const starter = data.starter as DashboardStarter | undefined;
      const url = `http://localhost:${port}`;
      return { running: true, starter, url };
    })
    .catch(() => ({ running: false }));
}

// ── Diagnostic logging ───────────────────────────────────────────────────

/**
 * Append a single `[<ISO-ts>] [launch-source] ...` line to the dashboard
 * log file (`~/.pi/dashboard/server.log`). Mirrors the header-line pattern
 * used by `launchDashboardServer`.
 *
 * Best-effort: if mkdir/open/write fails, swallow — log-routing must
 * never crash the launch.
 */
function appendDashboardLog(message: string, logFile?: string): void {
  try {
    const file =
      logFile ?? path.join(os.homedir(), ".pi", "dashboard", "server.log");
    fsMkdirSync(path.dirname(file), { recursive: true });
    const fd = fsOpenSync(file, "a");
    try {
      const line = `[${new Date().toISOString()}] [launch-source] ${message}\n`;
      fsWriteSync(fd, line);
    } finally {
      fsCloseSync(fd);
    }
  } catch {
    /* swallow — logging must never crash the launch */
  }
}

function logLaunchSource(level: "warn" | "error", message: string, logFile?: string): void {
  if (level === "error") console.error(message);
  else console.warn(message);
  const body = message.startsWith("[launch-source] ")
    ? message.slice("[launch-source] ".length)
    : message;
  appendDashboardLog(body, logFile);
}

// Re-exported for tests so they can assert log-file content without
// touching the real `~/.pi/dashboard/server.log`.
export const _testing = { appendDashboardLog, logLaunchSource };

function buildProbes(partial?: Partial<LaunchSourceProbes>): LaunchSourceProbes {
  return {
    healthProbe: partial?.healthProbe ?? defaultHealthProbe,
    existsSync: partial?.existsSync ?? fsExistsSync,
  };
}

// ── Per-source probe helpers ──────────────────────────────────────────────────

function probeDevMonorepo(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): LaunchSource | null {
  if (opts.isPackaged) return null;
  const serverCli = path.join(opts.cwd, "packages", "server", "src", "cli.ts");
  const bridgeTs = path.join(opts.cwd, "packages", "extension", "src", "bridge.ts");
  if (probes.existsSync(serverCli) && probes.existsSync(bridgeTs)) {
    return { kind: "devMonorepo", cliPath: serverCli, cwd: opts.cwd };
  }
  return null;
}

/**
 * Resolve the path to the bundled server's cli.ts inside the .app's
 * read-only Resources tree. No fallbacks, no extraction, no mutation —
 * the path is fixed by `bundle-server.mjs` at build time.
 */
export function getBundledCliPath(resourcesPath: string): string {
  return path.join(
    resourcesPath,
    "server",
    "node_modules",
    "@blackbelt-technology",
    "pi-dashboard-server",
    "src",
    "cli.ts",
  );
}

function probeBundled(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): LaunchSource | null {
  if (!opts.resourcesPath) return null;
  const cliPath = getBundledCliPath(opts.resourcesPath);
  if (!probes.existsSync(cliPath)) return null;
  const cwd = path.join(opts.resourcesPath, "server");
  return { kind: "bundled", cliPath, cwd };
}

/** Server entry of a staged overlay root (`versions/<X>/`). */
export function getOverlayCliPath(root: string): string {
  return path.join(root, "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts");
}

/** Server entry of a linked monorepo checkout. */
export function getLocalCliPath(root: string): string {
  return path.join(root, "packages", "server", "src", "cli.ts");
}

function tryRuntimeCandidate(
  kind: "localLink" | "overlay",
  candidate: RuntimeCandidate,
  runtime: RuntimeLaunchInputs,
  probes: LaunchSourceProbes,
): LaunchSource | null {
  const cliPath = kind === "localLink" ? getLocalCliPath(candidate.root) : getOverlayCliPath(candidate.root);
  const gate: RuntimeGateResult = !probes.existsSync(cliPath)
    ? { ok: false, code: "missing_file", path: cliPath, message: `missing_file ${cliPath}` }
    : (runtime.gate?.({ ...candidate, kind }) ?? { ok: true });
  if (!gate.ok) {
    runtime.onFallThrough?.({ kind, runtimeId: candidate.runtimeId, reason: gate.message });
    return null;
  }
  return { kind, cliPath, cwd: candidate.root, runtimeId: candidate.runtimeId };
}

function probeLocalLink(opts: LaunchSourceOpts, probes: LaunchSourceProbes): LaunchSource | null {
  const rt = opts.runtime;
  if (!rt?.local || rt.effectiveSource !== "local") return null;
  return tryRuntimeCandidate("localLink", rt.local, rt, probes);
}

function probeOverlay(opts: LaunchSourceOpts, probes: LaunchSourceProbes): LaunchSource | null {
  const rt = opts.runtime;
  if (!rt?.overlays || (rt.effectiveSource !== "npm" && rt.effectiveSource !== "github")) return null;
  for (const candidate of rt.overlays) {
    const source = tryRuntimeCandidate("overlay", candidate, rt, probes);
    if (source) return source;
  }
  return null;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the best available `LaunchSource` for this Electron session.
 *
 * Returns `{ kind: "attach", ... }` when a running server is detected
 * (never with `skipAttach`). Otherwise probes `devMonorepo` (dev-only),
 * `localLink`, `overlay`, then `bundled` (the packaged code path). Throws
 * `BundledServerMissingError` if no source resolves.
 */
export async function selectLaunchSource(opts: LaunchSourceOpts): Promise<LaunchSource> {
  const probes = buildProbes(opts.probes);
  const port = opts.port ?? 8000;

  // 1. Health probe — already running? Skipped for runtime activation, where
  //    the old server may still answer and must never be attached/committed.
  if (!opts.skipAttach) {
    const health = await probes.healthProbe(port);
    if (health.running && health.url) {
      return {
        kind: "attach",
        url: health.url,
        starter: health.starter ?? "Standalone",
      };
    }
  }

  // 2. Override pin?
  if (opts.preferOverride) {
    const pinned = trySource(opts.preferOverride, opts, probes);
    if (!pinned) throw new PinnedSourceUnavailableError(opts.preferOverride);
    return pinned;
  }

  // 3. Walk the priority chain.
  const chain: SourceKind[] = ["devMonorepo", "localLink", "overlay", "bundled"];
  for (const kind of chain) {
    const source = trySource(kind, opts, probes);
    if (source) return source;
  }

  throw new BundledServerMissingError(getBundledCliPath(opts.resourcesPath));
}

function trySource(
  kind: SourceKind,
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): LaunchSource | null {
  switch (kind) {
    case "attach":
      return null; // handled separately
    case "devMonorepo":
      return probeDevMonorepo(opts, probes);
    case "localLink":
      return probeLocalLink(opts, probes);
    case "overlay":
      return probeOverlay(opts, probes);
    case "bundled":
      return probeBundled(opts, probes);
  }
}

/**
 * Per-app-launch owner token, stamped into every server this app spawns
 * (`PI_DASHBOARD_ELECTRON_INSTANCE`). `/api/restart` re-spawns with the same
 * env, so ownership survives a server restart even though its PID changes.
 * See change: electron-runtime-overlay-updates.
 */
const ELECTRON_INSTANCE_ID = randomUUID();

export function getElectronInstanceId(): string {
  return ELECTRON_INSTANCE_ID;
}

/** Runtime id of a spawnable source: overlay `X`, `local:<realpath>`, `bundled`, `devMonorepo`. */
function runtimeIdOf(source: Exclude<LaunchSource, { kind: "attach" }>): string {
  return source.kind === "overlay" || source.kind === "localLink" ? source.runtimeId : source.kind;
}

/**
 * Runtime identity env for the spawned server: id/origin (echoed by
 * /api/health.runtime), the Electron owner token, and — except devMonorepo,
 * which registers no extension — the extension dir registered for this
 * runtime (D8: the server reloads bridges reporting a different one).
 */
export function runtimeIdentityEnv(
  source: Exclude<LaunchSource, { kind: "attach" }>,
  resourcesPath: string,
  overlayDir: string,
): Record<string, string> {
  const id = runtimeIdOf(source);
  return {
    PI_DASHBOARD_RUNTIME_ID: id,
    PI_DASHBOARD_RUNTIME_ORIGIN: runtimeOriginOf(source),
    PI_DASHBOARD_ELECTRON_INSTANCE: ELECTRON_INSTANCE_ID,
    ...(source.kind === "devMonorepo" ? {} : { PI_DASHBOARD_EXTENSION_DIR: extensionPathFor(id, overlayDir, resourcesPath) }),
  };
}

/** `/api/health.runtime.origin` for a spawnable source. */
function runtimeOriginOf(source: Exclude<LaunchSource, { kind: "attach" }>): "bundled" | "overlay" | "local" | "devMonorepo" {
  return source.kind === "localLink" ? "local" : source.kind;
}

// ── Spawn primitive ───────────────────────────────────────────────────────────

export interface SpawnResult {
  pid: number;
}

/**
 * The configured server heap ceiling, read from `config.json` with the
 * standalone wrapper's `JSON.parse`-inside-`try` shape (one reading rule
 * across launch paths). Any failure - absent, unparseable, invalid or
 * below-floor value - takes the shared default; a bad config never fails
 * the launch. See change: guard-server-heap-and-store-coupling (D3).
 */
export function readServerMaxOldSpaceMb(
  configFile: string = path.join(os.homedir(), ".pi", "dashboard", "config.json"),
): number {
  try {
    const raw = JSON.parse(fsReadFileSync(configFile, "utf-8"))?.serverHeap?.maxOldSpaceMb;
    if (isValidHeapMb(raw)) return raw;
  } catch {
    // absent / unreadable / malformed - take the default
  }
  return DEFAULT_SERVER_HEAP.maxOldSpaceMb;
}

/**
 * Stamp the configured ceiling into the server env via the shared
 * provenance-aware `stampHeapFlag` (NODE_OPTIONS + marker). An operator pin
 * already in `NODE_OPTIONS` wins and nothing is added. See change:
 * guard-server-heap-and-store-coupling (D3).
 */
export function stampServerHeap(
  env: Record<string, string>,
  configFile?: string,
): Record<string, string> {
  return stampHeapFlag(env, readServerMaxOldSpaceMb(configFile));
}

/**
 * Spawn the dashboard server from the given `source`.
 * Delegates to the shared `launchDashboardServer` primitive.
 */
export async function spawnFromSource(
  source: Exclude<LaunchSource, { kind: "attach" }>,
  config: { port: number; piPort: number },
  opts?: {
    logFile?: string;
    /** Forwarded to `launchDashboardServer.onChildExit`. */
    onChildExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
    /** Forwarded to `launchDashboardServer.onSpawned` (pre-readiness child PID). */
    onSpawned?: (pid: number) => void;
  },
): Promise<SpawnResult> {
  const logFile = opts?.logFile ?? path.join(os.homedir(), ".pi", "dashboard", "server.log");

  // Use getBundledNodeDir() — never path.dirname(path.dirname(getBundledNodePath())).
  // The dirname-chain pattern is POSIX-only (<res>/node/bin/node → <res>/node)
  // and silently resolves to <res> on Windows where the layout is one segment
  // shallower (<res>/node/node.exe), making pickNodeForServer fall back to
  // execpath-fallback with ELECTRON_RUN_AS_NODE=1. See change:
  // fix-electron-launch-source-bundled-node-dir.
  const bundledNodeDir = getBundledNodeDir();
  const pick = pickNodeForServer({
    bundledNodeDir,
    processExecPath: process.execPath,
    platform: process.platform,
  });

  const baseEnv = new ToolResolver({ processExecPath: pick.nodeBin }).buildSpawnEnv(process.env);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === "string") env[k] = v;
  }
  env["DASHBOARD_STARTER"] = "Electron";
  // Stamp the Electron identity onto the server CHILD: it runs under the
  // bundled plain Node, where `process.versions.electron` and
  // `process.resourcesPath` do not exist, so the spawn-runtime ladder would
  // misdetect the arm as "npm" (inverting step-2 order to PATH-first) and
  // lose the bundled rung entirely (persisting bundle paths on miss).
  // detectSpawnArm()/electronResourcesPath() read these. See change:
  // unify-pi-runtime-identity (review round 1:
  // electron-arm-identity-lost-at-process-boundary).
  env["PI_DASHBOARD_ELECTRON"] = "1";
  env["PI_DASHBOARD_RESOURCES_PATH"] = getResourcesPath();
  // Runtime identity echoed by /api/health.runtime so a runtime switch only
  // commits the server it spawned. See change: electron-runtime-overlay-updates.
  Object.assign(env, runtimeIdentityEnv(source, getResourcesPath(), getRuntimeOverlayDir()));
  // Third launch path: without this the Electron-spawned server ran at the
  // runtime default. Also covers the Electron-owned `/api/restart` respawn,
  // which comes back through here. See change:
  // guard-server-heap-and-store-coupling (D3).
  stampServerHeap(env);

  if (pick.kind === "execpath-fallback") {
    env["ELECTRON_RUN_AS_NODE"] = "1";
    logLaunchSource(
      "warn",
      "[pick-node] Bundled Node not found — falling back to process.execPath with " +
      "ELECTRON_RUN_AS_NODE=1. Installation may be corrupted. " +
      `execPath=${pick.nodeBin}`,
    );
  }

  try {
    const result = await launchDashboardServer({
      cliPath: source.cliPath,
      anchor: source.cliPath,
      nodeBin: pick.nodeBin,
      extraArgs: [
        "--port", String(config.port),
        "--pi-port", String(config.piPort),
      ],
      env,
      starter: "Electron",
      stdio: { logFile },
      healthTimeoutMs: getServerReadyDeadlineMs(source.kind),
      port: config.port,
      detach: false,
      cwd: source.cwd,
      onChildExit: opts?.onChildExit,
      onSpawned: opts?.onSpawned,
    });
    return { pid: result.reportedPid ?? result.childPid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Keep the original as `cause` so callers can classify it (PortConflictError
    // → environmental, not a bad runtime). See change: electron-runtime-overlay-updates.
    throw new Error(`Failed to start server from source "${source.kind}": ${message}`, { cause: err });
  }
}

// Re-export so callers don't need a separate import.
export { execFileSync };
