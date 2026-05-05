/**
 * launch-source.ts — LaunchSource V2 resolver for the Electron main process.
 *
 * Resolves which server binary / source tree to use, in priority order:
 *   1. attach      — a compatible server is already running; just attach.
 *   2. devMonorepo — running from the checked-out monorepo (dev workflow).
 *   3. piExtension — the pi bridge extension packages a server.
 *   4. npmGlobal   — `pi-dashboard` is installed globally via npm.
 *   5. extracted   — bundled Electron resources (managed install); always succeeds.
 *
 * All I/O probes are injectable so unit tests never touch the real filesystem,
 * network, or child-process layer.
 *
 * Gated behind `isLaunchSourceV2Enabled(process.env)` in main.ts (Phase A).
 * See openspec/changes/simplify-electron-bootstrap-derived-state.
 */

import path from "node:path";
import os from "node:os";
import { spawnDetached } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { resolveJitiImport, resolveJitiFromAnchor } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";
import { installStandalone } from "./dependency-installer.js";
import { toFileUrl, shouldUrlWrapEntry } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";
import type { LaunchSource, SourceKind } from "@blackbelt-technology/pi-dashboard-shared/launch-source-types.js";
import type { DashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

export type { LaunchSource, SourceKind };

// ── Constants ────────────────────────────────────────────────────────────────

export const VALID_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "attach",
  "devMonorepo",
  "piExtension",
  "npmGlobal",
  "extracted",
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
  console.warn(
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
  readFileSync(p: string, enc: "utf-8"): string;
  writeFileSync(p: string, data: string): void;
  renameSync(src: string, dst: string): void;
  which(cmd: string): Promise<string | null>;
  /** Run `cmd --version` and return the version string, or null on timeout/error. */
  spawnVersion(cmd: string, timeoutMs: number): Promise<string | null>;
  realpathSync(p: string): string;
  requireResolve(id: string, options?: { paths: string[] }): string;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface LaunchSourceOpts {
  isPackaged: boolean;
  cwd: string;
  preferOverride: SourceKind | null;
  bundledMinVersion: string;
  resourcesPath: string;
  port?: number;
  /** ~/.pi/dashboard config dir (defaults to os.homedir()/.pi/dashboard). */
  dashboardConfigDir?: string;
  probes?: Partial<LaunchSourceProbes>;
}

// ── Default probe implementations ─────────────────────────────────────────────

import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync, realpathSync as fsRealpathSync, renameSync as fsRenameSync } from "node:fs";
import { needsExtraction, extractBundle } from "./bundle-extract.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process"; // ban:child_process-ok default probe impls only; injectable in tests

const _require = createRequire(import.meta.url);

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

function defaultWhich(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === "win32" ? "where" : "which"; // platform-branch-ok default probe
    execFile(whichCmd, [cmd], { encoding: "utf-8" }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.trim().split(/\r?\n/)[0]?.trim();
      resolve(line || null);
    });
  });
}

function defaultSpawnVersion(cmd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    const child = execFile(cmd, ["--version"], { encoding: "utf-8" }, (err, stdout) => {
      clearTimeout(timer);
      if (err) return resolve(null);
      const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? null;
      resolve(line || null);
    });
  });
}

function defaultRequireResolve(id: string, options?: { paths: string[] }): string {
  return _require.resolve(id, options);
}

function buildProbes(partial?: Partial<LaunchSourceProbes>): LaunchSourceProbes {
  return {
    healthProbe: partial?.healthProbe ?? defaultHealthProbe,
    existsSync: partial?.existsSync ?? fsExistsSync,
    readFileSync: partial?.readFileSync ?? ((p, enc) => fsReadFileSync(p, enc)),
    writeFileSync: partial?.writeFileSync ?? ((p, data) => fsWriteFileSync(p, data)),
    renameSync: partial?.renameSync ?? fsRenameSync,
    which: partial?.which ?? defaultWhich,
    spawnVersion: partial?.spawnVersion ?? defaultSpawnVersion,
    realpathSync: partial?.realpathSync ?? fsRealpathSync,
    requireResolve: partial?.requireResolve ?? defaultRequireResolve,
  };
}

// ── Version comparison (inline, no semver dep) ────────────────────────────────

function parseVersionTriplet(v: string): [number, number, number] | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function versionGte(version: string, minimum: string): boolean {
  const a = parseVersionTriplet(version);
  const b = parseVersionTriplet(minimum);
  if (!a || !b) return true; // can't parse → be permissive
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
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

function parsePiSettings(
  probes: LaunchSourceProbes,
): { extensions?: Array<{ path: string; [k: string]: unknown }> } | null {
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  try {
    const raw = probes.readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw) as { extensions?: Array<{ path: string }> };
  } catch {
    return null;
  }
}

async function probePiExtension(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  const settings = parsePiSettings(probes);
  if (!settings?.extensions) return null;

  for (const ext of settings.extensions) {
    if (!ext.path) continue;
    const extDir = path.dirname(ext.path);

    // Check that this extension directory contains bridge.ts.
    const bridgeTs = path.join(extDir, "bridge.ts");
    const srcBridgeTs = path.join(extDir, "src", "bridge.ts");
    if (!probes.existsSync(bridgeTs) && !probes.existsSync(srcBridgeTs)) continue;

    // Try to resolve the server package from this extension's directory.
    let serverPkgPath: string;
    try {
      serverPkgPath = probes.requireResolve(
        "@blackbelt-technology/pi-dashboard-server/package.json",
        {
          paths: [
            extDir,
            path.join(extDir, ".."),
            path.join(extDir, "node_modules"),
          ],
        },
      );
    } catch {
      continue;
    }

    // Version check.
    let serverVersion: string | undefined;
    try {
      const pkg = JSON.parse(probes.readFileSync(serverPkgPath, "utf-8")) as { version?: string };
      serverVersion = pkg.version;
    } catch {
      continue;
    }
    if (!serverVersion || !versionGte(serverVersion, opts.bundledMinVersion)) continue;

    // pi --version check.
    const piVersion = await probes.spawnVersion("pi", 3000);
    if (!piVersion || !versionGte(piVersion, opts.bundledMinVersion)) continue;

    const serverPkgDir = path.dirname(serverPkgPath);
    const cliPath = path.join(serverPkgDir, "src", "cli.ts");
    return { kind: "piExtension", cliPath, cwd: extDir };
  }

  return null;
}

async function probeNpmGlobal(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  const whichResult = await probes.which("pi-dashboard");
  if (!whichResult) return null;

  // Must not be under resourcesPath (would mean it's our own bundled binary).
  let realWhich: string;
  try {
    realWhich = probes.realpathSync(whichResult);
  } catch {
    return null;
  }
  const normalResources = opts.resourcesPath.replace(/\\/g, "/");
  const normalReal = realWhich.replace(/\\/g, "/");
  if (normalReal.startsWith(normalResources)) return null;

  // Version check.
  const versionOutput = await probes.spawnVersion(whichResult, 3000);
  if (!versionOutput) return null;
  if (!versionGte(versionOutput, opts.bundledMinVersion)) return null;

  // Resolve server cli.ts from the npm-global install.
  let serverPkgPath: string;
  try {
    serverPkgPath = probes.requireResolve(
      "@blackbelt-technology/pi-dashboard-server/package.json",
      { paths: [path.dirname(whichResult)] },
    );
  } catch {
    return null;
  }

  const cliPath = path.join(path.dirname(serverPkgPath), "src", "cli.ts");
  return { kind: "npmGlobal", cliPath, cwd: path.dirname(whichResult) };
}

/**
 * Pure helper: returns true iff the extracted managed dir is usable to spawn
 * the dashboard server. "Usable" means cliPath exists on disk AND jiti is
 * resolvable via createRequire walking up from cliPath.
 *
 * The version marker alone is insufficient because it can be stale relative
 * to the actual node_modules tree (partial extraction, AV quarantine, manual
 * wipe, npm reconciliation prune). When this returns false the caller MUST
 * force re-extract + installStandalone.
 *
 * Defensive: any thrown error from the injected probes is treated as
 * unhealthy. Pure when both deps are injected.
 *
 * See change: fix-electron-extracted-jiti-and-stdio-capture.
 */
export function extractedSourceIsHealthy(
  cliPath: string,
  deps?: {
    existsSync?: (p: string) => boolean;
    resolveJitiFromAnchor?: (anchor: string) => string | null;
  },
): boolean {
  const exists = deps?.existsSync ?? fsExistsSync;
  const resolveJiti = deps?.resolveJitiFromAnchor ?? resolveJitiFromAnchor;
  try {
    if (!exists(cliPath)) return false;
    const url = resolveJiti(cliPath);
    return typeof url === "string" && url.length > 0;
  } catch {
    return false;
  }
}

async function buildExtractedSource(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource> {
  const managedDir = path.join(os.homedir(), ".pi-dashboard");
  const cliPath = path.join(
    managedDir,
    "node_modules",
    "@blackbelt-technology",
    "pi-dashboard-server",
    "src",
    "cli.ts",
  );

  // Check if extraction is needed and run it.
  const currentVersion = opts.bundledMinVersion;
  const extractFs: import("./bundle-extract.js").ExtractFs = {
    existsSync: probes.existsSync,
    readFileSync: probes.readFileSync,
    writeFileSync: probes.writeFileSync,
    renameSync: probes.renameSync,
    mkdirSync: (p, o) => { /* no-op in probe — real fs used via extractBundle default */ },
    readdirSync: () => [],
    rmSync: () => {},
    statSync: () => ({ isDirectory: () => false }),
  };

  const markerSaysExtract = needsExtraction(managedDir, currentVersion, extractFs);
  // Health-check the extracted tree even when the marker matches: marker can
  // be stale relative to actual node_modules contents (partial extraction,
  // AV quarantine, manual wipe, npm prune). When unhealthy we force the
  // extract+install block to run.
  // See change: fix-electron-extracted-jiti-and-stdio-capture.
  const healthy = markerSaysExtract
    ? false  // about to extract anyway
    : extractedSourceIsHealthy(cliPath, {
        existsSync: probes.existsSync,
        resolveJitiFromAnchor,
      });
  if (!markerSaysExtract && !healthy) {
    console.warn(
      "[launch-source] extracted source unhealthy (jiti missing); forcing re-extract",
    );
  }
  const didExtract = markerSaysExtract || !healthy;
  if (didExtract) {
    const configDir = opts.dashboardConfigDir ?? path.join(os.homedir(), ".pi", "dashboard");
    const migrateDir = path.join(
      configDir,
      "migrate",
      new Date().toISOString().replace(/:/g, "-"),
    );
    try {
      // Bundle source is `<resourcesPath>/server/` — the layout produced by
      // `bundle-server.mjs` (synthetic package.json + packages/ + node_modules/).
      // Top-level `resourcesPath` cannot be the source: it contains app.asar
      // (a file), so cpSync recurses and trips ENOTDIR on opendir(app.asar).
      // The cliPath constructed above resolves only when `<server>/node_modules/
      // @blackbelt-technology/pi-dashboard-server/src/cli.ts` lands at
      // `<managedDir>/node_modules/...`, which is exactly what cpSync of
      // `<resourcesPath>/server/` produces.
      const bundleSource = path.join(opts.resourcesPath, "server");
      // Pass extractFs so tests can inject the existsSync/writeFileSync behaviour.
      // Real fs handles mkdirSync/readdirSync/rmSync/cpSync by default.
      extractBundle(managedDir, bundleSource, currentVersion, migrateDir, extractFs);

      // Seed installable.json (idempotent — only when absent).
      const installableTarget = path.join(configDir, "installable.json");
      if (!probes.existsSync(installableTarget)) {
        const bundledDefaults = path.join(opts.resourcesPath, "installable-defaults.json");
        if (probes.existsSync(bundledDefaults)) {
          const content = probes.readFileSync(bundledDefaults, "utf-8");
          const tmp = installableTarget + ".tmp";
          probes.writeFileSync(tmp, content);
          probes.renameSync(tmp, installableTarget);
        }
      }

      // Detach the bundle's build-time package.json + package-lock.json BEFORE
      // running installStandalone. `bundle-server.mjs` writes a synthetic
      // workspace package (workspaces: ["packages/server", "packages/shared",
      // "packages/extension"]) and the matching package-lock so the Docker
      // build-time `npm install` (in resources/server/) sets up workspace
      // symlinks for native module resolution. At runtime both files are
      // actively harmful: `npm install --prefix <managedDir>` (called by
      // installStandalone) reconciles node_modules against the lockfile and
      // wipes the pre-extracted `@blackbelt-technology/*` entries we just
      // copied in (since their lockfile records say "workspace link" but the
      // stripped package.json no longer declares workspaces) — destroying
      // cliPath and breaking the spawn.
      //
      // Resolution: nuke both files. ensureManagedDir() will recreate a
      // minimal package.json on its first call; npm install with explicit
      // packages (no lockfile) only ADDS the requested deps and does not
      // prune unrelated node_modules entries.
      //
      // Smoke test `launch-source.smoke.test.ts` Tier B caught this.
      // See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
      try {
        const fsMod = await import("node:fs");
        const pkgPath = path.join(managedDir, "package.json");
        const lockPath = path.join(managedDir, "package-lock.json");
        // package.json: keep file, but strip workspaces if present (defensive
        // in case ensureManagedDir's existsSync check no-ops the rewrite).
        if (fsMod.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fsMod.readFileSync(pkgPath, "utf-8"));
            if (pkg.workspaces !== undefined) {
              delete pkg.workspaces;
              fsMod.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
            }
          } catch { /* malformed JSON — ensureManagedDir will overwrite */ }
        }
        // package-lock.json: nuke. The bundle's lockfile is build-time only.
        if (fsMod.existsSync(lockPath)) {
          fsMod.rmSync(lockPath, { force: true });
        }
      } catch (stripErr: any) {
        // Non-fatal: if the operations fail, installStandalone may still
        // succeed (it creates managedDir/package.json when missing).
        console.error(
          "[launch-source] could not normalize managedDir before install:",
          stripErr?.message ?? String(stripErr),
        );
      }

      // Install runtime baseline (pi-coding-agent + tsx + openspec) into
      // managedDir from the bundled offline cacache. Without this, the
      // spawned server cannot resolve jiti to load TypeScript source files
      // — `bundle-server.mjs` deliberately omits pi from the bundle (see its
      // comment block) and relies on this offline-cache install instead.
      // The legacy path (LAUNCH_SOURCE_V2=false) does the equivalent via
      // `runPowerUserManagedInstall`. Idempotent: gated by `didExtract`,
      // and `installStandalone` itself short-circuits already-installed
      // packages.
      // See change: simplify-electron-bootstrap-derived-state (Phase C
      // bring-up — spec gap: server-side `bootstrap-install-from-list`
      // cannot install jiti because the server needs jiti to start).
      // Swap-aside pattern: protect bundle's node_modules from npm's
      // reconciliation. The synthetic package.json bundle-server.mjs
      // writes declares no dependencies, so `npm install --prefix
      // <managedDir> @mariozechner/pi-coding-agent ...` treats every
      // existing entry under node_modules/ as "extraneous" and prunes it.
      // That destroys not just @blackbelt-technology/* (cliPath) but
      // every server runtime dep (fastify, ws, lru-cache, etc.).
      //
      // Move the bundle's node_modules aside, let npm install build a
      // fresh tree containing only pi/tsx/openspec + their deps, then
      // overlay the bundle snapshot back on top — bundle wins on conflicts
      // (it's the version the server was built and tested against;
      // pi-coding-agent's namespace is mostly @mariozechner/* which the
      // bundle never had, so the merge is mostly additive).
      //
      // Smoke test `launch-source.smoke.test.ts` Tier B/C caught both
      // pruning regressions.
      const fsMod = await import("node:fs");
      const managedNm = path.join(managedDir, "node_modules");
      const stashedNm = path.join(managedDir, ".bundle-node-modules");
      let stashed = false;
      try {
        if (fsMod.existsSync(managedNm)) {
          // rmSync first in case a previous interrupted run left a stash.
          fsMod.rmSync(stashedNm, { recursive: true, force: true });
          fsMod.renameSync(managedNm, stashedNm);
          stashed = true;
        }
      } catch (stashErr: any) {
        console.error(
          "[launch-source] could not stash bundle node_modules:",
          stashErr?.message ?? String(stashErr),
        );
      }

      try {
        await installStandalone();
      } catch (installErr: any) {
        console.error(
          "[launch-source] runtime baseline install failed:",
          installErr?.message ?? String(installErr),
        );
      }

      // Merge the stashed bundle tree back on top. cpSync with default
      // force:true overwrites files where bundle and npm both wrote;
      // bundle versions win (deliberate — the server was tested against
      // them). Directories are merged additively.
      if (stashed) {
        try {
          fsMod.cpSync(stashedNm, managedNm, { recursive: true });
          fsMod.rmSync(stashedNm, { recursive: true, force: true });
        } catch (mergeErr: any) {
          console.error(
            "[launch-source] could not merge bundle node_modules back:",
            mergeErr?.message ?? String(mergeErr),
          );
        }
      }
    } catch (err: any) {
      // Print code + path so the failing entry is identifiable. Earlier the
      // log truncated to "ENOTDIR: not a directory, opendir" with no path,
      // making it impossible to know which file under <resourcesPath>/server
      // tripped the recursive cpSync. See change:
      // simplify-electron-bootstrap-derived-state (Phase C bring-up).
      console.error(
        "[launch-source] bundle extraction failed:",
        "code=" + (err?.code ?? "unknown"),
        "syscall=" + (err?.syscall ?? "unknown"),
        "path=" + (err?.path ?? "unknown"),
        "message=" + (err?.message ?? String(err)),
      );
      // Return source anyway — server may still start if a prior extraction exists.
      return { kind: "extracted", cliPath, cwd: managedDir, didExtract: false };
    }
  }

  return { kind: "extracted", cliPath, cwd: managedDir, didExtract };
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the best available `LaunchSource` for this Electron session.
 *
 * Returns `{ kind: "attach", ... }` when a running server is detected.
 * Otherwise probes sources in priority order and returns the first match.
 * The `extracted` source always succeeds (last resort).
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
    const pinned = await trySource(opts.preferOverride, opts, probes);
    if (!pinned) throw new PinnedSourceUnavailableError(opts.preferOverride);
    return pinned;
  }

  // 3. Walk the priority chain.
  const chain: SourceKind[] = ["devMonorepo", "piExtension", "npmGlobal", "extracted"];
  for (const kind of chain) {
    const source = await trySource(kind, opts, probes);
    if (source) return source;
  }

  // Should never reach here — extracted always returns a result.
  return buildExtractedSource(opts, probes);
}

async function trySource(
  kind: SourceKind,
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  switch (kind) {
    case "attach":
      return null; // handled separately
    case "devMonorepo":
      return probeDevMonorepo(opts, probes);
    case "piExtension":
      return probePiExtension(opts, probes);
    case "npmGlobal":
      return probeNpmGlobal(opts, probes);
    case "extracted":
      return buildExtractedSource(opts, probes);
  }
}

// ── Spawn primitive ───────────────────────────────────────────────────────────

export interface SpawnResult {
  pid: number;
}

/**
 * Spawn the dashboard server from the given `source`.
 * Stamps `DASHBOARD_STARTER=Electron` in the spawned process env.
 */
export async function spawnFromSource(
  source: Exclude<LaunchSource, { kind: "attach" }>,
  config: { port: number; piPort: number },
  logFd?: number,
): Promise<SpawnResult> {
  // Anchor jiti resolution on the cliPath we are about to spawn. Inside
  // packaged Electron `process.argv[1]` is empty/a flag, so the
  // process-argv-anchored `resolveJitiImport()` always throws. cliPath sits
  // inside a real node_modules tree (managedDir for extracted, repo for
  // devMonorepo, pi's tree for piExtension/npmGlobal) so createRequire
  // walks up correctly to find @mariozechner/jiti or @oh-my-pi/jiti.
  // See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
  const loader =
    resolveJitiFromAnchor(source.cliPath) ?? resolveJitiImport();
  const wrapEntry = shouldUrlWrapEntry(loader);
  const entry = wrapEntry ? toFileUrl(source.cliPath) : source.cliPath;

  const r = await spawnDetached({
    cmd: process.execPath,
    args: [
      "--import",
      loader,
      entry,
      "--port",
      String(config.port),
      "--pi-port",
      String(config.piPort),
    ], // ban:raw-node-import-ok: entry gated by shouldUrlWrapEntry
    env: { ...process.env, DASHBOARD_STARTER: "Electron" },
    cwd: source.cwd,
    logFd,
    detach: false,
  });

  if (!r.ok || !r.process?.pid) {
    throw new Error(
      `Failed to spawn server from source "${source.kind}": ${r.error ?? "unknown error"}`,
    );
  }

  return { pid: r.process.pid };
}
