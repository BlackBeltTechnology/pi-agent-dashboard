/**
 * Process manager for spawning pi sessions.
 *
 * Dispatch is owned by `platform/spawn-mechanism.ts`'s `selectMechanism`.
 * Per-mechanism spawn is owned by `platform/detached-spawn.ts`. This
 * module's job is: resolve pi + tool availability, build per-mechanism
 * command, delegate.
 *
 * Invariants:
 *   - No direct `process.platform === "..."` branches in this file.
 *     All platform-aware behaviour lives in `platform/**`.
 *   - Every mechanism branch builds pi argv uniformly from
 *     `buildHeadlessArgs` or its wt/tmux counterpart; `sessionFile`
 *     and `mode` are never dropped by any branch.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SpawnFailureCode } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { loadConfig, type SpawnStrategy } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolveLocalGatewayEndpoint } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { MANAGED_BIN } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import {
  spawnDetached,
  waitForNoCrash,
} from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  buildSafeArgv,
  execFileSync,
  execSync,
  spawnSync,
} from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { prependSelectedNodeToPath } from "@blackbelt-technology/pi-dashboard-shared/node-installs/index.js";
import { electronAsNodeRequired } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import {
  buildWtArgs,
  type SpawnMechanism,
  selectMechanism,
  sessionFlagsToArgv,
  type UserSpawnStrategy,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import {
  type ResolvedRuntime,
  piEntryFromArgv,
  validateResolvedRuntime,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { mintSpawnToken } from "../auth/spawn-token.js";
import {
  createKeeperManager,
  type KeeperManager,
} from "../rpc-keeper/keeper-manager.js";
import {
  currentSpawnRuntime,
  resolveLiveSpawnRuntime,
} from "../runtime-resolution.js";
import { type CwdPolicyRegistry, mergeCwdPolicy } from "./cwd-policy.js";

// ── Resolver seam (injectable for tests) ────────────────────────────────────

let resolver: ToolResolver = new ToolResolver({ processExecPath: process.execPath });

/** Inject a resolver — used by tests. Production code never calls this. */
export function setResolver(r: ToolResolver): void {
  resolver = r;
}

/** Reset to default — used by tests to clean up. */
export function resetResolver(): void {
  resolver = new ToolResolver({ processExecPath: process.execPath });
}

// ── Spawn dashboard target seam ──────────────────────────────────────────────
//
// piPort of the dashboard server that owns this process. Set once at server
// startup. Spawned pi sessions get `PI_DASHBOARD_URL=ws://localhost:<piPort>`
// so their bridge connects back to the server that spawned them — NOT the
// `config.piPort` default (9999). Without this, a second dashboard instance on
// a non-default `--pi-port` (e.g. a git-worktree server) spawns sessions that
// connect to the FIRST dashboard instead. The spawning server must own its
// spawns (spawn-token watchdog, session tracking), so this overrides any
// inherited `PI_DASHBOARD_URL`.
let spawnDashboardPiPort: number | null = null;

/** Set the owning server's piPort so spawned sessions connect back here. */
export function setSpawnDashboardPiPort(piPort: number | null): void {
  spawnDashboardPiPort = piPort;
}

// ── Cwd-policy registry seam (Part B — host-cwd-policy) ──────────────────────
//
// A SINGLE registry instance is wired here AND into every plugin context by the
// server. `spawnPiSession` resolves + merges the cwd policy BEFORE building
// argv/env, so EVERY spawn (plugin or generic) honors the tightening floor.
// When unset (tests that don't wire one, or the pre-change default), the merge
// is a no-op and argv/env are byte-identical. See change: add-plugin-spawn-scope.
let cwdPolicyRegistry: CwdPolicyRegistry | null = null;

/** Wire the shared cwd-policy registry into the spawn funnel. */
export function setCwdPolicyRegistry(registry: CwdPolicyRegistry | null): void {
  cwdPolicyRegistry = registry;
}

// ── KeeperManager seam (injectable for tests) ──────────────────────────

let keeperManager: KeeperManager | null = null;

/** Inject a KeeperManager — used by tests. Production code lazy-inits below. */
export function setKeeperManager(km: KeeperManager | null): void {
  keeperManager = km;
}

/**
 * Public lazy accessor for the singleton `KeeperManager`. Exposed so the
 * server-side dispatch handler (`rpc-keeper/dispatch-router.ts`) and
 * `headlessPidRegistry.setKeeperWriter` can share the same instance the
 * spawn path uses. Tests still inject via `setKeeperManager`.
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6 + 8).
 */
export function getKeeperManager(): KeeperManager {
  if (!keeperManager) {
    // Composition root (design D7): the sweep cap comes from the operator's
    // config so the server-side sweep and the spawn-time keeper env share one
    // source of truth. sweepMinAgeMs/statsTtlMs stay option-seamed defaults —
    // they are not operator knobs. Deliberately NOT a loadConfig import inside
    // keeper-manager.ts: that module has no config dependency and its tests
    // stay cheap because of it.
    const keeperLog = loadConfig().keeperLog;
    keeperManager = createKeeperManager({ maxBytes: keeperLog.maxBytes });
  }
  return keeperManager;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface SessionOptions {
  sessionFile?: string;
  mode?: "continue" | "fork";
  strategy?: SpawnStrategy;
  /**
   * Server-minted spawn correlation token. When provided, injected into
   * the spawned process env as `PI_DASHBOARD_SPAWN_TOKEN`. The bridge
   * echoes it back in the first `session_register` so the server can
   * resolve identity precisely (linkByToken). When omitted, callers
   * fall through to pid-link or cwd-FIFO matching.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
  /**
   * Optional model id appended as `--model <model>` on the spawned pi
   * argv. Used by the automation-plugin run spawn. See change:
   * add-automation-plugin.
   */
  model?: string;
  /**
   * Optional session name appended as `--name <name>` (pi 0.78.0+) so a
   * worktree / flow spawn lands with an intended title at creation instead of
   * relying only on post-hoc auto-naming. See change: adopt-pi-074-080-features.
   */
  name?: string;
  /**
   * Capability-scope fields threaded to `sessionFlagsToArgv` (they extend
   * `SessionFlags` structurally). Populated by `pluginSpawnToSessionOptions`
   * from a plugin's `scope` block. See change: add-plugin-spawn-scope.
   */
  tools?: string[];
  excludeTools?: string[];
  noBuiltinTools?: boolean;
  noTools?: boolean;
  skills?: string[];
  noSkills?: boolean;
  extensions?: string[];
  /**
   * Per-extension config projected to namespaced env (`PI_EXT_<NAME>_<KEY>`)
   * by `buildSpawnEnv` on the headless mechanism. Name+key are uppercased
   * with every non-`[A-Z0-9_]` char replaced by `_`. Scalar values project
   * verbatim; array values as `JSON.stringify(value)` (design D8). See change:
   * add-plugin-spawn-scope.
   */
  extensionConfig?: Record<string, Record<string, string | string[]>>;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
  process?: ChildProcess;
  /** True when spawned from the dashboard (for writing session meta) */
  dashboardSpawned?: boolean;
  /** Structured failure classifier. Set on every { success: false } path. See change: spawn-failure-diagnostics. */
  code?: SpawnFailureCode;
  /** Tail of pi's stderr log (Windows headless PI_CRASHED only). See change: spawn-failure-diagnostics. */
  stderr?: string;
  /** Path to the per-session stderr log (Windows headless). Forwarded to watchdog. See change: spawn-failure-diagnostics. */
  logPath?: string;
  /**
   * Token minted by `spawnPiSession` and injected into the spawned process's
   * env as `PI_DASHBOARD_SPAWN_TOKEN`. Returned so callers can register it
   * with the headless-pid registry, watchdog, and pending-* registries.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
  /**
   * RPC keeper UDS / named-pipe path. Set on every successful headless
   * spawn (the keeper is the only spawn mechanism for `--mode rpc`).
   * Callers pass this to `headlessPidRegistry.register(..., { keeperPid,
   * keeperSockPath })` so later `writeRpc` / `killBySessionId` calls can
   * locate the keeper. `pid` IS the keeper PID, so `keeperPid` is implicit.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar,
   * enable-rpc-keeper-by-default.
   */
  keeperSockPath?: string;
}

/**
 * Build env for pi-session spawns.
 *
 * Order of PATH prepends (highest priority first):
 *   1. With `opts.spawnRuntime` (pi-session spawns): the RESOLVED runtime's
 *      bin dir (change unify-pi-runtime-identity, task 3.1) — the managed
 *      prepend below is skipped.
 *   2. Without it (legacy / managed-tree callers such as pi-core-updater):
 *      the managed Node runtime (`<managedDir>/node/{bin,}`) when installed.
 *      See change: embed-managed-node-runtime.
 *   3. Managed bin (`<managedDir>/node_modules/.bin`), current Node binary
 *      dir, extra bin dirs, common user bin dirs — from
 *      `resolver.buildSpawnEnv`.
 *
 * The managed-Node prepend happens AFTER the resolver's prepends so it
 * lands at the very head of `PATH` — spawned children invoking plain
 * `node` / `npm` resolve to the managed runtime first.
 */
export function buildSpawnEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  opts?: {
    spawnToken?: string;
    /**
     * The node-wrapped `argv[0]` this env will spawn (e.g. `piCmd[0]`).
     * When it is the Electron GUI binary (`execpath-fallback` topology),
     * re-add `ELECTRON_RUN_AS_NODE=1` that `resolver.buildSpawnEnv` strips.
     * Absent ⇒ env byte-identical to today. See change:
     * fix-nodescript-argv-electron-execpath-fallback.
     */
    argv0?: string;
    /** Injected `execPath`/`electronVersion` for deterministic tests. */
    electronDeps?: { execPath?: string; electronVersion?: string };
    /**
     * Per-extension config projected to namespaced env. For each
     * `name`/`key`, sets `PI_EXT_<NAME>_<KEY>` where name+key are uppercased
     * with every `[^A-Z0-9_]` char replaced by `_`. Scalar values project
     * verbatim; array values as `JSON.stringify(value)` (design D8). Absent ⇒
     * env untouched. Applied on the headless (plugin-spawn) mechanism. See
     * change: add-plugin-spawn-scope.
     */
    extensionConfig?: Record<string, Record<string, string | string[]>>;
    /**
     * Ladder-resolved pi spawn runtime (change unify-pi-runtime-identity).
     * When present, the child env derives from the RESOLVED runtime:
     * `spawnRuntime.nodeBinDir` becomes the FIRST `PATH` entry and the
     * managed Node directory is NOT prepended ahead of it (spec
     * managed-node-runtime scenarios "Pi session inherits the resolved
     * runtime" + "Process environment is not globally mutated"). Absent or
     * null ⇒ legacy behavior byte-identical (unconditional managed prepend)
     * for non-pi-session callers — the pi-core-updater managed-tree path
     * (spec scenario "pi-core-updater inherits managed Node").
     * See change: unify-pi-runtime-identity (task 3.1).
     */
    spawnRuntime?: ResolvedRuntime | null;
  },
): NodeJS.ProcessEnv {
  // Defensive copy: never mutate the caller's env (often `process.env`).
  // With a resolved spawn runtime the child PATH leads with the resolved
  // bin dir (spec "Pi session inherits the resolved runtime"); without one
  // the child follows the family SELECTION directly, falling back to the
  // legacy managed prepend when no selection exists — the unconditional
  // managed prepend no longer remains on this path.
  // See change: add-node-runtime-family-selection (section 4, design D7).
  const env = opts?.spawnRuntime
    ? prependResolvedBinDir(resolver.buildSpawnEnv(baseEnv), opts.spawnRuntime)
    : { ...prependSelectedNodeToPath(resolver.buildSpawnEnv(baseEnv)) };
  // The launcher-stamped Electron identity markers are PARENT-identity
  // signals (this server was launched by the Electron app) — they must not
  // leak to grandchildren: a pi session that outlives Electron and
  // bridge-auto-starts a new server would otherwise inherit
  // `PI_DASHBOARD_ELECTRON=1` + a stale `PI_DASHBOARD_RESOURCES_PATH` and
  // misdetect its arm (login-shell-first ordering + stale bundle paths).
  // Same class as the ELECTRON_RUN_AS_NODE strip in resolver.buildSpawnEnv.
  // See change: unify-pi-runtime-identity (CodeRabbit review, round 2
  // non-blocking finding — grandchild marker leak).
  delete env.PI_DASHBOARD_ELECTRON;
  delete env.PI_DASHBOARD_RESOURCES_PATH;
  // Re-add the Electron-as-node flag that `resolver.buildSpawnEnv` strips,
  // but ONLY when the argv[0] we are about to spawn is the Electron binary.
  // The argv-aware chokepoint that keeps this builder in agreement with
  // `runner.buildSpawnEnvForArgv`. No argv0 ⇒ no-op (byte-identical).
  if (opts?.argv0 && electronAsNodeRequired(opts.argv0, opts.electronDeps)) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  // Point spawned bridges at THIS server's gateway so they register with the
  // server that spawned them, not the config-default piPort. Overrides any
  // inherited PI_DASHBOARD_URL. See setSpawnDashboardPiPort above.
  if (spawnDashboardPiPort != null) {
    env.PI_DASHBOARD_URL = `ws://localhost:${spawnDashboardPiPort}`;
    // Pin over the socket too when this instance is serving one. The URL pin
    // alone stops working the moment the default TCP listener goes away (task
    // 8.1), and an inherited `PI_DASHBOARD_SOCKET` from another instance would
    // outrank our URL in the bridge's precedence ladder — the same
    // cross-instance capture, via a different variable (task 2.0f).
    delete env.PI_DASHBOARD_SOCKET;
    const local = resolveLocalGatewayEndpoint({ homedir: env.HOME }, spawnDashboardPiPort);
    if (local.transport === "unix" && existsSync(local.path)) {
      env.PI_DASHBOARD_SOCKET = local.path;
    }
  }
  if (opts?.spawnToken) {
    // Inject the correlation token so the bridge inside the spawned pi
    // process can read it and echo back in `session_register`.
    // See change: spawn-correlation-token.
    env.PI_DASHBOARD_SPAWN_TOKEN = opts.spawnToken;
  }
  if (opts?.extensionConfig) {
    // Project per-extension config into namespaced env. Name+key are
    // normalized to a valid env identifier: a camelCase boundary
    // (`allowedRoots`) gets an underscore inserted, then the token is
    // uppercased and every non-`[A-Z0-9_]` char replaced by `_` (so
    // `allowedRoots`→`ALLOWED_ROOTS`, `api.key`→`API_KEY`, design D4).
    // See change: add-plugin-spawn-scope.
    for (const [name, config] of Object.entries(opts.extensionConfig)) {
      const normName = normalizeEnvSegment(name);
      for (const [key, value] of Object.entries(config)) {
        const normKey = normalizeEnvSegment(key);
        // Scalar string projects verbatim; array projects as JSON so the
        // value is lossless for filesystem paths (design D8).
        env[`PI_EXT_${normName}_${normKey}`] =
          typeof value === "string" ? value : JSON.stringify(value);
      }
    }
  }
  return env;
}

/**
 * Normalize an `extensionConfig` name/key segment into a valid uppercase env
 * identifier: split camelCase boundaries with `_` (`allowedRoots` →
 * `ALLOWED_ROOTS`), uppercase, then replace every non-`[A-Z0-9_]` char with
 * `_` (`api.key` → `API_KEY`, `my-ext` → `MY_EXT`). See change:
 * add-plugin-spawn-scope (design D4).
 */
function normalizeEnvSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}

// ── Spawn-runtime application (change unify-pi-runtime-identity) ────────────

/**
 * Prepend a resolved runtime's bin dir as the FIRST `PATH` entry of a
 * cloned child env, dropping exact duplicates from the tail. Pure: never
 * mutates the input env or `process.env` (spec managed-node-runtime
 * scenario "Process environment is not globally mutated").
 * See change: unify-pi-runtime-identity (task 3.1).
 */
function prependResolvedBinDir(
  env: NodeJS.ProcessEnv,
  rt: ResolvedRuntime,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const currentPath = out.PATH ?? "";
  const rest = currentPath
    ? currentPath.split(path.delimiter).filter((p) => p !== rt.nodeBinDir)
    : [];
  out.PATH = [rt.nodeBinDir, ...rest].join(path.delimiter);
  return out;
}

/**
 * Fresh spawn runtime for a pi-session spawn: read the process-lifetime
 * holder (`runtime-resolution.ts`), re-validate immediately (spec
 * managed-node-runtime scenario "Spawn-time re-validation"), and re-resolve
 * live through the ladder when the stored resolution went stale (e.g. the
 * resolved user Node was deleted since startup — fault X5). Returns null
 * when startup resolution has not run yet; callers then keep the legacy
 * managed-prepend env.
 * See change: unify-pi-runtime-identity (task 9.23 / test-plan X5).
 */
export function spawnRuntimeForSession(): ResolvedRuntime | null {
  const rt = currentSpawnRuntime();
  if (!rt) return null;
  if (validateResolvedRuntime(rt).ok) return rt;
  // Re-resolve with the gate floor of the pi copy THIS session will spawn
  // (design D2) — the same entry resolvePiCommand is about to exec.
  const piCmd = resolver.resolvePi();
  return resolveLiveSpawnRuntime(piCmd ? { piEntry: piEntryFromArgv(piCmd) } : {});
}

/**
 * Re-point an explicit `[<node>, <script>.js]` argv pair — the node-wrapped
 * shape `makeNodeScriptToArgv` produces, e.g. the Windows headless
 * `node.exe + cli.js` pairing — at the resolved spawn runtime's binary
 * (spec managed-node-runtime scenario "Explicit-argv spawns use the
 * resolved binary"). Non-pair argv (bare `pi`), a null runtime, or an
 * argv that already leads with the resolved binary pass through
 * unchanged. Pure and platform-neutral: the pair shape (`.js` second
 * element) is itself the Windows mechanic — on non-Windows the pair only
 * ever re-points when a ladder-resolved runtime differs, which is exactly
 * the ABI-coherence the change establishes.
 * See change: unify-pi-runtime-identity (task 3.2).
 */
export function applySpawnRuntimeToPiArgv(
  piCmd: string[],
  rt: ResolvedRuntime | null,
): string[] {
  if (!rt || piCmd.length < 2) return piCmd;
  if (!/\.js$/i.test(piCmd[1])) return piCmd;
  if (piCmd[0] === rt.nodeBinary) return piCmd;
  return [rt.nodeBinary, ...piCmd.slice(1)];
}

/**
 * Escape a string for safe use inside a POSIX shell command.
 * Used by buildTmuxCommand for tmux/wsl-tmux argv construction.
 */
export function shellEscape(s: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the argv tail for a headless pi invocation: `--mode rpc` plus
 * `--session <file>` or `--fork <file>` when options provide them.
 */
export function buildHeadlessArgs(options?: SessionOptions): string[] {
  return ["--mode", "rpc", ...sessionFlagsToArgv(options ?? {})];
}

/**
 * Build the argv tail for an INTERACTIVE pi invocation (wt, tmux, wsl-tmux):
 * no `--mode rpc`; just session/fork flags when provided.
 */
export function buildInteractivePiArgs(options?: SessionOptions): string[] {
  return sessionFlagsToArgv(options ?? {});
}

/**
 * Build the tmux argv to run pi in a new tmux window/session.
 *
 * Returns an argument vector (NOT a shell string): tmux is invoked via
 * `buildSafeArgv` + `execFileSync` with `shell: false`, so `cwd` travels as a
 * literal `-c <cwd>` element — no dashboard-side shell interprets it. The
 * redundant `cd <cwd> &&` prefix is gone: tmux's own `-c` flag already sets the
 * pane working directory.
 *
 * Layers removed: (1) dashboard-side `/bin/sh` from `execSync`, (3) cmd.exe, and
 * (4) WSL's default shell. Layer (2) — the tmux pane shell that runs
 * `shell-command` — remains BY DESIGN: tmux executes the pane command through a
 * shell of its own, so `shellEscape` is still applied to the pane tokens (pi
 * invocation + session flags). Do not strip it.
 */
export function buildTmuxCommand(
  cwd: string,
  sessionExists: boolean,
  options?: SessionOptions,
  piInvocation: string[] = ["pi"],
): string[] {
  const paneCommand = [
    ...piInvocation.map(shellEscape),
    ...sessionFlagsToArgv(options ?? {}).map(shellEscape),
  ].join(" ");
  // Per-window token. `execFileSync(cmd, { env })` only sets the tmux CLIENT's
  // env; once a `pi-dashboard` server is running, `new-window` inherits the
  // SERVER's environment, so every later window carried the FIRST spawn's token
  // (three concurrent panes were measured sharing one). `-e` scopes it to this
  // window, which is what makes the token a usable identity at all.
  // See change: fix-tmux-session-shutdown-leak (design D5).
  const tokenEnv: string[] = options?.spawnToken
    ? ["-e", `PI_DASHBOARD_SPAWN_TOKEN=${options.spawnToken}`]
    : [];
  if (sessionExists) {
    return ["tmux", "new-window", "-t", "pi-dashboard", ...tokenEnv, "-c", cwd, paneCommand];
  }
  return ["tmux", "new-session", "-d", "-s", "pi-dashboard", ...tokenEnv, "-c", cwd, paneCommand];
}

// ── Availability probes (isolated, one place) ───────────────────────────────

function isTmuxAvailable(): boolean {
  try {
    // `which` / `where` already baked into ToolResolver.
    return resolver.which("tmux") !== null;
  } catch {
    return false;
  }
}

function isWtAvailable(): boolean {
  try {
    return resolver.which("wt") !== null;
  } catch {
    return false;
  }
}

// Cache the WSL-tmux probe for the server lifetime. On machines with a broken
// WSL install (e.g. Docker Desktop WSL mount failure) this single probe can
// cost 30+ seconds — we MUST NOT pay it on every + Session click. The result
// can only change if the user installs/uninstalls WSL or tmux, which requires
// a server restart anyway.
let _wslTmuxAvailabilityCache: boolean | null = null;
let _wslFallbackLogged = false;

/** Test-only: reset the cache so tests can exercise both branches. */
export function _resetWslTmuxCacheForTests(): void {
  _wslTmuxAvailabilityCache = null;
  _wslFallbackLogged = false;
}

function isWslTmuxAvailable(): boolean {
  // WSL tmux probe. Route through `buildSafeArgv` so there is NO
  // cmd.exe-as-shell in the path — `spawnSync("wsl", ["which", "tmux"])`
  // with windowsHide:true + shell:false keeps the console invisible.
  // `wsl.exe` itself still spins up WSL briefly, but that's background
  // (no visible window). Only invoked after `wt` is known absent.
  //
  // Cached for the server lifetime (see comment on _wslTmuxAvailabilityCache).
  if (_wslTmuxAvailabilityCache !== null) return _wslTmuxAvailabilityCache;
  try {
    const { argv, spawnOptions } = buildSafeArgv("wsl", ["which", "tmux"]);
    const r = spawnSync(argv[0], argv.slice(1), {
      stdio: "ignore",
      timeout: 1500,
      ...spawnOptions,
    });
    _wslTmuxAvailabilityCache = r.status === 0;
  } catch {
    _wslTmuxAvailabilityCache = false;
  }
  if (!_wslTmuxAvailabilityCache && !_wslFallbackLogged) {
    _wslFallbackLogged = true;
    console.error(
      "[spawn] Windows Terminal (wt.exe) not on PATH and WSL tmux unavailable \u2014 " +
      "falling back to headless session spawn. Install Windows Terminal for a " +
      "nicer UX: https://aka.ms/terminal",
    );
  }
  return _wslTmuxAvailabilityCache;
}

function dashboardSessionExists(): boolean {
  try {
    execSync("tmux has-session -t pi-dashboard 2>/dev/null", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve pi as argv. Prefers node.exe + cli.js on Windows (avoids .cmd).
 * When a spawn runtime is passed, an explicit `[<node>, <script>.js]` argv
 * pair is re-pointed at the resolved binary (task 3.2).
 * See change: unify-pi-runtime-identity.
 */
function resolvePiCommand(rt?: ResolvedRuntime | null): string[] | null {
  const piCmd = resolver.resolvePi();
  return piCmd ? applySpawnRuntimeToPiArgv(piCmd, rt ?? null) : null;
}

// ── Mechanism dispatch ─────────────────────────────────────────────────────

/**
 * Select the spawn mechanism for this invocation using lazy tool
 * availability probing. Each probe runs a subprocess, so we short-
 * circuit as soon as a mechanism is decided — crucially, the WSL
 * probe (`wsl which tmux`) spins up the WSL VM on Windows and is
 * the most expensive, so we only run it when wt is ALREADY known
 * absent and the user hasn't asked for headless.
 *
 * Ordering mirrors `selectMechanism`'s decision rules:
 *   1. electronMode or userStrategy=headless → no probes at all
 *   2. Unix → probe tmux only
 *   3. Windows → probe wt first; probe wsl-tmux only if wt is absent
 */
function chooseMechanism(options?: SessionOptions, electronMode = false): SpawnMechanism {
  const userStrategy: UserSpawnStrategy = options?.strategy === "headless" ? "headless" : "tmux";
  const platform = process.platform;

  // Short-circuit #1: headless requires no probes.
  if (electronMode || userStrategy === "headless") {
    return "headless";
  }

  // Unix: tmux or headless.
  if (platform === "linux" || platform === "darwin") {
    return selectMechanism({
      platform,
      userStrategy,
      electronMode,
      available: { tmux: isTmuxAvailable(), wt: false, wslTmux: false },
    });
  }

  // Windows: wt first (cheap `where wt`). Only probe WSL when wt is
  // absent — `wsl which tmux` starts the WSL VM and is slow + flashy.
  if (platform === "win32") {
    const wt = isWtAvailable();
    if (wt) {
      return selectMechanism({
        platform,
        userStrategy,
        electronMode,
        available: { tmux: false, wt: true, wslTmux: false },
      });
    }
    const wslTmux = isWslTmuxAvailable();
    return selectMechanism({
      platform,
      userStrategy,
      electronMode,
      available: { tmux: false, wt: false, wslTmux },
    });
  }

  // Unknown platform → headless.
  return "headless";
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function spawnPiSession(
  cwd: string,
  options?: SessionOptions & { electronMode?: boolean },
): Promise<SpawnResult> {
  if (!existsSync(cwd)) {
    return { success: false, code: "DIR_MISSING", message: `Directory does not exist: ${cwd}` };
  }

  // Mint a spawn token if the caller didn't provide one. Token is injected
  // into the spawned process's env (via buildSpawnEnv) and surfaced on
  // SpawnResult so callers can register it with the registries.
  // See change: spawn-correlation-token.
  const spawnToken = options?.spawnToken ?? mintSpawnToken();
  const baseOpts: SessionOptions & { electronMode?: boolean } = { ...(options ?? {}), spawnToken };

  // Resolve + merge the cwd capability floor BEFORE argv/env are built, for
  // EVERY spawn regardless of origin (design B1). No matching policy ⇒
  // `mergeCwdPolicy` returns `baseOpts` unchanged ⇒ byte-identical argv/env.
  const policy = cwdPolicyRegistry?.resolve(cwd);
  const opts = policy ? mergeCwdPolicy(policy, baseOpts) : baseOpts;

  const mechanism = chooseMechanism(opts, opts?.electronMode ?? false);

  let result: SpawnResult;
  switch (mechanism) {
    case "tmux":     result = spawnTmux(cwd, opts); break;
    case "wt":       result = await spawnWt(cwd, opts); break;
    case "wsl-tmux": result = spawnWslTmux(cwd, opts); break;
    case "headless": result = await spawnHeadless(cwd, opts); break;
  }
  // Surface the token on every result (success or failure) so callers
  // can clean up registries deterministically.
  return { ...result, spawnToken };
}

// ── Per-mechanism spawn ────────────────────────────────────────────────────

export function spawnTmux(cwd: string, options?: SessionOptions): SpawnResult {
  const exists = dashboardSessionExists();
  // Carry the registry-resolved pi argv into the pane so tmux sessions honour
  // the SELECTED runtime instead of the shell's first PATH `pi`. Without this,
  // the picker's divergence banner and "new sessions use it immediately" would
  // describe a selection the default interactive path ignores.
  // See change: select-pi-runtime-install (design D9).
  const rt = spawnRuntimeForSession();
  const piCmd = resolvePiCommand(rt);
  if (!piCmd) {
    return { success: false, code: "PI_NOT_FOUND", message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }
  const cmd = buildTmuxCommand(cwd, exists, options, piCmd);
  // Pass env explicitly so PI_DASHBOARD_SPAWN_TOKEN reaches the tmux pane's
  // pi process (tmux inherits the caller's env into new windows/sessions).
  // argv0 re-adds the Electron-as-node flag when piCmd[0] is the Electron binary.
  // See change: spawn-correlation-token.
  const env = buildSpawnEnv(process.env, {
    spawnToken: options?.spawnToken,
    argv0: piCmd[0],
    spawnRuntime: rt,
  });
  try {
    const { argv, spawnOptions } = buildSafeArgv(cmd[0], cmd.slice(1));
    execFileSync(argv[0], argv.slice(1), { stdio: "ignore", env, ...spawnOptions });
    return {
      success: true,
      dashboardSpawned: true,
      message: `Pi session spawned in tmux (${exists ? "new window" : "new session"})`,
    };
  } catch (err: any) {
    return { success: false, code: "TMUX_MISSING", message: `Failed to spawn session: ${err.message}` };
  }
}

export function spawnWslTmux(cwd: string, options?: SessionOptions): SpawnResult {
  try {
    // `wsl.exe --exec <tmux argv>`: `.exe` bypasses the cmd.exe branch in
    // buildSafeArgv; `--exec` runs tmux directly instead of through WSL's
    // default shell. `pi` stays literal so it resolves inside the WSL namespace.
    const tmuxArgv = buildTmuxCommand(cwd, false, options, ["pi"]);
    const env = buildSpawnEnv(process.env, {
      spawnToken: options?.spawnToken,
      spawnRuntime: spawnRuntimeForSession(),
    });
    const { argv, spawnOptions } = buildSafeArgv("wsl.exe", ["--exec", ...tmuxArgv]);
    execFileSync(argv[0], argv.slice(1), { stdio: "ignore", env, ...spawnOptions });
    return { success: true, dashboardSpawned: true, message: "Pi session spawned via WSL tmux" };
  } catch (err: any) {
    return { success: false, code: "TMUX_MISSING", message: `Failed to spawn via WSL tmux (wsl-tmux mechanism): ${err.message}` };
  }
}

async function spawnWt(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  const wt = resolver.which("wt");
  if (!wt) {
    return { success: false, code: "WT_MISSING", message: "Windows Terminal (wt.exe) not found" };
  }
  const rt = spawnRuntimeForSession();
  const piCmd = resolvePiCommand(rt);
  if (!piCmd) {
    return { success: false, code: "PI_NOT_FOUND", message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }

  const piArgv = [...piCmd, ...buildInteractivePiArgs(options)];
  const args = buildWtArgs({ cwd, title: path.basename(cwd) || "pi", piArgv });

  const r = await spawnDetached({
    cmd: wt,
    args,
    cwd,
    // pass the node-wrapped pi argv[0] so the Electron-as-node flag is
    // re-added when it is the Electron binary (execpath-fallback topology).
    env: buildSpawnEnv(process.env, {
      spawnToken: options?.spawnToken,
      argv0: piCmd[0],
      spawnRuntime: rt,
    }),
  });

  if (!r.ok) {
    return { success: false, code: "SPAWN_ERRNO", message: `Failed to launch Windows Terminal: ${r.error}` };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: "Pi session spawned in Windows Terminal",
    pid: r.pid,
    process: r.process,
  };
}

async function spawnHeadless(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  // Headless `--mode rpc` sessions are spawned through the RPC keeper sidecar
  // on every platform. The keeper owns pi's stdin pipe (so pi survives
  // dashboard server restarts) and exposes a per-session UDS / named pipe
  // the server writes RPC `prompt` lines to (so typed extension slash commands
  // like `/ctx-stats` dispatch in headless sessions).
  // See change: add-rpc-stdin-dispatch-with-keeper-sidecar (introduced keeper),
  //             enable-rpc-keeper-by-default (made keeper the only path).
  const args = buildHeadlessArgs(options);
  const rt = spawnRuntimeForSession();
  const piCmd = resolvePiCommand(rt);
  if (!piCmd) {
    return { success: false, code: "PI_NOT_FOUND", message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }
  // Build env AFTER resolving piCmd so the node-wrapped pi argv[0] re-adds
  // the Electron-as-node flag when it is the Electron binary. This env is
  // the keeper's base env, so the forwarded pi child inherits the flag too.
  const env = buildSpawnEnv(process.env, {
    spawnToken: options?.spawnToken,
    argv0: piCmd[0],
    extensionConfig: options?.extensionConfig,
    spawnRuntime: rt,
  });
  return spawnHeadlessViaKeeper(cwd, env, args, piCmd);
}

/**
 * RPC keeper sidecar headless spawn. Uniform across Unix + Windows.
 *
 * The keeper itself is a CJS-pure Node script (`rpc-keeper/keeper.cjs`).
 * It binds a per-session UDS / named pipe BEFORE spawning pi, then owns
 * pi's stdin pipe so it survives dashboard server restarts.
 *
 * Returned `pid` is the KEEPER PID (not pi's). Pi's PID is linked later
 * via the existing `session_register` token correlation path.
 *
 * Crash-detection window applies to KEEPER spawn only — the keeper itself
 * runs a separate 300 ms window on its pi child internally (and surfaces
 * the failure by exiting non-zero, which will be picked up by
 * `headless-pid-registry`'s PID-death tracking).
 *
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 5).
 */
async function spawnHeadlessViaKeeper(
  cwd: string,
  env: NodeJS.ProcessEnv,
  piArgs: string[],
  piCmd: string[],
): Promise<SpawnResult> {
  // sessionId is what the keeper uses to derive its UDS / named-pipe path.
  // This is a TRANSPORT-side identifier, distinct from pi's session UUID
  // (which only exists once pi's RPC mode boots). We mint a fresh one per
  // spawn so the keeper's socket path is unique.
  const transportId = randomUUID();

  // Gate capture of pi's stdout/stderr into keeper-<id>.log on the opt-in
  // config flag (default OFF). Read at spawn time so toggling takes effect on
  // the next spawn without a server restart. The keeper reads this env var to
  // pick its pi-child stdio sink. See change: add-keeper-output-capture-toggle.
  const keeperLog = loadConfig().keeperLog;
  if (keeperLog.capturePiOutput) {
    env = { ...env, PI_KEEPER_CAPTURE_PI_OUTPUT: "1" };
  }
  // The keeper is CJS-pure and cannot import the shared config, so the cap and
  // check interval ride the same env path as capturePiOutput. Read at spawn
  // time (per D7: the keeper's cap is a spawn-time value; keepers started
  // before a config change keep the old cap until their session ends). The
  // keeper strips both vars from pi's env before spawning pi. Note: no
  // "only when default" elision — an explicit value must survive even when it
  // equals the default, so a changed default cannot silently fork behavior
  // between keeper generations.
  // See change: fix-runaway-keeper-log-growth (D7, task 1.3).
  env = {
    ...env,
    PI_KEEPER_LOG_MAX_BYTES: String(keeperLog.maxBytes),
    PI_KEEPER_LOG_CHECK_INTERVAL_MS: String(keeperLog.checkIntervalMs),
  };

  // piArgs already includes `--mode rpc` plus any per-spawn flags from
  // `buildHeadlessArgs(options)` (e.g. `--session-file <path>` for resume,
  // `--fork` for fork). Forwarding them through the keeper preserves the
  // existing resume / fork contract. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
  //
  // piCmd is the ToolRegistry-resolved absolute argv for pi (e.g.
  // ["/abs/path/pi"] on Unix or ["node","/abs/path/cli.js"] on Windows).
  // The keeper consumes it via env var `PI_KEEPER_PI_CMD` and spawns pi
  // without relying on its own PATH. See change: fix-rpc-keeper-pi-resolution.
  const km = getKeeperManager();
  const result = await km.spawnKeeperFor(transportId, cwd, env, piArgs, piCmd);
  if (!result.success || !result.pid || !result.process) {
    return {
      success: false,
      code: "SPAWN_ERRNO",
      message: `Failed to spawn RPC keeper: ${result.error ?? "unknown error"}`,
    };
  }

  // Crash-detection window on the keeper process itself. Keeper applies
  // its own 300 ms window to pi internally; this catches keeper-side
  // failures (bind failure, pi-spawn-error, etc.) that exit the keeper
  // within the window.
  const gate = await waitForNoCrash({ child: result.process, windowMs: 300 });
  if (!gate.ok) {
    return {
      success: false,
      code: "PI_CRASHED",
      message:
        `RPC keeper exited within crash window (code ${gate.exitCode}). ` +
        `Check ~/.pi/dashboard/sessions/keeper-${transportId}.log for details.`,
    };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: `Pi session spawned via RPC keeper (keeper pid ${result.pid}, transport ${transportId.slice(0, 8)})`,
    pid: result.pid,
    process: result.process,
    keeperSockPath: result.sockPath,
    // spawnToken propagated by the outer wrapper; keeper-spawn doesn't
    // mint its own. The token already lives in `env.PI_DASHBOARD_SPAWN_TOKEN`.
  };
}

// Legacy `spawnHeadlessDetached` (Windows direct-stdin pipe) and
// `readLogTail` removed 2026-05-28 by change `enable-rpc-keeper-by-default`.
// All headless `--mode rpc` spawns now go through `spawnHeadlessViaKeeper`,
// which owns pi's stdin via the per-session keeper sidecar and survives
// dashboard server restarts uniformly across Unix and Windows.
