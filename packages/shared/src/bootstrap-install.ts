/**
 * Shared bootstrap installer — single entry point for installing pi,
 * openspec, tsx, and recommended packages into the managed directory
 * (~/.pi-dashboard/). Callable from any entry point: Electron wizard,
 * `pi-dashboard` CLI first-run, `pi-dashboard upgrade-pi` subcommand,
 * and the `POST /api/bootstrap/upgrade-pi` REST handler.
 *
 * This module is deliberately free of Electron-specific concerns
 * (bundled-node, offline-bundle cacache, resourcesPath). Those remain
 * in `packages/electron/src/lib/dependency-installer.ts` which now
 * delegates its "install from npm registry" step to this function.
 *
 * See change: unified-bootstrap-install.
 */
import { spawn as cpSpawn, spawnSync as cpSpawnSync } from "./platform/exec.js";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getManagedDir } from "./managed-paths.js";
import { getDefaultRegistry, type ToolRegistry } from "./tool-registry/index.js";

/**
 * Per-package progress tick. Mirrors the Electron `InstallProgress`
 * shape so existing wizard UI code needs no changes.
 */
export interface InstallProgress {
  step: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  /** Last line of npm output (for streaming progress). */
  output?: string;
}

export type ProgressCallback = (progress: InstallProgress) => void;

export interface BootstrapInstallOptions {
  /** Packages to install via `npm install <pkg>` (registry fetch). */
  packages: string[];
  /** Root of the managed install. Defaults to `getManagedDir()`. */
  managedDir?: string;
  /** Called on every progress tick (pending/running/done/error). */
  progress?: ProgressCallback;
  /**
   * Optional override of the npm invocation. By default the function
   * resolves the `npm` tool via `ToolRegistry.resolve("npm")` and
   * falls back to the plain `npm` / `npm.cmd` binary on PATH. When
   * Electron wants to steer the install to bundled Node + npm-cli.js,
   * it passes the full argv prefix (e.g. `["<path>/node", "<path>/npm-cli.js"]`).
   */
  npmArgv?: string[];
  /**
   * Optional environment overrides merged into the child process env.
   * Electron uses this to put bundled Node on PATH for postinstall
   * scripts.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Inject a tool registry (tests). Defaults to `getDefaultRegistry()`.
   */
  registry?: ToolRegistry;
}

export interface BootstrapInstallSuccess {
  ok: true;
  installed: string[];
  managedDir: string;
}

export interface BootstrapInstallFailure {
  ok: false;
  error: string;
  installed: string[];
  managedDir: string;
}

export type BootstrapInstallResult = BootstrapInstallSuccess | BootstrapInstallFailure;

/** Ensure the managed directory exists with a package.json. */
export function ensureManagedDir(managedDir: string): void {
  mkdirSync(managedDir, { recursive: true });
  const pkgPath = path.join(managedDir, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      JSON.stringify({ name: "pi-dashboard-managed", private: true, type: "module" }, null, 2),
    );
  }
}

/**
 * Resolve the npm invocation used for bootstrap installs.
 *
 * Order:
 *   1. Explicit `npmArgv` override (Electron bundled-node case).
 *   2. `ToolRegistry.resolve("npm")`.
 *   3. Plain `npm` (Unix) or `npm.cmd` (Windows) on PATH.
 *
 * Returns the argv list that will have `install <packages...>` appended.
 */
export function resolveNpmArgv(
  opts: Pick<BootstrapInstallOptions, "npmArgv" | "registry">,
): string[] {
  if (opts.npmArgv && opts.npmArgv.length > 0) return [...opts.npmArgv];

  const registry = opts.registry ?? getDefaultRegistry();
  if (registry.has("npm")) {
    const res = registry.resolve("npm");
    if (res.ok && res.path) return [res.path];
  }

  // Last resort: rely on PATH. On Windows the .cmd shim is required
  // because spawn doesn't auto-append extensions.
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"; // platform-branch-ok
  return [npmBin];
}

/** Internal: spawn npm with a given argv + packages; stream progress. */
function runNpmOnce(
  argvBase: string[],
  packages: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onOutput?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...baseArgs] = argvBase;
    if (!cmd) {
      reject(new Error("resolveNpmArgv returned an empty argv"));
      return;
    }
    const args = [...baseArgs, "install", ...packages];

    // Windows + `.cmd`/`.bat` shim requires `shell: true`. Since
    // CVE-2024-27980 (Node ≥ 18.20 / 20.12.1 / 22.0), spawning a
    // batch shim with `shell: false` fails with EFTYPE — verified
    // live on Windows 11 + Node 22.18.0 bootstrapping pi via
    // `npm.cmd`. Native `.exe` and PATH-resolved `npm` (Unix) keep
    // the existing direct-spawn path. See change:
    // fix-windows-standalone-spawn.
    const isBatchShim = /\.(cmd|bat)$/i.test(cmd);
    const child = cpSpawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
      ...(isBatchShim ? { shell: true, windowsHide: true } : {}),
    });

    let tail = "";

    const handleData = (data: Buffer): void => {
      const text = data.toString();
      tail += text;
      if (tail.length > 4096) tail = tail.slice(-4096);
      const lines = text.split("\n").filter((l) => l.trim());
      const last = lines[lines.length - 1];
      if (last && onOutput) onOutput(last.trim().substring(0, 120));
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (err) => reject(new Error(err.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(tail.slice(-500) || `npm install exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Install the given packages into the managed directory.
 *
 * Per-package progress is reported via `progress`. Installation is
 * sequential (not concurrent) so a failure stops the chain — matching
 * the behavior of the Electron wizard today. The return value reports
 * which packages completed successfully before any failure.
 */
export async function bootstrapInstall(
  opts: BootstrapInstallOptions,
): Promise<BootstrapInstallResult> {
  const managedDir = opts.managedDir ?? getManagedDir();
  ensureManagedDir(managedDir);

  const argvBase = resolveNpmArgv(opts);
  const env = { ...process.env, ...(opts.env ?? {}) };

  const installed: string[] = [];
  for (const pkg of opts.packages) {
    const step = pkg.split("/").pop() || pkg;
    opts.progress?.({ step, status: "running" });
    try {
      await runNpmOnce(argvBase, [pkg], managedDir, env, (output) => {
        opts.progress?.({ step, status: "running", output });
      });
      opts.progress?.({ step, status: "done" });
      installed.push(pkg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.progress?.({ step, status: "error", error: message });
      return { ok: false, error: message, installed, managedDir };
    }
  }

  return { ok: true, installed, managedDir };
}

/**
 * Convenience wrapper: install pi, openspec, tsx into the default
 * managed directory. Used by the CLI degraded-mode first-run path.
 */
export async function bootstrapInstallDefaults(
  progress?: ProgressCallback,
): Promise<BootstrapInstallResult> {
  return bootstrapInstall({
    packages: ["@earendil-works/pi-coding-agent", "@fission-ai/openspec"],
    progress,
  });
}

// ── Managed Node runtime install ───────────────────────────────────────
//
// See change: embed-managed-node-runtime (spec: managed-node-runtime).
//
// `installManagedNode` copies a bundled Node distribution into
// `<managedDir>/node/` and writes a `<managedDir>/node/.version` marker.
// Idempotent: skip when marker matches the bundled version, replace on
// mismatch, no-op when the bundled source isn't available (standalone
// CLI install with no Electron resources).

export interface InstallManagedNodeOptions {
  /**
   * Source directory containing the bundled Node distribution.
   * Layout matches the upstream Node zip/tar:
   *   Windows: `<dir>/node.exe`, `<dir>/npm.cmd`, `<dir>/npx.cmd`
   *   Unix:    `<dir>/bin/node`, `<dir>/bin/npm`, `<dir>/bin/npx`
   *
   * Caller resolves this (Electron uses `path.dirname(getBundledNodePath())`
   * after stripping the platform-specific suffix). Pass `null` /
   * `undefined` for the standalone CLI install case — the function
   * no-ops without error.
   */
  bundledNodeDir?: string | null;
  /** Root of the managed install. Defaults to `getManagedDir()`. */
  managedDir?: string;
  /** Called on every progress tick. Mirrors `bootstrapInstall` shape. */
  progress?: ProgressCallback;
  /**
   * Test seam: override how the bundled Node version is read. Default
   * spawns `<bundledNodeDir>/bin/node --version` (or `node.exe` on
   * Windows) and trims stdout. Tests inject a fake to avoid real spawns.
   */
  _readVersion?: (sourceBinary: string) => string | null;
}

export interface InstallManagedNodeResult {
  /** True iff the operation succeeded (including the no-op cases). */
  ok: boolean;
  /** Did we actually copy files? false when no-op or skipped. */
  copied: boolean;
  /** Resolved managed Node directory (`<managedDir>/node`). */
  managedNodeDir: string;
  /** Bundled Node version (e.g. `v22.12.0`) when known. */
  version?: string;
  /** Reason for skip / failure. Always set when `copied === false`. */
  reason?: string;
  /** Error message when `ok === false`. */
  error?: string;
}

/** Path to the source `node` / `node.exe` binary inside `bundledNodeDir`. */
function sourceNodeBinary(bundledNodeDir: string): string {
  return process.platform === "win32" // platform-branch-ok: Node distribution layout differs Windows vs Unix
    ? path.join(bundledNodeDir, "node.exe")
    : path.join(bundledNodeDir, "bin", "node");
}

/**
 * Spawn `<nodeBinary> --version` and return the trimmed stdout (e.g.
 * `v22.12.0`). Returns null on failure or when the binary is missing.
 * Synchronous because bootstrap is naturally serial.
 */
function readNodeVersion(nodeBinary: string): string | null {
  if (!existsSync(nodeBinary)) return null;
  try {
    const r = cpSpawnSync(nodeBinary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      encoding: "utf-8",
    });
    if (r.status !== 0) return null;
    const out = (r.stdout ?? "").toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Read the `<managedNodeDir>/.version` marker if present, else null. */
function readManagedMarker(managedNodeDir: string): string | null {
  const markerPath = path.join(managedNodeDir, ".version");
  if (!existsSync(markerPath)) return null;
  try {
    return readFileSync(markerPath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Idempotently copy the bundled Node distribution into `<managedDir>/node/`.
 *
 * - First-run: full recursive copy + write `.version` marker.
 * - Re-run with matching marker: no-op.
 * - Mismatched marker (or missing marker with dir present): replace +
 *   rewrite marker.
 * - Bundled source absent or `bundledNodeDir == null`: no-op.
 * - Failed copy mid-flight: marker NOT written, so next call retries.
 */
export async function installManagedNode(
  opts: InstallManagedNodeOptions = {},
): Promise<InstallManagedNodeResult> {
  const managedDir = opts.managedDir ?? getManagedDir();
  const managedNodeDir = path.join(managedDir, "node");
  const step = "node-runtime";

  const bundledDir = opts.bundledNodeDir ?? null;
  if (!bundledDir) {
    return {
      ok: true,
      copied: false,
      managedNodeDir,
      reason: "no bundled source",
    };
  }

  const sourceBinary = sourceNodeBinary(bundledDir);
  const sourceVersion = (opts._readVersion ?? readNodeVersion)(sourceBinary);
  if (!sourceVersion) {
    return {
      ok: true,
      copied: false,
      managedNodeDir,
      reason: `bundled node binary missing or unreadable: ${sourceBinary}`,
    };
  }

  const existingMarker = readManagedMarker(managedNodeDir);
  if (existingMarker === sourceVersion) {
    return {
      ok: true,
      copied: false,
      managedNodeDir,
      version: sourceVersion,
      reason: "version matches bundled — no copy needed",
    };
  }

  opts.progress?.({
    step,
    status: "running",
    output: `Installing Node ${sourceVersion} runtime`,
  });

  try {
    // Replace any existing dir (handles the mismatch + missing-marker
    // cases) so the copy is from a clean slate.
    if (existsSync(managedNodeDir)) {
      rmSync(managedNodeDir, { recursive: true, force: true });
    }
    mkdirSync(path.dirname(managedNodeDir), { recursive: true });

    cpSync(bundledDir, managedNodeDir, {
      recursive: true,
      force: true,
      // dereference: false keeps symlinks-as-symlinks (Unix npm shim).
      // verbatimSymlinks would also work in newer Node; default is fine.
    });

    // Marker last — partial copy on failure leaves no marker, so the
    // next invocation treats the dir as missing and retries.
    writeFileSync(
      path.join(managedNodeDir, ".version"),
      sourceVersion + "\n",
      "utf-8",
    );

    opts.progress?.({ step, status: "done", output: `Node ${sourceVersion}` });
    return {
      ok: true,
      copied: true,
      managedNodeDir,
      version: sourceVersion,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.progress?.({ step, status: "error", error: message });
    return {
      ok: false,
      copied: false,
      managedNodeDir,
      version: sourceVersion,
      error: message,
    };
  }
}
