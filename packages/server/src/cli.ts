#!/usr/bin/env node
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
/**
 * PI Dashboard Server CLI
 *
 * Usage:
 *   pi-dashboard                    Start server in foreground (default)
 *   pi-dashboard start [flags]      Start server as background daemon
 *   pi-dashboard stop [--port n] [--pi-port n] [--force]
 *                                   Stop running daemon. The port sweep kills only listeners
 *                                   this HOME owns. --force kills EVERY listener on those
 *                                   ports - DANGEROUS: it can kill another HOME's or user's
 *                                   dashboard, the Electron app's server, or an unrelated
 *                                   service. Use only to recover an orphaned listener nothing
 *                                   else can attribute. `restart` ignores --force.
 *   pi-dashboard restart [flags]    Restart daemon
 *   pi-dashboard status             Show daemon status
 *   pi-dashboard runtime            Print the resolved spawn runtime (diagnostic)
 *   pi-dashboard open [--print] [--url <origin>]
 *                                   Open the dashboard in a browser with local proof (requireLocalProof).
 *                                   --url: a loopback origin on the configured port (e.g. http://127.0.0.1:8000)
 *   pi-dashboard pair list [--json]
 *   pi-dashboard pair approve [<pendingId>] [--code <8 digits>] [--name <label>] [--tier observe|control|operate]
 *   pi-dashboard pair deny <pendingId>
 *                                   Approve/deny a pending device pairing from this host. The code is read from a
 *                                   prompt or stdin; --code is visible in `ps`.
 *
 * Flags:
 *   --port <n>       HTTP port (default: 8000)
 *   --pi-port <n>    Pi gateway port (default: 9999)
 *   --dev            Development mode (skip static files)
 *   --no-tunnel      Disable zrok tunnel
 */
// `createServer` is imported dynamically inside `runForeground()` so a
// top-level module-resolution failure (missing `fastify` etc.) can be
// caught and degraded into the recovery HTTP server instead of crashing
// the process. The type-only import here is fully erased at runtime.
import { ensureConfig, loadConfig, SERVER_STARTUP_DEADLINE_MS } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isLauncherOrigin } from "@blackbelt-technology/pi-dashboard-shared/launcher-origin.js";
import { httpProofHeaders, localDialHost } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import {
  findPortHolders as platformFindPortHolders,
  isProcessAlive as platformIsProcessAlive,
  killProcess as platformKillProcess,
  parseNetstatListeners as platformParseNetstatListeners,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  EarlyExitError,
  launchDashboardServer,
  PortConflictError,
} from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { terminalSafe } from "@blackbelt-technology/pi-dashboard-shared/terminal-safe.js";
import { defaultLocalTokenDir, ensureLocalToken, readLocalTokenIfPresent } from "./auth/local-token.js";
import { migrateSubagentTickThrottle } from "./config-api.js";
import { classifyDashboardPort, type PortClassification } from "./lifecycle/classify-dashboard-port.js";
import {
  isModuleNotFoundError,
  parseModuleNotFoundError,
  startRecoveryServer,
} from "./lifecycle/recovery-server.js";
import { collectOwnedPids, partitionHolders } from "./lifecycle/stop-ownership.js";
import type { createServer as _CreateServerType, ServerConfig } from "./server.js";
import { readPid, removePid } from "./spawn-process/server-pid.js";

// Re-exports for back-compat — other modules / tests may import these from cli.
export const parseNetstatListeners = platformParseNetstatListeners;
export function findPortHolders(
  port: number,
  execImpl?: (cmd: string, opts: { encoding: "utf-8" }) => string,
): number[] {
  return platformFindPortHolders(port, execImpl ? { exec: execImpl } : undefined);
}

import {
  findBundledExtension,
  registerBridgeExtension,
} from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { parseDashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  piEntryFromArgv,
  type ResolvedRuntime,
  resolveSpawnRuntime,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { getDefaultRegistry, ingestInstalledSkillTools, resolveInstallRoot } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { assertNodeVersionSupported, warnTsLoaderState } from "./auth/node-guard.js";
import { recordExitIntent } from "./persistence/boot-state.js";
import { publishResolvedRuntime, readPublishedRuntimeBlock } from "./runtime-publication.js";
import { resolveLiveSpawnRuntime } from "./runtime-resolution.js";
import { cmdService, localExecSecretsResolver } from "./services/cli-service.js";
import { defaultCommandRunner } from "./services/command-runner.js";
import { servicesPaths } from "./services/paths.js";

const SUBCOMMANDS = ["start", "stop", "restart", "status", "runtime", "open"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export interface ParsedArgs {
  subcommand: Subcommand | null;
  /** `force` is read only by `stop`; it never enters `ServerConfig`. */
  flags: Partial<ServerConfig> & { force?: boolean };
}

/**
 * Parse CLI arguments into a subcommand + flags.
 * Exported for testing.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const flags: Partial<ServerConfig> & { force?: boolean } = {};
  let subcommand: Subcommand | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    // Check for subcommand (first positional arg)
    if (!subcommand && SUBCOMMANDS.includes(arg as Subcommand)) {
      subcommand = arg as Subcommand;
      continue;
    }

    if (arg === "--port" && next) {
      flags.port = parseInt(next, 10);
      i++;
    } else if (arg === "--host" && next && !next.startsWith("--")) {
      flags.host = next;
      i++;
    } else if (arg === "--pi-port" && next) {
      flags.piPort = parseInt(next, 10);
      i++;
    } else if (arg === "--dev") {
      flags.dev = true;
    } else if (arg === "--ephemeral") {
      // Flag-only opt-in (fix-autostart-discovery-precedence, task 5.1): the
      // server exits gracefully once its boot parent is proven absent. There
      // is deliberately NO env var — an inherited PI_DASHBOARD_EPHEMERAL=1 in
      // a shell would make a user's real standalone dashboard exit when that
      // shell dies. See design D5 (F8).
      flags.ephemeral = true;
    } else if (arg === "--no-tunnel") {
      flags.tunnel = false;
    } else if (arg === "--force") {
      flags.force = true;
    }
  }

  return { subcommand, flags };
}

/** Production default HTTP port. A temp/faux HOME must never bind it. */
export const PRODUCTION_DEFAULT_PORT = 8000;

/**
 * A dashboard started with a temp/faux HOME (a test or isolated run — HOME
 * under `os.tmpdir()`) must NEVER bind the production default port 8000. On
 * macOS a `127.0.0.1:8000` bind is MORE SPECIFIC than the real server's
 * `*:8000`, so it silently SHADOWS the live dashboard for every localhost
 * request — the real dashboard appears to "lose" all its sessions while it is
 * in fact still running. Remap to an ephemeral port (0) and warn. Fires even on
 * an explicit `--port 8000`, because a temp-HOME instance has no business on
 * the production port (the live incident was launched with an explicit
 * `--port 8000` from a worktree + faux HOME). Non-8000 ports (test servers use
 * random ones) pass through untouched. See change: guard-temp-home-production-port.
 */
// Generic over the input so a non-null `port` stays non-null for the caller:
// every return path yields either the input itself or the ephemeral `0`, so
// `T | 0` is exact. A flat `number | null` return widened `buildConfig`'s
// already-resolved port and broke `ServerConfig.port: number`.
// See change: cleanup-client-plugin-promises (unblocking a develop type error).
export function guardTempHomePort<T extends number | null>(
  port: T,
  homeDir: string,
  tmpDir: string,
  warn: (msg: string) => void = console.warn,
): T | 0 {
  if (port !== PRODUCTION_DEFAULT_PORT) return port;
  const home = path.resolve(homeDir);
  const tmp = path.resolve(tmpDir);
  if (home !== tmp && !home.startsWith(tmp + path.sep)) return port;
  warn(
    `[isolation] HOME (${home}) is under the temp dir (${tmp}); refusing to bind ` +
      `production port ${PRODUCTION_DEFAULT_PORT} (a 127.0.0.1 bind would shadow a real ` +
      `dashboard on localhost). Using an ephemeral port instead.`,
  );
  return 0;
}

/**
 * Build the full server config from CLI flags, env vars, and config file.
 */
export function buildConfig(
  flags: Partial<ServerConfig>,
  warn: (msg: string) => void = console.warn,
): ServerConfig {
  const fileConfig = loadConfig();
  const resolvedPort =
    flags.port ?? (parseInt(process.env.PI_DASHBOARD_PORT ?? "") || null) ?? fileConfig.port;
  return {
    port: guardTempHomePort(resolvedPort, os.homedir(), os.tmpdir(), warn),
    piPort: flags.piPort ?? (parseInt(process.env.PI_DASHBOARD_PI_PORT ?? "") || null) ?? fileConfig.piPort,
    host: flags.host ?? (process.env.PI_DASHBOARD_HOST || null) ?? fileConfig.bindHost,
    // The `--host` FLAG, kept alongside the resolved value. `pendingBindHost`
    // must re-resolve the same chain against the CURRENT config, and a flag
    // wins on the next start too — so the flag has to survive resolution.
    // See change: warn-unreachable-trusted-networks.
    hostFlag: flags.host ?? null,
    dev: flags.dev ?? false,
    // Ephemeral: FLAG ONLY (see parseArgs note) — never sourced from env or
    // config file, never inferred from a temp HOME / loopback bind / port.
    // See change: fix-autostart-discovery-precedence (D5, task 5.1).
    ephemeral: flags.ephemeral === true,
    autoShutdown: fileConfig.autoShutdown,
    shutdownIdleSeconds: fileConfig.shutdownIdleSeconds,
    tunnel: flags.tunnel ?? fileConfig.tunnel.enabled,
    // v2 (support-zrok-v2): source the reserved NAME + persistence from the
    // zrok sub-config. The legacy v1 `reservedToken` is NOT passed to the v2
    // provider (a v1 token is meaningless to a v2 account).
    tunnelReservedName: fileConfig.tunnel.zrok?.reservedName,
    tunnelPersistent: fileConfig.tunnel.zrok?.persistent,
    tunnelWatchdog: fileConfig.tunnel.watchdog,
    tunnelConfig: fileConfig.tunnel,
    authConfig: fileConfig.auth,
    maxEventsPerSession: fileConfig.memoryLimits.maxEventsPerSession,
    maxStringFieldSize: fileConfig.memoryLimits.maxStringFieldSize,
    maxWsBufferBytes: fileConfig.memoryLimits.maxWsBufferBytes,
    maxReplayEvents: fileConfig.memoryLimits.maxReplayEvents,
    replayWindowMode: fileConfig.memoryLimits.replayWindowMode,
    // Carry the WHOLE block too: the byte budgets and resident count are read
    // from `config.memoryLimits` by `createServer`, and rebuilding the block
    // field-by-field here silently dropped them (byte budgets fell back to the
    // store's unbounded default). See change: bound-event-store-by-bytes (task 5.1).
    memoryLimits: fileConfig.memoryLimits,
    openspec: fileConfig.openspec,
    push: fileConfig.push,
    sessions: fileConfig.sessions,
    reattachPlacement: fileConfig.reattachPlacement,
    completedFirst: fileConfig.completedFirst,
    questionFirst: fileConfig.questionFirst,
    resolvedTrustedNetworks: fileConfig.resolvedTrustedNetworks,
    corsAllowedOrigins: fileConfig.cors.allowedOrigins,
  };
}

/**
 * Run the server in the foreground.
 *
 * Pi/openspec/tsx ship as regular npm deps of this package, so the
 * ToolRegistry resolve of "pi" at startup either succeeds (regular
 * path) or signals a corrupted install (hard error). See change:
 * eliminate-electron-runtime-install.
 */
async function runForeground(config: ServerConfig): Promise<void> {
  assertNodeVersionSupported();
  warnTsLoaderState();

  // Dynamic-import boundary for the main server module. If a top-level
  // dependency (fastify, toad-cache, readable-stream, …) is missing, the
  // import throws ERR_MODULE_NOT_FOUND here — caught and degraded to the
  // recovery HTTP server bound to the same port.
  let createServer: typeof _CreateServerType;
  try {
    ({ createServer } = await import("./server.js"));
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      await startRecoveryServer({
        port: config.port,
        error: err as Error,
        missingModule: parseModuleNotFoundError(err),
      });
      // startRecoveryServer never returns — its HTTP server keeps the
      // event loop alive until the user clicks Retry (which respawns and
      // process.exits) or the process is killed externally.
      return new Promise<void>(() => { /* unreachable */ });
    }
    throw err;
  }

  const server = await createServer(config);

  // Tool-registry resolve confirms pi is reachable from the bundled
  // node_modules/ — under change: eliminate-electron-runtime-install,
  // pi/openspec/tsx ship as regular deps so the registry must resolve
  // at startup. A miss here means the install tree is corrupted.
  {
    const registry = getDefaultRegistry();
    // Ingest skill-package pi.tools manifests (installed tree + monorepo
    // dev) so skill tools surface through /api/tools + Settings → Tools.
    // Best-effort: an invalid manifest is skipped, never fatal. The scan
    // root is the tree THIS server runs from (layout-aware: monorepo vs
    // npm i -g) — a dashboard launched from a user shell has an unrelated
    // process.cwd(). See change: add-skill-tool-provisioning (task 6.2).
    ingestInstalledSkillTools(registry, {
      root: resolveInstallRoot(fileURLToPath(import.meta.url)),
    });
    const res = registry.resolve("pi");
    if (res.ok) {
      console.log(`[bootstrap] ready (pi resolved via ${res.source})`);
    } else {
      const tried = res.tried?.map((t: any) => t.strategy).join(", ") ?? "(no strategies)";
      throw new Error(
        `[bootstrap] pi is not resolvable from the dashboard install. ` +
        `This indicates a corrupted node_modules/ tree. Tried: ${tried}. ` +
        `Reinstall the dashboard (npm i -g @blackbelt-technology/pi-agent-dashboard) ` +
        `or reinstall the Electron app.`,
      );
    }
  }

  // One-time advisory: legacy `~/.pi-dashboard/` directory left behind
  // from pre-R3 versions. The same orphan test as the Doctor row applies:
  // "safe to delete" ONLY when genuinely orphaned (no managed runtime,
  // wizard state, non-empty node_modules, or logs); live content is named
  // and never suggested for deletion.
  // See change: unify-pi-runtime-identity (task 6.2).
  try {
    const { detectLegacyManagedDir } = await import(
      "@blackbelt-technology/pi-dashboard-shared/legacy-managed-dir.js"
    );
    const legacy = detectLegacyManagedDir();
    if (legacy.present && legacy.orphaned) {
      console.log(
        `[legacy] legacy install directory detected at ${legacy.path} ` +
        `(~${legacy.sizeMb} MB). No longer used — safe to delete.`,
      );
    } else if (legacy.present) {
      console.log(
        `[legacy] legacy directory ${legacy.path} is still in use ` +
        `(${legacy.consumers.join(", ")}) — not deleted.`,
      );
    }
  } catch {
    /* advisory only — never block startup */
  }

  // OS-initiated shutdown (systemd stop, `kill`, a reboot, Ctrl-C). Without a
  // handler the process died with no trace, so the next boot could not tell an
  // OS shutdown from a crash AND pending `.meta.json` writes were lost. Record
  // the intent (recovery ALLOWED — after a reboot those sessions are gone and
  // will never reattach), flush, exit.
  //
  // Write-once semantics keep this from fighting `spawnRestart`'s
  // SIGTERM→SIGKILL ladder: `/api/restart` already recorded `"restart"` before
  // the ladder runs, so the later `"signal"` is a no-op.
  // See change: fix-recovery-exit-intent (D4).
  let signalHandled = false;
  const onExitSignal = (signal: NodeJS.Signals): void => {
    if (signalHandled) return;
    signalHandled = true;
    console.log(`[dashboard] ${signal} received — flushing and exiting`);
    try { recordExitIntent("signal"); } catch { /* best-effort */ }
    try { server.flush(); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on("SIGTERM", onExitSignal);
  process.on("SIGINT", onExitSignal);

  // Standalone server process: nobody else is watching this boot, so bound it.
  // See change: fix-worktree-server-autostart-leak.
  await server.start({ deadlineMs: SERVER_STARTUP_DEADLINE_MS });

  // END of successful startup: resolve the pi spawn runtime live (the ladder
  // re-runs here; this also stores the process-lifetime holder the spawn
  // surfaces read) and publish the diagnostic `runtime.resolved` block.
  // Failure-tolerant by contract — a publication error logs a warning and
  // never prevents startup. Nothing consumes the block for execution;
  // resolution always runs live (spec: managed-node-runtime).
  // See change: unify-pi-runtime-identity (task 4.1, design D8).
  try {
    // The gate reads the floor of THE pi copy that will spawn (design D2):
    // derive its entry from the registry's own pi resolution.
    let piEntry: string | null = null;
    try {
      const registry = getDefaultRegistry();
      if (registry?.has("pi")) {
        const exec = registry.resolveExecutor("pi");
        if (exec.ok && exec.argv.length > 0) piEntry = piEntryFromArgv(exec.argv);
      }
    } catch {
      /* registry not initialised — fallback floor (canonical constant) */
    }
    const rt = resolveLiveSpawnRuntime(piEntry ? { piEntry } : {});
    const { block } = publishResolvedRuntime(rt);
    console.log(
      `[runtime] spawn runtime published (source=${block.source}, abi=${block.abi}` +
        `${typeof block.nodeBinary === "string" ? `, ${block.nodeBinary}` : ", bundled — path-free"})`,
    );
  } catch (err) {
    console.warn(
      `[runtime] publication failed (startup continues): ${(err as Error).message ?? err}`,
    );
  }
}


/** Injectable seams of `cmdStart` (tests); production passes none. */
export interface StartDeps {
  classify: (config: ServerConfig) => Promise<PortClassification>;
  launch: typeof launchDashboardServer;
  killProcess: (pid: number, label: string) => Promise<boolean>;
  isProcessAlive: (pid: number) => boolean;
  exit: (code: number) => void;
}

/** One printed verdict + exit code for a classified port; shared by `start` and `status`. */
function portVerdict(
  v: PortClassification,
  config: { port: number },
): { lines: string[]; stream: "log" | "error"; code: number } | null {
  const at = (pid: number | undefined) => (pid === undefined ? "" : ` (pid ${pid})`);
  switch (v.kind) {
    case "owned":
      return { lines: [`Dashboard server is already running (pid ${v.pid})`], stream: "log", code: 0 };
    case "starting":
      return { lines: [`Dashboard server is starting (pid ${v.pid})`], stream: "log", code: 0 };
    case "unowned-dashboard":
      return {
        lines: [
          `Port ${config.port} is served by a dashboard${at(v.pid)} that is not owned by this HOME.`,
          "Use --port <n> to start a separate instance, or stop that dashboard from the HOME that started it.",
        ],
        stream: "error",
        code: 1,
      };
    case "conflict":
      return {
        lines: [
          `Port ${config.port} is occupied by another service (not the dashboard).`,
          "Change the port in ~/.pi/dashboard/config.json or use --port <n>",
        ],
        stream: "error",
        code: 1,
      };
    case "unresponsive":
      return {
        lines: [
          `Dashboard server is running but not responding${at(v.pid)} on port ${config.port}.`,
          "It may be overloaded or frozen. Not starting a second one. Run `pi-dashboard stop` to stop it, then start again.",
        ],
        stream: "error",
        code: 1,
      };
    case "free":
      return null;
  }
}

/**
 * Start the server as a detached background daemon.
 *
 * Classifies the port first (one read-only verdict shared with `status`), only
 * launches when it is free, and prints "started" only when a post-readiness
 * classification sees an owned dashboard reporting the pid this command
 * spawned. See change: harden-dashboard-start-detection (D4).
 */
export async function cmdStart(config: ServerConfig, injected?: Partial<StartDeps>): Promise<void> {
  assertNodeVersionSupported();
  const d: StartDeps = {
    classify: (c) => classifyDashboardPort(c),
    launch: launchDashboardServer,
    killProcess,
    isProcessAlive,
    exit: (code) => process.exit(code),
    ...injected,
  };
  const say = (verdict: { lines: string[]; stream: "log" | "error" }) => {
    for (const line of verdict.lines) (verdict.stream === "log" ? console.log : console.error)(line);
  };

  const pre = portVerdict(await d.classify(config), config);
  if (pre) {
    say(pre);
    if (pre.code !== 0) d.exit(pre.code);
    return;
  }

  // Spawn ourselves in foreground mode (no subcommand) as a detached process.
  // All concerns below — native TypeScript loader resolution, --import argv URL-wrapping,
  // env merge, log-file header, readiness polling, port-conflict / early-exit
  // detection — are owned by the shared `launchDashboardServer` primitive.
  const cliPath = fileURLToPath(import.meta.url);
  const args: string[] = [];
  if (config.port !== 8000) args.push("--port", String(config.port));
  if (config.piPort !== 9999) args.push("--pi-port", String(config.piPort));
  if (config.dev) args.push("--dev");
  if (!config.tunnel) args.push("--no-tunnel");

  const logDir = path.join(os.homedir(), ".pi", "dashboard");
  const logPath = path.join(logDir, "server.log");

  let result: Awaited<ReturnType<typeof launchDashboardServer>>;
  try {
    result = await d.launch({
      cliPath,
      extraArgs: args,
      stdio: { logFile: logPath },
      starter: "Standalone",
      healthTimeoutMs: 30_000,
      port: config.port,
    });
  } catch (err: unknown) {
    // Any early exit — a foreground bind failure exits 1, only the recovery
    // path exits 2 — is re-classified once: losing the bind race to a parallel
    // start of this HOME is "already running", not a failure.
    if (err instanceof PortConflictError || err instanceof EarlyExitError) {
      const after = portVerdict(await d.classify(config), config);
      if (after && (after.code === 0)) {
        say(after);
        return;
      }
    }
    if (err instanceof PortConflictError) {
      console.error(`Port ${err.port} is occupied by another service (not the dashboard).`);
      console.error(`Change the port in ~/.pi/dashboard/config.json or use --port <n>`);
      d.exit(1);
      return;
    }
    if (err instanceof EarlyExitError) {
      console.error(`Failed to start dashboard server (child process exited with code ${err.code})`);
      console.error(`Check logs at ${logPath}`);
      d.exit(1);
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start dashboard server (${reason})`);
    console.error(`Check logs at ${logPath}`);
    d.exit(1);
    return;
  }

  // The launcher's readiness probe dials `localhost`, which can reach a
  // different socket than 127.0.0.1. Confirm with the classifier (full budget).
  const post = await d.classify(config);
  if (post.kind === "owned" && post.pid === result.childPid) {
    console.log(`Dashboard server started (pid ${post.pid}) at http://localhost:${config.port}`);
    return;
  }

  // Not confirmed: never leave a second, unconfirmed server behind.
  if (d.isProcessAlive(result.childPid)) {
    await d.killProcess(result.childPid, "Unconfirmed dashboard server");
  }
  const verdict = portVerdict(post, config);
  if (verdict) {
    say(verdict);
    if (verdict.code !== 0) d.exit(verdict.code);
    return;
  }
  console.error(`Failed to confirm the dashboard server on port ${config.port} (the process launched as pid ${result.childPid} is not serving it).`);
  console.error(`Check logs at ${logPath}`);
  d.exit(1);
}

/**
 * Stop the running server daemon.
 */
/**
 * Kill a process by PID with logging. Delegates to the shared platform
 * primitive (`packages/shared/src/platform/process.ts`) which handles the
 * Windows (taskkill) vs Unix (SIGTERM→SIGKILL) split.
 * See change: consolidate-platform-handlers.
 */
async function killProcess(pid: number, label: string): Promise<boolean> {
  const result = await platformKillProcess(pid);
  if (!result.ok) return false;
  console.log(`${label} stopped${result.forced ? " (forced)" : ""} (pid ${pid})`);
  return true;
}

// Local alias to preserve prior internal references.
const isProcessAlive = (pid: number) => platformIsProcessAlive(pid);

export interface StopDeps {
  findPortHolders: (port: number) => number[];
  killProcess: (pid: number, label: string) => Promise<boolean>;
  readPid: () => number | null;
  removePid: () => void;
  isProcessAlive: (pid: number) => boolean;
  collectOwnedPids: (config: ServerConfig) => Promise<Set<number>>;
}

/**
 * `pi-dashboard stop`. Ports come from the resolved config (same chain as
 * `start`). The port sweep kills only listeners this HOME provably owns;
 * `--force` kills every listener. See change: fix-cli-stop-foreign-home-kill.
 */
export async function cmdStop(
  config: ServerConfig,
  opts: { force?: boolean } = {},
  injected?: Partial<StopDeps>,
): Promise<void> {
  const d: StopDeps = {
    findPortHolders,
    killProcess,
    readPid,
    removePid,
    isProcessAlive,
    collectOwnedPids,
    ...injected,
  };
  // Evidence first: after the PID-file kill the health probe can no longer answer.
  const owned = await d.collectOwnedPids(config);
  const pid = d.readPid();
  let stopped = false;

  // Try PID file first
  if (pid !== null) {
    if (d.isProcessAlive(pid)) {
      stopped = await d.killProcess(pid, "Dashboard server");
    } else {
      console.log("Dashboard server is not running (cleaned up stale PID file)");
    }
    // Only a dead pid's file is stale. A process that survived the kill keeps
    // its pid file so the next `stop` / `status` can still find it.
    // See change: harden-dashboard-start-detection (D3).
    if (!d.isProcessAlive(pid)) d.removePid();
  }

  // Port sweep: ownership-scoped. Non-positive ports (ephemeral) are never inspected.
  const holders = new Map<number, number[]>();
  for (const port of [config.port, config.piPort]) {
    if (!(port > 0)) continue;
    for (const holder of d.findPortHolders(port)) {
      if (stopped && holder === pid) continue;
      const ports = holders.get(holder) ?? [];
      if (!ports.includes(port)) ports.push(port);
      holders.set(holder, ports);
    }
  }
  const { owned: mine, foreign } = partitionHolders(holders, owned);
  for (const h of mine) {
    console.log(`Killing stale process ${h.pid} on port(s) ${h.ports.join(",")}`);
    await d.killProcess(h.pid, `Stale process on port ${h.ports.join(",")}`);
  }
  const dir = getDashboardConfigDir();
  for (const h of foreign) {
    const ports = h.ports.join(",");
    if (opts.force) {
      console.warn(`--force: killing pid ${h.pid} on port(s) ${ports}, NOT owned by this HOME (${dir})`);
      await d.killProcess(h.pid, `Process on port ${ports}`);
    } else {
      console.log(
        `port(s) ${ports} held by pid ${h.pid}, not owned by this HOME (${dir}); not killing. Re-run with --force to kill it anyway.`,
      );
    }
  }

  if (!stopped && pid === null) {
    console.log("Dashboard server is not running");
  }
}

/**
 * `pi-dashboard restart` — restart the daemon.
 *
 * If a dashboard is currently running, POST to `/api/restart` so the proven
 * `restart-helper.ts` orchestrator handles the stop/start atomically in a
 * detached child. This avoids the bridge-auto-start race that occurs when
 * `cmdStop()` kills the daemon in-process: every connected bridge sees its
 * WS close and fires `server-auto-start.ts`, racing the subsequent
 * `cmdStart()` to bind the port.
 *
 * If the dashboard is NOT running (or is unreachable), fall back to the
 * existing `cmdStop()` + `cmdStart()` sequence.
 *
 * See change: fix-restart-bridge-auto-start-race.
 */
export async function cmdRestart(
  config: ServerConfig,
  injected?: {
    isDashboardRunning?: typeof isDashboardRunning;
    fetchImpl?: typeof fetch;
    cmdStopImpl?: (cfg: ServerConfig) => Promise<void>;
    cmdStartImpl?: (cfg: ServerConfig) => Promise<void>;
  },
): Promise<void> {
  const probe = injected?.isDashboardRunning ?? isDashboardRunning;
  const fetchFn = injected?.fetchImpl ?? fetch;
  const stopFn = injected?.cmdStopImpl ?? cmdStop;
  const startFn = injected?.cmdStartImpl ?? cmdStart;
  return cmdRestartImpl(config, probe, fetchFn, stopFn, startFn);
}

async function cmdRestartImpl(
  config: ServerConfig,
  probe: typeof isDashboardRunning,
  fetchFn: typeof fetch,
  stopFn: (cfg: ServerConfig) => Promise<void>,
  startFn: (cfg: ServerConfig) => Promise<void>,
): Promise<void> {
  const status = await probe(config.port);
  if (status.running) {
    console.log(
      `[restart] dashboard running at ${localBase(config)}, delegating to /api/restart`,
    );
    try {
      const restartUrl = `${localBase(config)}/api/restart`;
      const res = await fetchFn(restartUrl, {
        method: "POST",
        // A per-request proof of the local token proves the caller is on this host
        // (needed under requireLocalProof); the raw token never leaves this process.
        headers: { "content-type": "application/json", ...localCredentialHeaders("POST", restartUrl) },
        body: JSON.stringify({ dev: !!config.dev }),
      });
      if (res.ok) {
        console.log("[restart] orchestrator queued; CLI exits now.");
        return;
      }
      const body = await res.text();
      console.error(
        `[restart] server rejected restart: HTTP ${res.status} ${body}; falling back to local stop/start`,
      );
    } catch (err) {
      console.error(
        `[restart] failed to reach server (${(err as Error).message ?? err}); falling back to local stop/start`,
      );
    }
    // Fall through to local sequence on HTTP failure so the user is never
    // left with a half-restarted server.
  }
  await stopFn(config);
  await startFn(config);
}

/**
 * `pi-dashboard token create --label <l> [--tier <t>] [--url <base>]` — mint a
 * paired-device token for a headless host (change: expand-mcp-tiered-surface,
 * D8). Authenticates with the local-IPC token, prints the plaintext once and one
 * `claude mcp add` snippet per reachable URL (or one for `--url`).
 *
 * Returns the process exit code so it is testable without `process.exit`.
 */
export interface TokenCreateDeps {
  fetchImpl?: typeof fetch;
  /** Local-IPC token; `undefined` reads/creates the real one. */
  localToken?: string | null;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Request bound for `cmdLogin` (ms); default 5000. */
  timeoutMs?: number;
}

const TOKEN_TIERS = ["observe", "control", "operate"] as const;

/** Strip trailing slashes WITHOUT a regex (avoids a polynomial-ReDoS shape). */
function stripTrailingSlashes(u: string): string {
  let end = u.length;
  while (end > 0 && u[end - 1] === "/") end -= 1;
  return u.slice(0, end);
}

export async function cmdTokenCreate(
  argv: string[],
  opts: { port: number; host?: string },
  deps: TokenCreateDeps = {},
): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const fetchFn = deps.fetchImpl ?? fetch;

  const args = argv[0] === "create" ? argv.slice(1) : argv;
  let label: string | undefined;
  let tier: string | undefined;
  let url: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--label") label = args[++i];
    else if (a === "--tier") tier = args[++i];
    else if (a === "--url") url = args[++i];
  }
  if (!label) {
    err(
      "usage: pi-dashboard token create --label <label> [--tier observe|control|operate] [--url <base>]",
    );
    return 2;
  }
  if (tier !== undefined && !(TOKEN_TIERS as readonly string[]).includes(tier)) {
    err(`invalid --tier: ${tier} (expected ${TOKEN_TIERS.join(" | ")})`);
    return 2;
  }

  const localToken = deps.localToken !== undefined ? deps.localToken : safeEnsureLocalToken();
  const base = `http://localhost:${opts.port}`;
  // Requests dial the address LITERAL the proof is bound to; `base` is only printed.
  const dial = localBase(opts);

  let minted: { token: string };
  try {
    const mintUrl = `${dial}/api/paired-devices`;
    const res = await fetchFn(mintUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...localCredentialHeaders("POST", mintUrl, localToken),
      },
      body: JSON.stringify({ label, ...(tier ? { tier } : {}) }),
    });
    if (!res.ok) {
      err(`[token] failed to mint: HTTP ${res.status}`);
      return 1;
    }
    const json = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
    if (!json.success || !json.data) {
      err(`[token] failed to mint: ${json.error ?? "unknown error"}`);
      return 1;
    }
    minted = json.data;
  } catch (e) {
    err(`[token] dashboard not running at ${base} (${(e as Error).message ?? e})`);
    return 1;
  }

  let urls: string[] = [];
  if (url) {
    urls = [stripTrailingSlashes(url)];
  } else {
    try {
      const reachableUrl = `${dial}/api/pair/reachable-urls`;
      const res = await fetchFn(reachableUrl, {
        headers: { ...localCredentialHeaders("GET", reachableUrl, localToken) },
      });
      const json = (await res.json()) as { success: boolean; data?: string[] };
      urls = (json.success && json.data ? json.data : []).map(stripTrailingSlashes);
    } catch {
      urls = [];
    }
  }
  if (urls.length === 0) urls = [base];

  out(minted.token);
  for (const u of urls) {
    out(
      `claude mcp add --transport http pi-dashboard ${u}/mcp --header "Authorization: Bearer ${minted.token}"`,
    );
  }
  return 0;
}

/**
 * `pi-dashboard login --local` — D23 break-glass (tasks 18.24). Proves control of
 * the HOST (the 0600 local token), asks the running server for a one-time code
 * and prints the link the browser exchanges for an in-memory local-operator
 * bearer. Works with the IdP down. Returns the exit code (testable).
 */
export async function cmdLogin(
  argv: string[],
  opts: { port: number; host?: string },
  deps: TokenCreateDeps = {},
): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const fetchFn = deps.fetchImpl ?? fetch;
  if (!argv.includes("--local")) {
    err("usage: pi-dashboard login --local [--port <port>]");
    return 2;
  }
  const localToken = deps.localToken !== undefined ? deps.localToken : safeEnsureLocalToken();
  if (!localToken) {
    err("[login] no local token available on this host; cannot prove host control");
    return 1;
  }
  const base = `http://localhost:${opts.port}`;
  try {
    const codeUrl = `${localBase(opts)}/api/identity/local-code`;
    const res = await fetchFn(codeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...localCredentialHeaders("POST", codeUrl, localToken) },
      body: "{}",
      // A server that accepts the connection but never answers must not hang recovery.
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      err(`[login] failed to issue a code: HTTP ${res.status}`);
      return 1;
    }
    const json = (await res.json()) as { success: boolean; data?: { code: string; expiresInSeconds: number }; error?: string };
    if (!json.success || !json.data) {
      err(`[login] failed to issue a code: ${json.error ?? "unknown error"}`);
      return 1;
    }
    out(`${base}/?pi_local=${encodeURIComponent(json.data.code)}`);
    out(`Open this link on this machine within ${json.data.expiresInSeconds} s (single-use). You sign in as the local operator (break-glass).`);
    return 0;
  } catch (e) {
    err(`[login] dashboard not running at ${base} (${(e as Error).message ?? e})`);
    return 1;
  }
}

/** The dial base for local calls: the address LITERAL the server's bind maps to, never `localhost`. */
function localBase(c: { host?: string; port: number }): string {
  return `http://${localDialHost(c.host)}:${c.port}`;
}

/**
 * `X-Pi-Local-Proof` for ONE request (a proof is single-use: bound to the dialled
 * address literal, the method and the request target). The raw token never leaves
 * this process. No token ⇒ no credential header.
 * See change: loopback-credential-proof (D10).
 */
function localCredentialHeaders(
  method: string,
  url: string,
  token: string | null | undefined = safeEnsureLocalToken(),
): Record<string, string> {
  if (!token) return {};
  try {
    return httpProofHeaders(token, url, method);
  } catch (e) {
    // A proof binds an address LITERAL; a host-name bind (`config.host`) has none.
    // Send no credential (the server answers 401) rather than crash with a raw error.
    console.error(`[cli] cannot mint a local credential proof for ${url}: ${(e as Error).message}. Set "host" in config.json to an IP address.`);
    return {};
  }
}

/**
 * Open a URL in the default browser WITHOUT a shell (argv only), so the URL is never
 * interpreted by `sh`/`cmd`. Fire-and-forget.
 */
function openUrlInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" // platform-branch-ok: argv-only browser launcher
      ? ["open", [url]]
      : process.platform === "win32" // platform-branch-ok: argv-only browser launcher
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    /* printed URL above is the fallback */
  }
}

/**
 * `pi-dashboard open [--print]` — mint a one-time local-proof code via the local
 * token and open (or print) `/auth/local-proof?code=…`, which sets the httpOnly
 * proof cookie in the browser. Exit 1 when the server is not running.
 * See change: harden-trust-and-credential-boundaries (D2).
 */
export async function cmdOpen(
  config: ServerConfig,
  opts: {
    print?: boolean;
    /** Origin the browser is sent to (default `http://localhost:<port>`); see {@link validateOpenUrl}. */
    url?: string;
    out?: (s: string) => void;
    err?: (s: string) => void;
    fetchImpl?: typeof fetch;
    open?: (url: string) => void;
  } = {},
): Promise<number> {
  const out = opts.out ?? ((s: string) => console.log(s));
  const err = opts.err ?? ((s: string) => console.error(s));
  const fetchFn = opts.fetchImpl ?? fetch;
  let base = `http://localhost:${config.port}`;
  if (opts.url !== undefined) {
    // Refused BEFORE a token is touched or a code is minted: the code is a 60 s
    // bearer for a proof cookie, so it must never be aimed at a foreign origin.
    const checked = validateOpenUrl(opts.url, config.port);
    if (!checked.ok) {
      err(`refusing --url: ${checked.reason}`);
      return 2;
    }
    base = checked.origin;
  }
  const token = safeEnsureLocalToken();
  if (!token) {
    err("cannot read the local token (~/.pi/dashboard/local/token)");
    return 1;
  }
  let code: string | undefined;
  try {
    const proofUrl = `${localBase(config)}/api/local-proof`;
    const res = await fetchFn(proofUrl, {
      method: "POST",
      headers: localCredentialHeaders("POST", proofUrl, token),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      err(`server rejected the local-proof request: HTTP ${res.status}`);
      return 1;
    }
    code = ((await res.json()) as { data?: { code?: string } }).data?.code;
  } catch {
    err(`server not running on port ${config.port} (start it with: pi-dashboard start)`);
    return 1;
  }
  // The code is a 32-byte base64url token; refuse anything else before it reaches a URL
  // that is handed to the OS browser launcher.
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(code)) {
    err("server returned no valid local-proof code");
    return 1;
  }
  const url = `${base}/auth/local-proof?code=${encodeURIComponent(code)}`;
  out(url);
  if (!opts.print) (opts.open ?? openUrlInBrowser)(url);
  return 0;
}

/**
 * `pi-dashboard open --url` bound (D7): http/https, no userinfo / query / fragment,
 * path `/` at most, and a loopback host on the CONFIGURED server port
 * (`isLauncherOrigin`, the predicate the server's `authorize-browser` remedy uses).
 */
function validateOpenUrl(raw: string, configPort: number): { ok: true; origin: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme must be http or https" };
  if (u.username || u.password) return { ok: false, reason: "the URL must not carry credentials (user:password@)" };
  if (raw.includes("?") || raw.includes("#")) return { ok: false, reason: "the URL must not carry a query or fragment" };
  if (u.pathname !== "/") return { ok: false, reason: "the URL must be an origin only (no path)" };
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  if (!isLauncherOrigin(u.hostname, port, configPort)) {
    return {
      ok: false,
      reason: `only a loopback origin on the configured port ${configPort} is accepted (open the dashboard on http://localhost:${configPort}, or run \`pi-dashboard pair approve\`)`,
    };
  }
  return { ok: true, origin: `${u.protocol}//${u.host}` };
}

function safeEnsureLocalToken(): string | null {
  try {
    return ensureLocalToken();
  } catch {
    return null;
  }
}

// ── `pi-dashboard pair` — host-side approval of a pending device ─────────────
// Uses ONLY the existing routes (GET /api/pair/pending, POST /api/pair/approve-pending,
// POST /api/pair/deny) with a single-use `X-Pi-Local-Proof` minted from the READ-ONLY
// local token: no new route, no guard change, no authority beyond the token file.
// See change: fix-pairing-approval-credential (D2, D3, D8, D9, D10, D12).

/** Exit status classes (D3 / P1). */
const PAIR_EXIT = { usage: 2, credential: 1, refused: 3, unreachable: 4 } as const;

const PAIR_USAGE =
  "usage: pi-dashboard pair list [--json] | approve [<pendingId>] [--code <8 digits>] [--name <label>] [--tier observe|control|operate] | deny <pendingId>";

/** Print-boundary caps in Unicode code points (D8 / P4). `pendingId` is printed in full. */
const PAIR_CAPS = { requesterName: 64, userAgent: 120, viaHost: 64, remoteAddress: 64 } as const;
const PENDING_ID_CAP = Number.MAX_SAFE_INTEGER;

/** The pending-request fields the CLI reads; a confirm code is never one of them. */
export interface PendingRowInput {
  pendingId: string;
  provenance?: string;
  requesterName?: string;
  unencrypted?: boolean;
  userAgent?: string;
  viaHost?: string;
  remoteAddress?: string;
  createdAt?: number;
  expiresAt?: number;
  attemptsLeft?: number;
}

/** Whitelist + sanitise one pending entry (the only shape `list` ever prints or emits). */
function sanitizePending(p: PendingRowInput): PendingRowInput {
  const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? terminalSafe(v, max) : undefined);
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: PendingRowInput = {
    pendingId: terminalSafe(p.pendingId, PENDING_ID_CAP),
    provenance: str(p.provenance, 16),
    requesterName: str(p.requesterName, PAIR_CAPS.requesterName),
    unencrypted: typeof p.unencrypted === "boolean" ? p.unencrypted : undefined,
    userAgent: str(p.userAgent, PAIR_CAPS.userAgent),
    viaHost: str(p.viaHost, PAIR_CAPS.viaHost),
    remoteAddress: str(p.remoteAddress, PAIR_CAPS.remoteAddress),
    createdAt: num(p.createdAt),
    expiresAt: num(p.expiresAt),
    attemptsLeft: num(p.attemptsLeft),
  };
  for (const k of Object.keys(out) as (keyof PendingRowInput)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * Render one pending request for the terminal: the pendingId on its own line (in
 * full, the operator pastes it back), then one `key: value` line per field. Every
 * server-supplied string passes through `terminalSafe` (D8).
 */
export function formatPendingRow(p: PendingRowInput, now: number = Date.now()): string[] {
  const s = sanitizePending(p);
  const lines = [s.pendingId];
  const add = (k: string, v: string | number | undefined) => {
    if (v !== undefined) lines.push(`  ${k}: ${v}`);
  };
  add("name", s.requesterName);
  add("provenance", s.provenance);
  add("user-agent", s.userAgent);
  add("address", s.remoteAddress);
  add("via", s.viaHost);
  if (s.unencrypted) add("transport", "unencrypted");
  if (s.expiresAt !== undefined) add("expires in", `${Math.max(0, Math.round((s.expiresAt - now) / 1000))}s`);
  add("attempts left", s.attemptsLeft);
  return lines;
}

/** `stdin` seam: non-TTY input is read for its first line; `isTTY` selects the prompt. */
export type PairStdin = AsyncIterable<unknown> & { isTTY?: boolean };

export interface PairDeps {
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Interactive code prompt (TTY only); default reads a line from the terminal. */
  prompt?: (question: string) => Promise<string>;
  stdin?: PairStdin;
  /** Local-IPC token; `undefined` reads it (read-only) from `tokenDir`; `null` = unreadable. */
  localToken?: string | null;
  /** Directory holding the `token` file (default `~/.pi/dashboard/local`). */
  tokenDir?: string;
  /** Per-request bound (ms); default 5000, the same bound as the other CLI verbs. */
  timeoutMs?: number;
  now?: () => number;
}

async function defaultPairPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

/** First line of a non-terminal stdin; `null` at EOF with no bytes. Bounded, never waits past the line. */
async function readFirstLine(stdin: AsyncIterable<unknown>): Promise<string | null> {
  let buf = "";
  for await (const chunk of stdin) {
    buf += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    const nl = buf.indexOf("\n");
    if (nl >= 0) return buf.slice(0, nl);
    if (buf.length > 1024) break;
  }
  return buf.length > 0 ? buf : null;
}

/** Spaces and dashes stripped (P2); `null` unless exactly 8 decimal digits. */
function normalizePairCode(raw: string): string | null {
  const stripped = raw.replace(/[\s-]/g, "");
  return /^\d{8}$/.test(stripped) ? stripped : null;
}

interface PairArgs {
  verb: "list" | "approve" | "deny";
  pendingId?: string;
  json: boolean;
  code?: string;
  name?: string;
  tier?: string;
}

/** Cross-option rules for a parsed `pair` command line; a string is a usage error message. */
function checkPairArgs(a: PairArgs): string | null {
  if (a.json && a.verb !== "list") return "--json is only valid for `list`";
  if (a.verb === "list" && a.pendingId !== undefined) return "`list` takes no pendingId";
  if (a.verb !== "approve" && (a.code !== undefined || a.name !== undefined || a.tier !== undefined)) {
    return "--code, --name and --tier are only valid for `approve`";
  }
  if (a.verb === "deny" && a.pendingId === undefined) return "`deny` needs a pendingId";
  if (a.tier !== undefined && !(TOKEN_TIERS as readonly string[]).includes(a.tier)) {
    return `invalid --tier: ${terminalSafe(a.tier, 40)} (expected ${TOKEN_TIERS.join(" | ")})`;
  }
  if (a.name !== undefined && a.name.trim() === "") return "--name must not be empty";
  return null;
}

const PAIR_VALUED_FLAGS = { "--code": "code", "--name": "name", "--tier": "tier" } as const;

/** Apply the option at `argv[i]`; returns the index of the last argv entry it consumed, or a usage error. */
function applyPairOption(a: PairArgs, argv: string[], i: number): number | string {
  const arg = argv[i];
  if (arg === "--json") {
    a.json = true;
    return i;
  }
  if (arg in PAIR_VALUED_FLAGS) {
    const v = argv[i + 1];
    if (v === undefined) return `${arg} needs a value`;
    a[PAIR_VALUED_FLAGS[arg as keyof typeof PAIR_VALUED_FLAGS]] = v;
    return i + 1;
  }
  if (arg === "--port" || arg === "--host" || arg === "--pi-port") return i + 1; // consumed by buildConfig
  if (arg.startsWith("--")) return `unknown option: ${terminalSafe(arg, 40)}`;
  if (a.pendingId !== undefined) return "too many arguments";
  a.pendingId = arg;
  return i;
}

/** Parse `pair` argv; a string is a usage error message. */
function parsePairArgs(argv: string[]): PairArgs | string {
  const verb = argv[0];
  if (verb !== "list" && verb !== "approve" && verb !== "deny") {
    return verb === undefined ? "missing verb" : `unknown verb: ${terminalSafe(verb, 40)}`;
  }
  const a: PairArgs = { verb, json: false };
  for (let i = 1; i < argv.length; i++) {
    const next = applyPairOption(a, argv, i);
    if (typeof next === "string") return next;
    i = next;
  }
  return checkPairArgs(a) ?? a;
}

class PairUnreachable extends Error {}
class PairNoCredential extends Error {}

type PairCall = (method: "GET" | "POST", route: string, body?: unknown) => Promise<{ status: number; json: unknown }>;

/** One HTTP call per proof (a proof is single-use); no proof header ⇒ nothing is sent (D9). */
function makePairCall(base: string, token: string, fetchFn: typeof fetch, timeoutMs: number): PairCall {
  return async (method, route, body) => {
    const url = `${base}${route}`;
    const proof = localCredentialHeaders(method, url, token);
    if (!proof["X-Pi-Local-Proof"]) throw new PairNoCredential();
    try {
      const res = await fetchFn(url, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...proof },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (e) {
      throw new PairUnreachable(terminalSafe((e as Error)?.message ?? String(e), 120));
    }
  };
}

const PAIR_REFUSAL_TEXT: Record<string, string> = {
  locked_out: "[pair] locked out: too many wrong codes for this request; the device must request pairing again",
  expired: "[pair] the request has expired; the device must request pairing again",
  no_pending: "[pair] no such pending request (already approved, denied or expired)",
};

/** The one distinct message per server-refused outcome (exit 3). */
function pairRefusalMessage(status: number, json: unknown, tokenFile: string): string {
  const body = (json ?? {}) as { error?: unknown; attemptsLeft?: unknown };
  const reason = typeof body.error === "string" ? body.error : "";
  if (status === 401) {
    return `[pair] credential rejected (HTTP 401): the server did not accept this host's local credential; the token at ${tokenFile} may belong to a different server or user`;
  }
  if (reason === "mismatch") {
    const n = typeof body.attemptsLeft === "number" ? body.attemptsLeft : undefined;
    return `[pair] the code does not match${n === undefined ? "" : `; ${n} ${n === 1 ? "attempt" : "attempts"} left`}`;
  }
  const known = PAIR_REFUSAL_TEXT[status === 429 ? "locked_out" : reason];
  return known ?? `[pair] server refused: HTTP ${status}${reason ? ` ${terminalSafe(reason, 120)}` : ""}`;
}

interface PairCtx {
  call: PairCall;
  out: (l: string) => void;
  err: (l: string) => void;
  deps: PairDeps;
  tokenFile: string;
  /** Print the refusal and return exit 3 for a non-2xx answer; `null` for a 2xx. */
  refuse: (r: { status: number; json: unknown }) => number | null;
}

/** Live pending entries from the server (`pendingId` is the only field required). */
async function fetchPending(ctx: PairCtx): Promise<{ rows: PendingRowInput[] } | { exit: number }> {
  const r = await ctx.call("GET", "/api/pair/pending");
  const data = (r.json as { data?: unknown } | null)?.data;
  if (r.status < 200 || r.status >= 300 || !Array.isArray(data)) {
    return { exit: ctx.refuse({ status: r.status, json: r.json }) ?? PAIR_EXIT.refused };
  }
  const isRow = (p: unknown): p is PendingRowInput => typeof p === "object" && p !== null && typeof (p as { pendingId?: unknown }).pendingId === "string";
  return { rows: data.filter(isRow) };
}

async function pairList(ctx: PairCtx, json: boolean): Promise<number> {
  const l = await fetchPending(ctx);
  if ("exit" in l) return l.exit;
  if (json) ctx.out(JSON.stringify(l.rows.map(sanitizePending), null, 2));
  else if (l.rows.length === 0) ctx.out("no pending pairing requests");
  else for (const row of l.rows) for (const line of formatPendingRow(row, ctx.deps.now?.())) ctx.out(line);
  return 0;
}

async function pairDeny(ctx: PairCtx, pendingId: string): Promise<number> {
  const r = await ctx.call("POST", "/api/pair/deny", { pendingId });
  const refused = ctx.refuse(r);
  if (refused !== null) return refused;
  ctx.out(`denied ${terminalSafe(pendingId, PENDING_ID_CAP)}`);
  return 0;
}

/** The single pending request's id, or an exit code after printing why none could be chosen. */
async function resolveSinglePending(ctx: PairCtx): Promise<{ pendingId: string } | { exit: number }> {
  const l = await fetchPending(ctx);
  if ("exit" in l) return l;
  if (l.rows.length === 1) return { pendingId: l.rows[0].pendingId };
  ctx.err(l.rows.length === 0 ? "[pair] no pending pairing requests" : `[pair] ${l.rows.length} pending requests; pass the pendingId to approve`);
  for (const row of l.rows) for (const line of formatPendingRow(row, ctx.deps.now?.())) ctx.out(line);
  return { exit: PAIR_EXIT.usage };
}

/** Prompt (TTY) or first stdin line (P3) → 8 digits, else `null`. */
async function readPairCode(deps: PairDeps): Promise<string | null> {
  const stdin = deps.stdin ?? (process.stdin as PairStdin);
  const raw = stdin.isTTY
    ? await (deps.prompt ?? defaultPairPrompt)("Confirmation code shown on the device (8 digits): ")
    : await readFirstLine(stdin);
  return raw === null || raw === undefined ? null : normalizePairCode(raw);
}

async function pairApprove(ctx: PairCtx, a: PairArgs, presetCode: string | undefined): Promise<number> {
  let pendingId = a.pendingId;
  if (pendingId === undefined) {
    const one = await resolveSinglePending(ctx);
    if ("exit" in one) return one.exit;
    pendingId = one.pendingId;
  }
  const code = presetCode ?? (await readPairCode(ctx.deps));
  if (code === null) {
    ctx.err("[pair] expected 8 digits for the confirmation code (none given on stdin or not 8 digits)");
    return PAIR_EXIT.usage;
  }
  const r = await ctx.call("POST", "/api/pair/approve-pending", {
    pendingId,
    confirmCode: code,
    ...(a.name === undefined ? {} : { label: a.name }),
    ...(a.tier === undefined ? {} : { tier: a.tier }),
  });
  const refused = ctx.refuse(r);
  if (refused !== null) return refused;
  const device = (r.json as { data?: { label?: unknown; tier?: unknown } } | null)?.data;
  const label = typeof device?.label === "string" ? terminalSafe(device.label, PAIR_CAPS.requesterName) : undefined;
  const tier = typeof device?.tier === "string" ? terminalSafe(device.tier, 16) : undefined;
  ctx.out(`approved${label ? ` "${label}"` : ""}${tier ? ` (${tier})` : ""}`);
  return 0;
}

/**
 * Credential: READ the token (never create it) and require a dial host a proof can
 * bind to (D9). A host-name bind has no address literal, so it is refused upfront.
 */
function pairCredential(opts: { host?: string }, deps: PairDeps): { token: string; tokenFile: string } | { message: string } {
  const tokenDir = deps.tokenDir ?? defaultLocalTokenDir();
  const tokenFile = path.join(tokenDir, "token");
  const token = deps.localToken !== undefined ? deps.localToken : readLocalTokenIfPresent(tokenDir);
  if (!token) {
    return { message: `[pair] cannot read the local token (${tokenFile}); run this on the host and as the OS user that runs the server` };
  }
  const bindHost = (opts.host ?? "").trim().replace(/^\[(.*)\]$/, "$1");
  if (bindHost !== "" && bindHost.toLowerCase() !== "localhost" && !net.isIP(bindHost)) {
    return { message: `[pair] server host "${terminalSafe(bindHost, 64)}" is a name, not an IP address; set "host" in config.json to an IP literal` };
  }
  return { token, tokenFile };
}

/** Everything `cmdPair` needs after the local (no-network) checks passed. */
interface PairRun {
  parsed: PairArgs;
  presetCode: string | undefined;
  token: string;
  tokenFile: string;
}

/** Local checks, in order: usage, `--code` shape, credential. A failure carries its message and exit status. */
function preparePair(argv: string[], opts: { host?: string }, deps: PairDeps): PairRun | { message: string; exit: number } {
  const parsed = parsePairArgs(argv);
  if (typeof parsed === "string") return { message: `[pair] ${parsed}\n${PAIR_USAGE}`, exit: PAIR_EXIT.usage };
  // A malformed --code is refused locally — it must not spend one of the 5 shared attempts.
  const presetCode = parsed.code === undefined ? undefined : normalizePairCode(parsed.code);
  if (presetCode === null) return { message: "[pair] expected 8 digits for the confirmation code", exit: PAIR_EXIT.usage };
  const cred = pairCredential(opts, deps);
  if ("message" in cred) return { message: cred.message, exit: PAIR_EXIT.credential };
  return { parsed, presetCode, ...cred };
}

/** Exit status for a transport-level failure of a `pair` request. */
function pairFailureExit(e: unknown, base: string, host: string | undefined, err: (l: string) => void): number {
  if (e instanceof PairNoCredential) {
    err(`[pair] cannot derive a local credential for server host ${terminalSafe(host?.trim() || "(default)", 64)}; set "host" in config.json to an IP address`);
    return PAIR_EXIT.credential;
  }
  if (e instanceof PairUnreachable) {
    err(`[pair] server not running at ${base} (${e.message})`);
    return PAIR_EXIT.unreachable;
  }
  throw e;
}

/**
 * `pi-dashboard pair list | approve | deny` (D2/D3). Returns the exit code:
 * 2 usage/input, 1 credential/config, 3 server refused, 4 server unreachable.
 */
export async function cmdPair(argv: string[], opts: { port: number; host?: string }, deps: PairDeps = {}): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));

  const run = preparePair(argv, opts, deps);
  if ("exit" in run) {
    err(run.message);
    return run.exit;
  }
  const { parsed, presetCode, token, tokenFile } = run;

  const base = localBase(opts);
  const ctx: PairCtx = {
    call: makePairCall(base, token, deps.fetchImpl ?? fetch, deps.timeoutMs ?? 5000),
    out,
    err,
    deps,
    tokenFile,
    refuse: (r) => {
      if (r.status >= 200 && r.status < 300) return null;
      err(pairRefusalMessage(r.status, r.json, tokenFile));
      return PAIR_EXIT.refused;
    },
  };
  try {
    if (parsed.verb === "list") return await pairList(ctx, parsed.json);
    if (parsed.verb === "deny") return await pairDeny(ctx, parsed.pendingId as string);
    return await pairApprove(ctx, parsed, presetCode);
  } catch (e) {
    return pairFailureExit(e, base, opts.host, err);
  }
}

/** Injectable seams of `cmdStatus` (tests); production passes none. */
export interface StatusDeps {
  classify: (config: ServerConfig) => Promise<PortClassification>;
  discover: typeof discoverDashboard;
  readPid: () => number | null;
  isProcessAlive: (pid: number) => boolean;
  exit: (code: number) => void;
}

/**
 * Show server status for the RESOLVED port. mDNS contributes only a hostname
 * hint (a record on another port is ignored); the verdict and exit code come
 * from the same classifier as `start`.
 * See change: harden-dashboard-start-detection (D8).
 */
export async function cmdStatus(
  config: Pick<ServerConfig, "port" | "piPort" | "host">,
  injected?: Partial<StatusDeps>,
): Promise<void> {
  const d: StatusDeps = {
    classify: (c) => classifyDashboardPort(c),
    discover: discoverDashboard,
    readPid,
    isProcessAlive,
    exit: (code) => process.exit(code),
    ...injected,
  };

  let hostHint: string | null = null;
  try {
    const servers = await d.discover(2000);
    hostHint = servers.find((s) => s.isLocal && s.port === config.port)?.host ?? null;
  } catch {
    // mDNS failed — the classifier does not need it
  }

  const v = await d.classify(config as ServerConfig);
  switch (v.kind) {
    case "owned":
      console.log(
        `Dashboard server is running (pid ${v.pid}) on port ${config.port}` +
          (hostHint ? ` at ${hostHint}:${config.port} (discovered via mDNS)` : ""),
      );
      return;
    case "starting":
      console.log(`Dashboard server is starting (pid ${v.pid})`);
      return;
    case "free":
      console.log("Dashboard server is not running");
      d.exit(1);
      return;
    case "unresponsive": {
      // The lock metadata names the pid; fall back to a live pid file for the message only.
      const filePid = d.readPid();
      const pid = v.pid ?? (filePid !== null && d.isProcessAlive(filePid) ? filePid : undefined);
      const verdict = portVerdict({ kind: "unresponsive", pid }, config);
      if (verdict) for (const line of verdict.lines.slice(0, 1)) console.log(line);
      d.exit(1);
      return;
    }
    default: {
      const verdict = portVerdict(v, config);
      if (verdict) for (const line of verdict.lines) console.log(line);
      d.exit(verdict?.code ?? 1);
    }
  }
}

/**
 * `pi-dashboard runtime` — print the published `runtime.resolved` block
 * plus a fresh live ladder resolution (task 4.2). Diagnostic only: the
 * published block is never consumed for execution. The CLI has no
 * tool-registry context, so the live half resolves with `piEntry: null` —
 * the pi engines floor falls back to the canonical floor, noted in output
 * when it does. Plain synchronous print, exit 0.
 * See change: unify-pi-runtime-identity.
 */
export function cmdRuntime(
  opts: {
    configPath?: string;
    resolve?: () => ResolvedRuntime;
    out?: (line: string) => void;
  } = {},
): void {
  const out = opts.out ?? console.log;

  out("pi-session spawn runtime (diagnostic)");
  out("");
  out("published (config.json → runtime.resolved):");
  const published = readPublishedRuntimeBlock(opts.configPath);
  out(
    published
      ? JSON.stringify(published, null, 2)
      : "  (none — the server has not completed a startup yet)",
  );

  out("");
  out("live resolution (ladder re-run now, pi entry null → canonical floor fallback):");
  const rt = opts.resolve ? opts.resolve() : resolveSpawnRuntime();
  out(
    JSON.stringify(
      {
        nodeBinary: rt.nodeBinary,
        nodeBinDir: rt.nodeBinDir,
        version: rt.version,
        abi: rt.abi,
        source: rt.source,
        rung: rt.rung,
        arm: rt.arm,
        piFloor: rt.piFloor,
        ...(rt.piFloorSource === "fallback"
          ? { note: `canonical floor ${rt.piFloor} — no pi entry context in the CLI` }
          : {}),
      },
      null,
      2,
    ),
  );
}

/**
 * Install process-level safety net so a single misbehaving plugin or
 * library cannot kill the whole dashboard. Logs the offending error and
 * keeps the event loop running. We do NOT exit; the surrounding daemon
 * harness already restarts on real crashes (signal/exit-code), and
 * silently swallowing recoverable async faults is the lesser evil here.
 */
function installCrashSafetyNet(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error("[crash-safety] unhandledRejection (suppressed):", err.stack || err.message);
  });
  process.on("uncaughtException", (err: Error) => {
    console.error("[crash-safety] uncaughtException (suppressed):", err.stack || err.message);
  });
}

/** Value following `flag` in argv; `""` when the flag is last (so a bare `--url` is refused, not ignored). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : (args[i + 1] ?? "");
}

async function main() {
  installCrashSafetyNet();
  ensureConfig();
  // One-shot: rewrite a pre-flip materialized `subagentTickThrottleMs: 0`.
  // Boot path only — `loadConfig` is a pure read called by every bridge
  // process. See change: heal-orphaned-tool-cards-on-session-end (design D5).
  migrateSubagentTickThrottle();

  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "token") {
    const { flags } = parseArgs(rawArgs.slice(1));
    const config = buildConfig(flags);
    process.exit(await cmdTokenCreate(rawArgs.slice(1), { port: config.port, host: config.host }));
  }

  if (rawArgs[0] === "service") {
    // Managed services consumer contract. See change: add-service-registry-core.
    const { flags } = parseArgs(rawArgs.slice(1));
    const config = buildConfig(flags, () => {});
    const resolveBinary = (name: string) => {
      try {
        const r = getDefaultRegistry().resolve(name);
        return r.ok ? r.path : null;
      } catch {
        return null;
      }
    };
    process.exit(
      await cmdService(rawArgs.slice(1), {
        port: config.port,
        host: config.host,
        authHeaders: (method, target) => localCredentialHeaders(method, `${localBase(config)}${target}`),
        resolveExecSecrets: localExecSecretsResolver({ paths: servicesPaths(), run: defaultCommandRunner, resolveBinary }),
      }),
    );
  }

  if (rawArgs[0] === "pair") {
    // Host-side approval of a pending device. See change: fix-pairing-approval-credential.
    const { flags } = parseArgs(rawArgs.slice(1));
    const config = buildConfig(flags, () => {});
    process.exit(await cmdPair(rawArgs.slice(1), { port: config.port, host: config.host }));
  }

  if (rawArgs[0] === "login") {
    const { flags } = parseArgs(rawArgs.slice(1));
    const config = buildConfig(flags);
    process.exit(await cmdLogin(rawArgs.slice(1), { port: config.port, host: config.host }));
  }

  const { subcommand, flags } = parseArgs(rawArgs);
  // `stop` binds nothing, so the temp-HOME "refusing to bind" warning is noise there.
  const config = buildConfig(flags, subcommand === "stop" ? () => {} : undefined);

  switch (subcommand) {
    case "start":
      await cmdStart(config);
      break;
    case "stop":
      await cmdStop(config, { force: flags.force === true });
      break;
    case "restart":
      await cmdRestart(config);
      break;
    case "status":
      await cmdStatus(config);
      break;
    case "runtime":
      cmdRuntime();
      break;
    case "open":
      process.exit(await cmdOpen(config, { print: rawArgs.includes("--print"), url: flagValue(rawArgs, "--url") }));
      break;
    default:
      // No subcommand — run in foreground (backward compatible)
      await runForeground(config);
      break;
  }
}

// Only run when executed directly (not when imported for testing)
const isDirectExecution = process.argv[1] &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("pi-dashboard"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Failed to start dashboard:", err);
    process.exit(1);
  });
}
