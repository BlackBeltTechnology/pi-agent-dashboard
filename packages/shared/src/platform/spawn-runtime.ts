/**
 * Spawn-runtime resolution ladder — "follow, don't lead".
 *
 * Resolves ONE authoritative Node runtime for pi-session spawns (processes
 * that load the shared extension tree `~/.pi/agent/npm/node_modules`), in
 * order:
 *
 *   1. Explicit override — `runtime.override` in `~/.pi/dashboard/config.json`
 *      (user-owned, the dashboard never writes it), else the family-selection
 *      `node` entry from `~/.pi/dashboard/tool-overrides.json` — one user
 *      intent, one precedence. Honoured only when the binary exists and
 *      passes the version gate.
 *   2. The user's Node — terminal-fidelity order, arm-dependent: GUI/service
 *      launches (Electron) probe the login shell FIRST (the closest
 *      observable approximation of the user's terminal; the service PATH is
 *      exactly the thing not to trust first), terminal-launched arms probe
 *      the inherited PATH first (the server was launched from the very shell
 *      whose Node the ladder wants). Windows: PATH first — no login-shell
 *      concept. Then a filesystem-only probe of well-known version-manager
 *      defaults (nvm `alias/default`, volta/asdf/mise/fnm shims) — no shell
 *      invocation. Each source contributes its FIRST hit only.
 *   3. Managed Node — `<managedDir>/node/` when installed and gate-passing.
 *   4. The dashboard's own runtime — bundled Node on the Electron arm,
 *      `process.execPath` everywhere else. Total by construction.
 *
 * The gate: satisfies the spawned pi copy's `engines.node` floor (read from
 * the resolved pi entry, falling back to the canonical `MIN_SUPPORTED_NODE`)
 * AND is not in the nodejs/node#58515 affected range. The `<27` cap is the
 * SERVER's tested range, not a spawn constraint — a cap-excess candidate is
 * ACCEPTED and flagged so Doctor can note it informationally.
 *
 * The ladder is diagnostic-pure: it never mutates `process.env`, never writes
 * a symlink/shim, and its result is re-validated at spawn time (see
 * `validateResolvedRuntime`). Publication of the result (`runtime.resolved`)
 * happens server-side; `buildPublishedRuntimeBlock` here owns the shape.
 *
 * Resolution is registry-free by design (design D5): the only cross-store
 * reads are two small file reads (`config.json`, `tool-overrides.json`), so
 * this module has no init-ordering dependency on the tool registry.
 *
 * See change: unify-pi-runtime-identity (proposal Part 1, design D1–D5).
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDashboardConfigDir } from "../dashboard-paths.js";
import { getManagedDir } from "../managed-paths.js";
import {
  isAffectedNode,
  isAtOrAboveEnginesCap,
  MIN_SUPPORTED_NODE,
  meetsFloor,
} from "../node-version.js";
import { MANAGED_PI_PACKAGES, whichSync, whichViaLoginShell } from "./binary-lookup.js";
import { spawnSync } from "./exec.js";

// ── Classification (design D4 — vendored from manage-node-runtime-updates) ──

export type NodeSourceClassification = "managed" | "system" | "bundled-electron";

export interface ClassifyNodeSourceOpts {
  /** Default `getManagedDir()`. Injectable for tests. */
  managedDir?: string;
  /** Default `process.resourcesPath` when running inside Electron. */
  resourcesPath?: string;
}

function realpathOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** True when `child` is `dir` itself or anywhere beneath it (sep-safe). */
function isUnder(child: string, dir: string): boolean {
  if (child === dir) return true;
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return child.startsWith(prefix);
}

/**
 * Classify a Node binary path as exactly one of `"managed"`, `"system"`, or
 * `"bundled-electron"` by comparing `realpathSync(nodePath)` against the
 * managed directory (`<managedDir>/node/`) and the Electron-bundled
 * directory (`<resourcesPath>/node/`). Unresolvable paths are `"system"` —
 * the safe-don't-touch default.
 *
 * CONVERGENCE (design D4): this is vendored from the active change
 * `manage-node-runtime-updates` (`specs/node-runtime-update/spec.md`,
 * `classifyNodeSource(nodePath)`), which had not landed when this change
 * started. Exactly one implementation must exist at any time — when that
 * change lands, DELETE this copy and import theirs under the identical
 * signature and semantics.
 */
export function classifyNodeSource(
  nodePath: string,
  opts: ClassifyNodeSourceOpts = {},
): NodeSourceClassification {
  const real = realpathOrNull(nodePath);
  if (!real) return "system";

  const managedRoot = realpathOrNull(
    path.join(opts.managedDir ?? getManagedDir(), "node"),
  );
  if (managedRoot && isUnder(real, managedRoot)) return "managed";

  const resources = opts.resourcesPath ?? electronResourcesPath();
  if (resources) {
    const bundledRoot = realpathOrNull(path.join(resources, "node"));
    if (bundledRoot && isUnder(real, bundledRoot)) return "bundled-electron";
  }

  return "system";
}

// ── Version gate (design D2) ─────────────────────────────────────────────────

export interface VersionGateResult {
  ok: boolean;
  /** Recorded skip reason when `ok` is false. */
  reason?: string;
  /**
   * True when the candidate PASSES the gate but sits at/above the dashboard's
   * tested engines cap (`>=27`) — pi declares no cap, so the candidate is
   * accepted; Doctor surfaces the excess informationally.
   */
  capExceeded?: boolean;
}

/**
 * The step-2 spawn gate: passes the pi floor AND not in the nodejs/node#58515
 * affected range. Cap excess is accepted (with `capExceeded`) — see the module
 * doc comment. Zero version literals here: the floor comes from the caller
 * (the spawned pi copy's engines, or `MIN_SUPPORTED_NODE`), the affected
 * range and the cap from `node-version.ts`.
 */
export function evaluateVersionGate(version: string, floor: string): VersionGateResult {
  if (!meetsFloor(version, floor)) {
    return { ok: false, reason: `below pi floor ${floor} (found ${version})` };
  }
  if (isAffectedNode(version)) {
    return {
      ok: false,
      reason: `in nodejs/node#58515 affected range (${version})`,
    };
  }
  return { ok: true, capExceeded: isAtOrAboveEnginesCap(version) || undefined };
}

// ── Pi engines floor (design D2) ─────────────────────────────────────────────

export interface PiEnginesFloor {
  floor: string;
  /** `"engines"` when parsed from the pi package.json, `"fallback"` otherwise. */
  source: "engines" | "fallback";
}

/**
 * Extract the floor term from an `engines.node` range. Supports the shapes
 * that occur in practice: `>=X.Y.Z` (optionally with a `<cap` term), `^X`,
 * `~X.Y`. Anything else (OR ranges, `*`, garbage, empty) is unreadable →
 * null → the caller falls back to `MIN_SUPPORTED_NODE`. Strictness is the
 * point: a mis-parsed floor silently changes which Nodes the ladder accepts.
 */
export function parseEnginesFloor(range: string): string | null {
  const trimmed = range.trim();
  if (!trimmed || trimmed.includes("||")) return null;

  // `^X` — e.g. `^22` means >=22.0.0 <23.
  let m = trimmed.match(/^\^(\d+)$/);
  if (m) return `${m[1]}.0.0`;

  // `~X.Y` — e.g. `~22.19` means >=22.19.0 <22.20.
  m = trimmed.match(/^~(\d+)\.(\d+)$/);
  if (m) return `${m[1]}.${m[2]}.0`;

  // `>=X.Y.Z` — optionally followed by a `<cap` term (whitespace-separated).
  m = trimmed.match(/^>=(\d+)\.(\d+)\.(\d+)(\s+<[^>]+)?$/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;

  return null;
}

/**
 * Read pi's declared Node floor from the pi copy that will actually be
 * spawned: walk UP from the resolved pi entry to the nearest `package.json`
 * whose `name` is a pi-coding-agent package, parse `engines.node`, and fall
 * back to the canonical `MIN_SUPPORTED_NODE` on anything unreadable. The
 * walk only ever climbs the GIVEN entry's ancestor chain — a global pi
 * elsewhere on the machine is never consulted (which copy spawns is the tool
 * registry's orthogonal axis).
 */
export function readPiEnginesFloor(piEntry?: string | null): PiEnginesFloor {
  const fallback: PiEnginesFloor = { floor: MIN_SUPPORTED_NODE, source: "fallback" };
  if (!piEntry) return fallback;

  const start = realpathOrNull(piEntry);
  if (!start) return fallback;

  let dir = path.dirname(start);
  // Depth guard: the walk terminates at the filesystem root; the bound also
  // caps any pathological symlink loop realpath handed us.
  for (let depth = 0; depth < 32; depth++) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
          name?: string;
          engines?: { node?: string };
        };
        if (pkg.name && (MANAGED_PI_PACKAGES as readonly string[]).includes(pkg.name)) {
          const range = pkg.engines?.node;
          const floor = range ? parseEnginesFloor(range) : null;
          // Found the pi package: its engines (or their absence) decide.
          return floor
            ? { floor, source: "engines" }
            : fallback;
        }
        // A different package.json (monorepo root, wrapper dir) — keep climbing.
      } catch {
        // Unreadable/corrupt package.json — keep climbing.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return fallback;
    dir = parent;
  }
  return fallback;
}

// ── Read-only override/selection helpers (design D5) ────────────────────────

/**
 * Read `runtime.override` from `~/.pi/dashboard/config.json` — the user-owned
 * pin this module NEVER writes. Raw JSON read (not the typed loader): the
 * runtime keys are outside the typed schema and unknown keys must pass
 * through untouched. Malformed/absent → null.
 */
export function readRuntimeOverride(configPath?: string): string | null {
  const file = configPath ?? path.join(getDashboardConfigDir(), "config.json");
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      runtime?: { override?: unknown };
    };
    const override = parsed.runtime?.override;
    return typeof override === "string" && override.trim() ? override : null;
  } catch {
    return null;
  }
}

/**
 * Read the family-selection `node` entry from
 * `~/.pi/dashboard/tool-overrides.json` (the store
 * `add-node-runtime-family-selection` writes atomically via
 * `OverridesStore`). A small read-only file read — deliberately NOT a
 * `ToolRegistry` instance — so the ladder stays registry-free (design D5).
 * Absent/malformed → null.
 */
export function readToolOverrideNode(filePath?: string): string | null {
  const file = filePath ?? path.join(getDashboardConfigDir(), "tool-overrides.json");
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      overrides?: Record<string, { path?: unknown }>;
    };
    const entry = parsed.overrides?.node;
    const p = entry?.path;
    return typeof p === "string" && p.trim() ? p : null;
  } catch {
    return null;
  }
}

// ── Ladder types ─────────────────────────────────────────────────────────────

/** Coarse arm detection — the ladder only branches on electron-vs-not. */
export type SpawnArm = "electron" | "docker" | "npm";

/** Which ladder rung resolved the runtime (Doctor vocabulary). */
export type SpawnRuntimeRung =
  | "override"
  | "selection"
  | "user"
  | "managed"
  | "bundled"
  | "execPath";

/** Step-2 sub-sources — recorded in the trail for Doctor divergence rows. */
export type UserNodeSource = "path" | "login-shell" | "version-manager-default";

export interface VersionProbeResult {
  version: string;
  abi: number;
}

export interface ResolutionStep {
  rung: SpawnRuntimeRung;
  /** Finer sub-source within step 2. */
  via?: UserNodeSource;
  candidate?: string;
  outcome: "selected" | "skipped" | "not-found";
  reason?: string;
}

/** lstat + realpath identity signature (design D7 two-tier re-validation). */
export interface RuntimeIdentity {
  /** stat of the binary (or of the symlink itself when symlinked). */
  size: number;
  mtimeMs: number;
  isSymlink: boolean;
  realpath: string | null;
}

export interface ResolvedRuntime {
  nodeBinary: string;
  nodeBinDir: string;
  version: string;
  abi: number;
  /** `classifyNodeSource` classification of the binary. */
  source: NodeSourceClassification;
  /** Which ladder rung resolved it. */
  rung: SpawnRuntimeRung;
  /** Step-2 sub-source, when `rung === "user"`. */
  via?: UserNodeSource;
  arm: SpawnArm;
  /** pi floor the gate enforced, and where it was read from. */
  piFloor: string;
  piFloorSource: "engines" | "fallback";
  /** True only for the relocating-mount bundle classes (AppImage mount, macOS translocation). */
  ephemeral?: boolean;
  identity: RuntimeIdentity | null;
  trail: ResolutionStep[];
  resolvedAt: string;
}

// ── Injectable environment ───────────────────────────────────────────────────

export interface ResolveSpawnRuntimeOpts {
  /** Step-1a: `runtime.override` (default: read from `~/.pi/dashboard/config.json`). */
  overrideBinary?: string | null;
  /** Step-1b: family-selection `node` entry (default: read from tool-overrides.json). */
  toolOverrideNode?: string | null;
  /** Pi entry (`dist/cli.js` or bin shim) of the pi copy that will be spawned. */
  piEntry?: string | null;
  /** Force the arm; default `detectSpawnArm()`. */
  arm?: SpawnArm;
  /** Force login-shell-first ordering; default derived from arm + platform. */
  loginShellFirst?: boolean;
  managedDir?: string;
  resourcesPath?: string;
  homedir?: string;
  platform?: NodeJS.Platform;
  /** PATH source; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Config/overrides file paths (tests re-point HOME instead). */
  configPath?: string;
  toolOverridesPath?: string;
  // Probes — injectable for the completeness-matrix tests (test-plan E3–E5).
  pathWhich?: (name: string, env?: NodeJS.ProcessEnv) => string | null;
  loginShellWhich?: (name: string) => string | null;
  versionProbe?: (binary: string) => VersionProbeResult | null;
  exists?: (p: string) => boolean;
}

/**
 * Coarse arm detection. `electron` = running inside Electron — either
 * directly (main process: `process.versions.electron` /
 * `process.resourcesPath` exist) or as the packaged server CHILD process,
 * which runs under the bundled plain Node where neither marker exists; the
 * launcher (`packages/electron/src/lib/launch-source.ts`) therefore stamps
 * `PI_DASHBOARD_ELECTRON=1` + `PI_DASHBOARD_RESOURCES_PATH` into the child
 * env and this detection honours them. Without the env marker the child
 * would misdetect as `"npm"` — inverting the arm-dependent step-2 order
 * (PATH-first instead of login-shell-first) and hiding the bundled rung.
 * `docker` = linux container (`/.dockerenv`); everything else (npm -g
 * install, dev checkout) is `"npm"` — behaviorally identical for the
 * ladder (PATH first, `execPath` terminal rung).
 */
export function detectSpawnArm(): SpawnArm {
  if (
    (process.versions as any).electron ||
    (process as any).resourcesPath ||
    process.env.PI_DASHBOARD_ELECTRON === "1"
  ) {
    return "electron";
  }
  if (process.platform !== "win32" && existsSync("/.dockerenv")) return "docker";
  return "npm";
}

/**
 * The Electron resources dir as seen from THIS process: the real
 * `process.resourcesPath` in the Electron main, the launcher-stamped
 * `PI_DASHBOARD_RESOURCES_PATH` env in the packaged server child. Undefined
 * when neither applies (never an Electron context). See detectSpawnArm —
 * same process-boundary rationale. See change: unify-pi-runtime-identity
 * (review round 1: electron-arm-identity-lost-at-process-boundary).
 */
export function electronResourcesPath(): string | undefined {
  const stamped = process.env.PI_DASHBOARD_RESOURCES_PATH;
  if (stamped) return stamped;
  return (process as any).resourcesPath;
}

// ── Version-manager default probe (fs only, no shell) ───────────────────────

interface VmDefaultHit {
  binary: string;
  manager: string;
}

function readTextFileIfExists(p: string): string | null {
  try {
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/** nvm: `~/.nvm/alias/default` → `~/.nvm/versions/node/v<version>/bin/node`. */
function nvmDefaultNode(home: string): VmDefaultHit | null {
  const aliasFile = path.join(home, ".nvm", "alias", "default");
  const raw = readTextFileIfExists(aliasFile)?.trim();
  if (!raw) return null;

  let version = raw.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    // Indirect alias (`lts/iron`) — one resolution hop into the alias dir,
    // then give up (fs-only by contract). Other indirect forms bail.
    const indirect = raw.match(/^lts\/(.+)$/)?.[1];
    const nested = indirect
      ? readTextFileIfExists(path.join(home, ".nvm", "alias", `lts-${indirect}`))?.trim()
      : null;
    if (!nested || !/^\d+\.\d+\.\d+$/.test(nested.replace(/^v/, ""))) return null;
    version = nested.replace(/^v/, "");
  }
  const binary = path.join(home, ".nvm", "versions", "node", `v${version}`, "bin", "node");
  return existsSync(binary) ? { binary, manager: "nvm" } : null;
}

/** Volta / asdf / mise / fnm shim-or-alias paths — first that exists wins. */
const VM_SHIM_PROBES: Array<{ manager: string; rel: string[] }> = [
  { manager: "volta", rel: [".volta", "bin", "node"] },
  { manager: "asdf", rel: [".asdf", "shims", "node"] },
  { manager: "mise", rel: [".local", "share", "mise", "shims", "node"] },
  { manager: "fnm", rel: [".fnm", "aliases", "default", "bin", "node"] },
];

function vmDefaultNode(home: string, exists: (p: string) => boolean): VmDefaultHit | null {
  const nvm = nvmDefaultNode(home);
  if (nvm && exists(nvm.binary)) return nvm;
  for (const probe of VM_SHIM_PROBES) {
    const binary = path.join(home, ...probe.rel);
    if (exists(binary)) return { binary, manager: probe.manager };
  }
  return null;
}

/**
 * Shim-shaped paths: binary shim executables whose OWN stat never changes
 * while the version they exec does (volta/asdf/mise). The identity signature
 * is structurally blind on these, so re-validation probes per spawn
 * (design D7). fnm's alias path is a symlink — covered by the symlink drift
 * tier, not listed here.
 */
const SHIM_PATH_MARKERS = [".volta/bin", ".asdf/shims", "mise/shims"];

export function isShimShapedPath(binary: string): boolean {
  const normalized = binary.split(path.sep).join("/");
  return SHIM_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

// ── The ladder ───────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 5000;
const PROBE_SCRIPT = 'process.version + "|" + process.versions.modules';

/**
 * Default version+ABI probe: exec the candidate with a FIXED argv, no shell —
 * the same trust boundary as the user running `node` in their own terminal
 * (design D1). ELECTRON_RUN_AS_NODE=1 is set so an Electron binary that
 * somehow became a candidate runs as plain node instead of launching the GUI;
 * a plain node ignores it. Garbage output / non-zero exit / timeout → null
 * (candidate rejected with a recorded reason — fault X2).
 */
export function defaultVersionProbe(binary: string): VersionProbeResult | null {
  try {
    const result = spawnSync<string>(binary, ["-p", PROBE_SCRIPT], {
      encoding: "utf-8",
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: { ...(process.env ?? {}), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return null;
    const out = (typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "")).trim();
    const m = out.match(/^(v\d+\.\d+\.\d+\S*)\|(\d+)$/m);
    if (!m) return null;
    return { version: m[1], abi: Number(m[2]) };
  } catch {
    return null;
  }
}

interface Candidate {
  rung: SpawnRuntimeRung;
  via?: UserNodeSource;
  binary: string | null;
}

function identityOf(binary: string): RuntimeIdentity | null {
  try {
    const lst = lstatSync(binary);
    return {
      size: lst.size,
      mtimeMs: lst.mtimeMs,
      isSymlink: lst.isSymbolicLink(),
      realpath: realpathOrNull(binary),
    };
  } catch {
    return null;
  }
}

function bundledNodePath(resources: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(resources, "node", "node.exe")
    : path.join(resources, "node", "bin", "node");
}

function managedNodePath(managedDir: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(managedDir, "node", "node.exe")
    : path.join(managedDir, "node", "bin", "node");
}

/**
 * Bundle-internal relocating-mount classes — their paths re-randomise per
 * launch and are NEVER persisted (design D8). Stable bundle installs are
 * also published path-free (an app update replaces the bundle silently);
 * `ephemeral` additionally marks the two mount classes.
 */
export function isEphemeralBundlePath(p: string): boolean {
  const normalized = p.split(path.sep).join("/");
  return normalized.includes("/tmp/.mount_") || normalized.includes("/AppTranslocation/");
}

/** App-bundle-relative marker used to decide "path-free publication". */
function isUnderResources(p: string, resources?: string): boolean {
  if (!resources) return false;
  const real = realpathOrNull(p) ?? p;
  const realRes = realpathOrNull(resources) ?? resources;
  return isUnder(real, realRes);
}

/**
 * Resolve the ONE spawn runtime for pi sessions. Total: every input state
 * terminates at a runtime (step 4 cannot fail — a running server proves its
 * own execPath exists). Every skip is recorded in `trail` with a reason.
 */
export function resolveSpawnRuntime(opts: ResolveSpawnRuntimeOpts = {}): ResolvedRuntime {
  const platform = opts.platform ?? process.platform;
  const arm = opts.arm ?? detectSpawnArm();
  const homedir = opts.homedir ?? os.homedir();
  const managedDir = opts.managedDir ?? getManagedDir();
  const resourcesPath = opts.resourcesPath ?? electronResourcesPath();
  const exists = opts.exists ?? existsSync;
  const pathWhich = opts.pathWhich ?? ((name, env) => whichSync(name));
  const loginShellWhich = opts.loginShellWhich ?? whichViaLoginShell;
  const probe = opts.versionProbe ?? defaultVersionProbe;

  const trail: ResolutionStep[] = [];
  const piFloor = readPiEnginesFloor(opts.piEntry);
  const loginShellFirst =
    opts.loginShellFirst ?? (arm === "electron" && platform !== "win32");

  const attempt = (candidate: Candidate): ResolvedRuntime | null => {
    if (!candidate.binary) {
      trail.push({ rung: candidate.rung, via: candidate.via, outcome: "not-found" });
      return null;
    }
    if (!exists(candidate.binary)) {
      trail.push({
        rung: candidate.rung,
        via: candidate.via,
        candidate: candidate.binary,
        outcome: "not-found",
        reason: "binary does not exist",
      });
      return null;
    }

    // Step-4 execPath rung: the running server IS the evidence — no probe.
    const isExecPath = candidate.rung === "execPath";
    const probed: VersionProbeResult | null = isExecPath
      ? { version: process.version, abi: Number(process.versions.modules) }
      : probe(candidate.binary);

    if (!probed) {
      trail.push({
        rung: candidate.rung,
        via: candidate.via,
        candidate: candidate.binary,
        outcome: "skipped",
        reason: isExecPath ? "process version unavailable" : "version probe failed or timed out",
      });
      return null;
    }

    const gate = evaluateVersionGate(probed.version, piFloor.floor);
    if (!gate.ok) {
      trail.push({
        rung: candidate.rung,
        via: candidate.via,
        candidate: candidate.binary,
        outcome: "skipped",
        reason: gate.reason,
      });
      return null;
    }

    trail.push({
      rung: candidate.rung,
      via: candidate.via,
      candidate: candidate.binary,
      outcome: "selected",
      ...(gate.capExceeded ? { reason: "exceeds dashboard-tested engines cap (informational)" } : {}),
    });

    const bundled =
      candidate.rung === "bundled" ||
      classifyNodeSource(candidate.binary, { managedDir, resourcesPath }) === "bundled-electron";
    const ephemeral = candidate.rung === "bundled" && isEphemeralBundlePath(candidate.binary);

    return {
      nodeBinary: candidate.binary,
      nodeBinDir: path.dirname(candidate.binary),
      version: probed.version,
      abi: probed.abi,
      source: bundled
        ? "bundled-electron"
        : classifyNodeSource(candidate.binary, { managedDir, resourcesPath }),
      rung: candidate.rung,
      ...(candidate.via ? { via: candidate.via } : {}),
      arm,
      piFloor: piFloor.floor,
      piFloorSource: piFloor.source,
      ...(ephemeral ? { ephemeral: true } : {}),
      identity: identityOf(candidate.binary),
      trail,
      resolvedAt: new Date().toISOString(),
    };
  };

  // ── Step 1: explicit override, then family-selection node ──────────────
  // Computed together so a shadowed selection is named in the trail even when
  // the override wins (design D5: neither surface silently ignored).
  const overrideBinary =
    opts.overrideBinary !== undefined
      ? opts.overrideBinary
      : readRuntimeOverride(opts.configPath);
  const toolOverrideNode =
    opts.toolOverrideNode !== undefined
      ? opts.toolOverrideNode
      : readToolOverrideNode(opts.toolOverridesPath);
  if (overrideBinary && toolOverrideNode && toolOverrideNode !== overrideBinary) {
    // Both stores set, different binaries: runtime.override wins; the
    // shadowed selection is named so neither surface is silently ignored
    // (design D5).
    trail.push({
      rung: "selection",
      candidate: toolOverrideNode,
      outcome: "skipped",
      reason: "shadowed by runtime.override",
    });
  }
  const fromOverride = attempt({
    rung: "override",
    binary: overrideBinary ?? null,
  });
  if (fromOverride) return fromOverride;

  const fromSelection = attempt({ rung: "selection", binary: toolOverrideNode ?? null });
  if (fromSelection) return fromSelection;

  // ── Step 2: the user's Node — arm-dependent terminal-fidelity order ─────
  const pathHit = pathWhich("node", opts.env);
  const loginShellHit = platform === "win32" ? null : loginShellWhich("node");

  const step2Order: Candidate[] = loginShellFirst
    ? [
        { rung: "user", via: "login-shell", binary: loginShellHit },
        { rung: "user", via: "path", binary: pathHit },
      ]
    : [
        { rung: "user", via: "path", binary: pathHit },
        { rung: "user", via: "login-shell", binary: loginShellHit },
      ];

  // Each source contributes its FIRST hit only — the candidate list above
  // already carries at most one entry per source. Then the fs-only
  // version-manager default probe (no shell invocation).
  for (const candidate of step2Order) {
    const resolved = attempt(candidate);
    if (resolved) return resolved;
  }

  const vmHit = vmDefaultNode(homedir, exists);
  const fromVm = attempt({
    rung: "user",
    via: "version-manager-default",
    binary: vmHit?.binary ?? null,
  });
  if (fromVm) return fromVm;

  // ── Step 3: managed Node ────────────────────────────────────────────────
  const fromManaged = attempt({
    rung: "managed",
    binary: managedNodePath(managedDir, platform),
  });
  if (fromManaged) return fromManaged;

  // ── Step 4: the dashboard's own runtime — total ─────────────────────────
  const bundledPath = resourcesPath ? bundledNodePath(resourcesPath, platform) : null;
  const fromBundled = attempt({ rung: "bundled", binary: bundledPath });
  if (fromBundled) return fromBundled;

  const fromExecPath = attempt({ rung: "execPath", binary: process.execPath });
  if (fromExecPath) return fromExecPath;

  // Unreachable in practice (execPath cannot fail while the server runs);
  // kept so the return type stays honest without a non-null assertion.
  throw new Error(
    "resolveSpawnRuntime: ladder is total — execPath rung failed unexpectedly",
  );
}

// ── Pi entry derivation (design D2 — the gate reads THE spawned pi copy) ────

/**
 * Extract the pi entry (a `cli.js` path, or the resolved bin shim/symlink as
 * a fallback) from the tool-registry-resolved pi argv. `readPiEnginesFloor`
 * walks UP from this entry to the spawned pi copy's package.json, so the
 * version gate enforces the floor of the copy that will actually run — not
 * a constant that happens to coincide today. See change:
 * unify-pi-runtime-identity (design D2; review round 1:
 * pi-engines-floor-never-supplied).
 */
export function piEntryFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.endsWith("cli.js")) return arg;
  }
  return argv.length > 0 ? (argv[argv.length - 1] ?? null) : null;
}

// ── Spawn-time re-validation (design D7) ─────────────────────────────────────

export interface RevalidateOpts {
  versionProbe?: (binary: string) => VersionProbeResult | null;
  exists?: (p: string) => boolean;
  lstat?: (p: string) => { size: number; mtimeMs: number; isSymbolicLink(): boolean } | null;
  realpath?: (p: string) => string | null;
}

export interface RevalidateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a previously resolved runtime immediately before a spawn.
 *
 * - Binary gone → invalid (re-resolve before the spawn proceeds).
 * - Shim-shaped path (volta/asdf/mise) → per-spawn version+ABI probe, ALWAYS
 *   — the shim's stat is invariant while its target version is not.
 * - Concrete/symlink paths → lstat+realpath signature compare; on drift,
 *   probe-on-drift: a retarget to the SAME version+ABI is benign (valid),
 *   anything else invalidates.
 */
export function validateResolvedRuntime(
  prev: ResolvedRuntime,
  opts: RevalidateOpts = {},
): RevalidateResult {
  const exists = opts.exists ?? existsSync;
  const probe = opts.versionProbe ?? defaultVersionProbe;
  const lstat = opts.lstat ?? ((p: string) => { try { return lstatSync(p); } catch { return null; } });
  const realpath = opts.realpath ?? realpathOrNull;

  if (!exists(prev.nodeBinary)) {
    return { ok: false, reason: `resolved binary no longer exists: ${prev.nodeBinary}` };
  }

  if (isShimShapedPath(prev.nodeBinary)) {
    const probed = probe(prev.nodeBinary);
    if (!probed) return { ok: false, reason: "shim probe failed" };
    if (probed.version !== prev.version || probed.abi !== prev.abi) {
      return {
        ok: false,
        reason: `shim target changed (was ${prev.version} abi ${prev.abi}, now ${probed.version} abi ${probed.abi})`,
      };
    }
    return { ok: true };
  }

  const lst = lstat(prev.nodeBinary);
  if (!lst) return { ok: false, reason: "lstat failed on resolved binary" };
  const current: RuntimeIdentity = {
    size: lst.size,
    mtimeMs: lst.mtimeMs,
    isSymlink: lst.isSymbolicLink(),
    realpath: realpath(prev.nodeBinary),
  };

  const prevId = prev.identity;
  if (
    !prevId ||
    prevId.size !== current.size ||
    prevId.mtimeMs !== current.mtimeMs ||
    prevId.isSymlink !== current.isSymlink ||
    prevId.realpath !== current.realpath
  ) {
    // Drift — probe before condemning: a retarget to the same version+ABI
    // (e.g. nvm re-pointed after a no-op reinstall) is benign.
    const probed = probe(prev.nodeBinary);
    if (!probed) return { ok: false, reason: "identity drift and probe failed" };
    if (probed.version !== prev.version || probed.abi !== prev.abi) {
      return {
        ok: false,
        reason: `identity drift: runtime changed (was ${prev.version} abi ${prev.abi}, now ${probed.version} abi ${probed.abi})`,
      };
    }
  }

  return { ok: true };
}

/**
 * Convenience wrapper for the spawn path: validate, and on invalidation
 * re-run the ladder so the caller always spawns on a fresh result.
 */
export function ensureFreshRuntime(
  prev: ResolvedRuntime,
  opts: ResolveSpawnRuntimeOpts = {},
): ResolvedRuntime {
  const ok = validateResolvedRuntime(prev, opts);
  if (ok.ok) return prev;
  return resolveSpawnRuntime(opts);
}

// ── Publication shape (design D8 — the write itself is server-side) ─────────

/**
 * Build the `runtime.resolved` block. Bundle-internal runtimes are ALWAYS
 * published path-free (stable installs included — an app update replaces the
 * bundle silently): `{ source, abi, resolvedAt }` + `ephemeral: true` on the
 * two relocating-mount classes. Everything else carries the full shape
 * `{ nodeBinDir, nodeBinary, abi, source, resolvedAt }`.
 */
export function buildPublishedRuntimeBlock(
  rt: ResolvedRuntime,
  opts: { resourcesPath?: string } = {},
): Record<string, unknown> {
  const resourcesPath = opts.resourcesPath ?? electronResourcesPath();
  const pathFree =
    rt.source === "bundled-electron" || isUnderResources(rt.nodeBinary, resourcesPath);
  // The two relocating-mount classes are marked ephemeral — derived from the
  // path itself so the flag cannot go stale relative to reality.
  const ephemeral = rt.ephemeral === true || isEphemeralBundlePath(rt.nodeBinary);
  if (pathFree) {
    return {
      source: rt.source,
      abi: rt.abi,
      resolvedAt: rt.resolvedAt,
      ...(ephemeral ? { ephemeral: true } : {}),
    };
  }
  return {
    nodeBinDir: rt.nodeBinDir,
    nodeBinary: rt.nodeBinary,
    abi: rt.abi,
    source: rt.source,
    resolvedAt: rt.resolvedAt,
  };
}

// ── Resolved family entries (design D3 per-member entry model) ──────────────

/**
 * Entry FILES of a resolved runtime's node/npm/npx family. A family member
 * is an entry FILE, never a directory-sibling assumption (design D3): the
 * bundled POSIX npm lives at `lib/node_modules/npm/bin/npm-cli.js`, not
 * beside the node binary.
 *
 * See change: unify-pi-runtime-identity (spec managed-node-runtime,
 * Requirement: Install/load coherence for the shared extension tree).
 */
export interface ResolvedFamilyEntries {
  /** The resolved runtime's node binary (`rt.nodeBinary`). */
  nodeEntry: string;
  /**
   * The npm CLI SCRIPT of the same runtime's family — an `npm-cli.js` when
   * one of the standard layouts exists, else the bin-dir shim path. A
   * non-`.js` entry is a shim: spawn it directly, not as `[node, shim]`.
   */
  npmEntry: string;
  /** npx entry when the family ships one (the POSIX bundle ships no npx). */
  npxEntry?: string;
}

/**
 * Resolve the entry files of a runtime's node/npm/npx family, probing the
 * layouts that occur in practice (each with `exists`, default
 * `existsSync`) for the npm CLI script:
 *
 *   (a) `<nodeBinDir>/../lib/node_modules/npm/bin/npm-cli.js` — unix
 *       upstream distro layout AND the POSIX bundle layout
 *   (b) `<nodeBinDir>/node_modules/npm/bin/npm-cli.js` — Windows layout
 *       (node.exe and npm's node_modules share the node dir)
 *   (c) `<nodeBinDir>/npm-cli.js` — flat sibling layout
 *   (d) fallback: the bin-dir shim path (`<nodeBinDir>/npm`, `npm.cmd` on
 *       win32) — a spawn-direct shim, not a `[node, shim]` entry
 *
 * The same order covers a bundled-electron runtime: the POSIX bundle
 * resolves via (a), the Windows bundle via (b). Note: the Electron-side
 * authority for the bundled layout is `packages/electron/src/lib/
 * bundled-node.ts` (shared cannot import it); this probe list mirrors its
 * layouts.
 *
 * `npxEntry` mirrors the `npx-cli.js` probes and additionally accepts an
 * existing bin-dir npx shim; it is left undefined when the family ships no
 * npx (verified: the POSIX bundle ships none).
 *
 * See change: unify-pi-runtime-identity (design D3, task 3.3).
 */
export function resolvedFamilyEntries(
  rt: ResolvedRuntime,
  opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {},
): ResolvedFamilyEntries {
  const exists = opts.exists ?? existsSync;
  const platform = opts.platform ?? process.platform;
  const binDir = rt.nodeBinDir;

  const cliEntry = (script: string): string | null => {
    const candidates = [
      path.join(binDir, "..", "lib", "node_modules", "npm", "bin", script),
      path.join(binDir, "node_modules", "npm", "bin", script),
      path.join(binDir, script),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate;
    }
    return null;
  };

  const npmCli = cliEntry("npm-cli.js");
  const npxCli = cliEntry("npx-cli.js");
  const shim = (name: string): string =>
    path.join(binDir, platform === "win32" ? `${name}.cmd` : name);

  const entries: ResolvedFamilyEntries = {
    nodeEntry: rt.nodeBinary,
    npmEntry: npmCli ?? shim("npm"),
  };
  if (npxCli) entries.npxEntry = npxCli;
  else if (exists(shim("npx"))) entries.npxEntry = shim("npx");
  return entries;
}
