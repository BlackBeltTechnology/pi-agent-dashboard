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
 *   3. bundled      — spawn the server from `<resourcesPath>/server/`;
 *                     immutable, no extraction, no install.
 *
 * Pre-R3 source kinds (`piExtension`, `npmGlobal`, `extracted`) are gone:
 * they only existed to defend against runtime-install / mutable-managed-dir
 * failure modes that cannot occur when the bundle is read-only.
 *
 * All I/O probes are injectable so unit tests never touch the real filesystem,
 * network, or child-process layer.
 */

import path from "node:path";
import os from "node:os";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { launchDashboardServer } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getBundledNodeDir } from "./bundled-node.js";
import { pickNodeForServer } from "./pick-node.js";
import type { LaunchSource, SourceKind } from "@blackbelt-technology/pi-dashboard-shared/launch-source-types.js";
import type { DashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

export type { LaunchSource, SourceKind };

// ── Constants ────────────────────────────────────────────────────────────────

export const VALID_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "attach",
  "devMonorepo",
  "bundled",
]);

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

export interface LaunchSourceOpts {
  isPackaged: boolean;
  cwd: string;
  preferOverride: SourceKind | null;
  resourcesPath: string;
  port?: number;
  probes?: Partial<LaunchSourceProbes>;
}

// ── Default probe implementations ─────────────────────────────────────────────

import { existsSync as fsExistsSync, mkdirSync as fsMkdirSync, openSync as fsOpenSync, writeSync as fsWriteSync, closeSync as fsCloseSync } from "node:fs";

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

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the best available `LaunchSource` for this Electron session.
 *
 * Returns `{ kind: "attach", ... }` when a running server is detected.
 * Otherwise probes `devMonorepo` (dev-only) then `bundled` (the packaged
 * code path). Throws `BundledServerMissingError` if no source resolves.
 */
export async function selectLaunchSource(opts: LaunchSourceOpts): Promise<LaunchSource> {
  const probes = buildProbes(opts.probes);
  const port = opts.port ?? 8000;

  // 1. Health probe — already running?
  const health = await probes.healthProbe(port);
  if (health.running && health.url) {
    return {
      kind: "attach",
      url: health.url,
      starter: health.starter ?? "Standalone",
    };
  }

  // 2. Override pin?
  if (opts.preferOverride) {
    const pinned = trySource(opts.preferOverride, opts, probes);
    if (!pinned) throw new PinnedSourceUnavailableError(opts.preferOverride);
    return pinned;
  }

  // 3. Walk the priority chain.
  const chain: SourceKind[] = ["devMonorepo", "bundled"];
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
    case "bundled":
      return probeBundled(opts, probes);
  }
}

// ── Spawn primitive ───────────────────────────────────────────────────────────

export interface SpawnResult {
  pid: number;
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
      healthTimeoutMs: 15_000,
      port: config.port,
      detach: false,
      cwd: source.cwd,
      onChildExit: opts?.onChildExit,
    });
    return { pid: result.reportedPid ?? result.childPid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to spawn server from source "${source.kind}": ${message}`);
  }
}

// Re-export so callers don't need a separate import.
export { execFileSync };
