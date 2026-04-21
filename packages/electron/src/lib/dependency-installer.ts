/**
 * Installs pi, dashboard, openspec, and tsx into the managed location.
 * Uses system npm when available, falls back to bundled npm.
 * All installs run async (child_process.exec) to avoid blocking Electron's main process.
 */
import { exec, spawn as cpSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectSystemNode } from "./dependency-detector.js";
import { getBundledNodePath, getBundledNpmPath } from "./bundled-node.js";
import { MANAGED_DIR } from "./managed-paths.js";
import {
  resolveOfflinePackages,
  extractOfflineCache,
  buildOfflineInstallArgs,
  selectInstallStrategy,
} from "./offline-packages.js";
import { rmSync } from "node:fs";

export interface InstallProgress {
  step: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  /** Last line of npm output (for streaming progress) */
  output?: string;
}

export type ProgressCallback = (progress: InstallProgress) => void;

/** Ensure the managed directory exists with a package.json. */
function ensureManagedDir(): void {
  mkdirSync(MANAGED_DIR, { recursive: true });
  const pkgPath = path.join(MANAGED_DIR, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: "pi-dashboard-managed", private: true, type: "module" }, null, 2));
  }
}

/** Resolve the npm command to use (system or bundled).
 *
 * On Windows, system npm is `npm.cmd` (a batch wrapper). `child_process.spawn("npm", ...)`
 * without the `.cmd` extension fails with ENOENT because Windows doesn't auto-append
 * extensions during spawn. Prefer the bundled Node + npm-cli.js pair unconditionally
 * on Windows — it's a direct `node.exe` invocation with no `.cmd` intermediary — and
 * fall back to bundled even when system Node is present to avoid the spawn-npm-ENOENT
 * failure observed on fresh Windows installs.
 */
function resolveNpm(): string {
  // Bundled first on Windows (avoids .cmd spawn issue).
  const nodePath = getBundledNodePath();
  const npmPath = getBundledNpmPath();
  if (process.platform === "win32" && nodePath && npmPath) {
    return `"${nodePath}" "${npmPath}"`;
  }
  // System npm on Unix (posix has no extension issue).
  const systemNode = detectSystemNode();
  if (systemNode.found) {
    return "npm";
  }
  // Fallback: bundled even on non-Windows.
  if (nodePath && npmPath) {
    return `"${nodePath}" "${npmPath}"`;
  }
  throw new Error("No Node.js available. Cannot install dependencies.");
}

/** Build env with bundled Node on PATH so postinstall scripts can find `node`. */
function buildInstallEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const nodePath = getBundledNodePath();
  if (nodePath) {
    const binDir = path.dirname(nodePath);
    env.PATH = `${binDir}${path.delimiter}${env.PATH || ""}`;
  }
  return env;
}

/** Run npm install asynchronously with streaming output. */
function runNpmInstall(
  packages: string[],
  cwd: string,
  npmCmd: string,
  onOutput?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = buildInstallEnv();
    // Parse npmCmd into command + args (handles "node" "npm-cli.js" form)
    const parts = npmCmd.match(/"[^"]+"|\S+/g)?.map(s => s.replace(/^"|"$/g, "")) || [npmCmd];
    const cmd = parts[0];
    const args = [...parts.slice(1), "install", ...packages];

    const child = cpSpawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stderr = "";

    const handleData = (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Forward last meaningful line to UI
      const lines = text.split("\n").filter(l => l.trim());
      const last = lines[lines.length - 1];
      if (last && onOutput) {
        onOutput(last.trim().substring(0, 120));
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (err) => reject(new Error(err.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-500) || `npm install exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Standalone mode: install all tools into ~/.pi-dashboard/.
 *
 * When an offline package bundle is present under
 * `<resourcesPath>/offline-packages/`, the install runs entirely from
 * that bundled cacache (no network). On any offline-path failure, the
 * cache is preserved for debugging and the error is surfaced — we do
 * NOT silently fall back to the registry (contract: deterministic
 * offline install).
 *
 * When the bundle is absent (dev builds, opt-in flag off in CI), the
 * old per-package registry loop runs unchanged.
 */
export async function installStandalone(onProgress?: ProgressCallback, skipPackages?: string[]): Promise<void> {
  ensureManagedDir();
  const npmCmd = resolveNpm();

  // Note: @blackbelt-technology/pi-dashboard is bundled with the Electron app
  // (server CLI in extraResources), so it's not installed via npm.
  const packages = [
    "@mariozechner/pi-coding-agent",
    "@fission-ai/openspec",
    "tsx",
  ];

  const skipSet = new Set(skipPackages || []);

  // Offline fast path: if the bundle is present AND skipSet doesn't already
  // cover everything, extract the cacache and run ONE cache-offline npm
  // install for the outstanding packages.
  const outstanding = packages.filter(p => !skipSet.has(p));
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const resolution = resourcesPath
    ? resolveOfflinePackages(resourcesPath)
    : { present: false as const, reason: "no resourcesPath" };
  const strategy = selectInstallStrategy({ outstandingPackages: outstanding, resolution });

  if (strategy.kind === "offline" && resolution.present) {
    await runOfflineInstall({
      resolution,
      outstanding,
      pinMap: strategy.pinMap,
      npmCmd,
      onProgress,
    });
    // Mark skipped-already entries for wizard UI completeness
    for (const pkg of packages.filter(p => skipSet.has(p))) {
      const step = pkg.split("/").pop() || pkg;
      onProgress?.({ step, status: "done", output: "Already installed (system)" });
    }
    return;
  }

  if (strategy.kind === "offline-incomplete") {
    onProgress?.({
      step: "offline-cache",
      status: "error",
      error: `Bundled cache is missing pins for: ${strategy.missing.join(", ")} — using registry`,
    });
  }

  // Registry fallback (no bundle, or bundle incomplete).
  for (const pkg of packages) {
    const step = pkg.split("/").pop() || pkg;

    // Skip packages already installed on the system
    if (skipSet.has(pkg)) {
      onProgress?.({ step, status: "done", output: "Already installed (system)" });
      continue;
    }

    onProgress?.({ step, status: "running" });
    try {
      await runNpmInstall([pkg], MANAGED_DIR, npmCmd, (output) => {
        onProgress?.({ step, status: "running", output });
      });
      onProgress?.({ step, status: "done" });
    } catch (err: any) {
      onProgress?.({ step, status: "error", error: err.message });
      throw err;
    }
  }
}

/**
 * Run the bundled-cacache install path. Three discrete progress steps:
 *   1. "offline-cache" — extract + verify SHA-256
 *   2. "<pkg>" — one npm install --offline for all outstanding packages
 *   3. "offline-cache" (cleanup) — rm .offline-cache on success
 *
 * On failure, the cache is PRESERVED (for debugging) and the error is
 * re-thrown so the wizard surfaces it. Registry fallback is not taken.
 */
async function runOfflineInstall(params: {
  resolution: Extract<ReturnType<typeof resolveOfflinePackages>, { present: true }>;
  outstanding: string[];
  pinMap: Map<string, string>;
  npmCmd: string;
  onProgress?: ProgressCallback;
}): Promise<void> {
  const { resolution, outstanding, pinMap, npmCmd, onProgress } = params;

  // Step 1: extract + verify
  onProgress?.({ step: "offline-cache", status: "running", output: "Preparing offline cache" });
  let cacacheDir: string;
  try {
    cacacheDir = await extractOfflineCache({
      tarballPath: resolution.tarballPath,
      expectedSha256: resolution.manifest.sha256,
      managedDir: MANAGED_DIR,
    });
  } catch (err: any) {
    onProgress?.({ step: "offline-cache", status: "error", error: err.message });
    throw err;
  }
  onProgress?.({ step: "offline-cache", status: "done", output: "Cache ready" });

  // Step 2: one `npm install --offline <p@v>...`
  const pkgsWithVersions = outstanding.map(name => ({
    name,
    version: pinMap.get(name)!,
  }));
  const humanLabel = pkgsWithVersions.map(p => p.name.split("/").pop()).join(", ");
  onProgress?.({ step: "offline-install", status: "running", output: `Installing ${humanLabel}` });

  const args = buildOfflineInstallArgs({
    managedDir: MANAGED_DIR,
    cacheDir: path.dirname(cacacheDir), // parent of _cacache is what npm expects for --cache
    packages: pkgsWithVersions,
  });
  try {
    // Drop the leading "install" from args because runNpmInstall prepends it.
    const [, ...restArgs] = args;
    // runNpmInstall expects `packages` to append — but we pass full flag-laden args.
    // Easiest: call npm directly via the same spawn primitive.
    await runNpmWithArgv(restArgs, npmCmd, (output) => {
      onProgress?.({ step: "offline-install", status: "running", output });
    });
  } catch (err: any) {
    onProgress?.({ step: "offline-install", status: "error", error: err.message });
    // PRESERVE .offline-cache/ on failure for debugging.
    throw err;
  }
  onProgress?.({ step: "offline-install", status: "done", output: `Installed ${humanLabel}` });

  // Step 3: cleanup (reclaim ~140 MB)
  onProgress?.({ step: "offline-cache", status: "running", output: "Cleaning up" });
  try {
    rmSync(path.join(MANAGED_DIR, ".offline-cache"), { recursive: true, force: true });
    onProgress?.({ step: "offline-cache", status: "done", output: "Cleaned" });
  } catch (err: any) {
    // Non-fatal: install succeeded, cleanup failed. Just warn.
    onProgress?.({ step: "offline-cache", status: "done", output: `Cleanup warning: ${err.message}` });
  }
}

/** Internal: run npm with a full pre-built argv list (not `install <pkgs>`). */
function runNpmWithArgv(
  argv: string[],
  npmCmd: string,
  onOutput?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = buildInstallEnv();
    const parts = npmCmd.match(/"[^"]+"|\S+/g)?.map(s => s.replace(/^"|"$/g, "")) || [npmCmd];
    const cmd = parts[0];
    const args = [...parts.slice(1), "install", ...argv];
    const child = cpSpawn(cmd, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    let stderr = "";
    const handleData = (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      const lines = text.split("\n").filter(l => l.trim());
      const last = lines[lines.length - 1];
      if (last && onOutput) onOutput(last.trim().substring(0, 120));
    };
    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);
    child.on("error", (err) => reject(new Error(err.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-500) || `npm install exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Power user mode: install the dashboard package globally.
 */
export async function installDashboardGlobal(onProgress?: ProgressCallback): Promise<void> {
  onProgress?.({ step: "pi-dashboard", status: "running" });
  try {
    await runNpmInstall(["@blackbelt-technology/pi-agent-dashboard"], process.cwd(), "npm install -g");
    onProgress?.({ step: "pi-dashboard", status: "done" });
  } catch (err: any) {
    onProgress?.({ step: "pi-dashboard", status: "error", error: err.message });
    throw err;
  }
}

// ── Recommended extensions installer ───────────────────────────

// Lazy-imported to keep the startup path light. Delegates to the shared
// ToolRegistry so we use the same ordered strategy chain (override ->
// bare-import -> managed -> npm-global) the server uses.
// See change: consolidate-tool-resolution.
async function loadPiPackageManager() {
  const { getDefaultRegistry } = await import(
    "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js"
  );
  const registry = getDefaultRegistry();
  const { module } = await registry.resolveModule<{
    DefaultPackageManager: any;
    SettingsManager: any;
  }>("pi-coding-agent");
  return module;
}

/**
 * Install a list of recommended extensions sequentially via pi's
 * DefaultPackageManager. Each entry is identified by its manifest `id`;
 * the source is resolved from `@blackbelt-technology/pi-dashboard-shared`'s
 * `RECOMMENDED_EXTENSIONS`. Stops on first failure and reports the error
 * through `onProgress` in the standard `InstallProgress` shape.
 *
 * @returns the number of entries successfully installed.
 */
export async function installRecommendedExtensions(
  ids: string[],
  onProgress?: ProgressCallback,
  skipPackages?: ReadonlySet<string>,
): Promise<number> {
  if (ids.length === 0) return 0;

  const { RECOMMENDED_EXTENSIONS } = await import(
    "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js"
  );

  const pm = await loadPiPackageManager();
  if (!pm?.DefaultPackageManager || !pm?.SettingsManager) {
    throw new Error(
      "pi-coding-agent is not installed. Install recommended extensions failed.",
    );
  }

  const agentDir = path.join(os.homedir(), ".pi", "agent");
  const cwd = os.homedir();
  const settingsManager = pm.SettingsManager.create(cwd, agentDir);
  const manager = new pm.DefaultPackageManager({ cwd, agentDir, settingsManager });

  let installed = 0;
  for (const id of ids) {
    const entry = RECOMMENDED_EXTENSIONS.find((e: any) => e.id === id);
    if (!entry) {
      onProgress?.({
        step: id,
        status: "error",
        error: `Unknown recommended id: ${id}`,
      });
      throw new Error(`Unknown recommended id: ${id}`);
    }

    const step = entry.displayName;

    // Bundle activation from earlier step satisfies this id.
    if (skipPackages?.has(id)) {
      onProgress?.({ step, status: "done", output: "Already installed (bundled)" });
      installed++;
      continue;
    }

    onProgress?.({ step, status: "running" });
    try {
      manager.setProgressCallback?.((event: any) => {
        if (event?.message) {
          onProgress?.({ step, status: "running", output: String(event.message).slice(0, 120) });
        }
      });
      await manager.installAndPersist(entry.source, { local: false });
      onProgress?.({ step, status: "done" });
      installed++;
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "install failed");
      onProgress?.({ step, status: "error", error: msg });
      throw err;
    }
  }

  return installed;
}

// ── Bundled extensions installer ───────────────────────────────

/**
 * Minimal git URL parser that mirrors the subset of pi's `parseGitUrl`
 * we need to compute pi's on-disk git cache path
 * (`<agentDir>/git/<host>/<user>/<repo>`) from the `source` declared in
 * `RECOMMENDED_EXTENSIONS`.
 *
 * Exported for unit testing. Accepts:
 *   - `https://github.com/user/repo.git`
 *   - `http://...`
 *   - `ssh://git@host/user/repo.git`
 *   - `git@host:user/repo.git`
 *   - `git:github:user/repo` (with explicit prefix; delegated to the
 *      minimal shorthand branch)
 *
 * Returns `null` if the URL isn't a recognizable git form.
 */
export function parseBundledGitSource(source: string): { host: string; path: string } | null {
  const trimmed = source.trim().replace(/^git:/, "");
  // SCP-like form: git@host:user/repo(.git)
  const scp = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
  if (scp) {
    return { host: scp[1]!, path: stripRef(scp[2]!).replace(/\.git$/, "") };
  }
  // Explicit protocol URL.
  if (/^(https?|ssh|git):\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const rawPath = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      const withoutGit = rawPath.replace(/\.git$/, "");
      const noRef = stripRef(withoutGit);
      if (!u.hostname || !noRef) return null;
      // host for ssh://git@github.com/... is just github.com (URL strips userinfo from hostname)
      return { host: u.hostname, path: noRef };
    } catch {
      return null;
    }
  }
  return null;
}

/** Strip a `@ref` suffix from a git path (e.g. `user/repo@branch` → `user/repo`). */
function stripRef(pathPart: string): string {
  const idx = pathPart.indexOf("@");
  return idx < 0 ? pathPart : pathPart.slice(0, idx);
}

/** Return the directory holding bundled extension source trees, or null in dev builds. */
function getBundledExtensionsDir(): string | null {
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  const dir = path.join(resourcesPath, "bundled-extensions");
  return existsSync(dir) ? dir : null;
}

/**
 * Activate pre-bundled first-party pi extensions from the Electron
 * installer. Runs before `installRecommendedExtensions` so its return
 * value seeds that call's `skipPackages`.
 *
 * Strategy (per task 1 spike):
 *   1. For each id in `BUNDLED_EXTENSION_IDS` that has a matching
 *      subdirectory in `<resourcesPath>/bundled-extensions/` AND is in
 *      `RECOMMENDED_EXTENSIONS`:
 *      a. If `manager.getInstalledPath(source, "user")` already points
 *         to a real directory → skip (existing install wins), report
 *         `output: "Already installed"`.
 *      b. Otherwise copy the bundled tree into pi's git cache
 *         (`<agentDir>/git/<host>/<path>/`), run `npm install --omit=dev`
 *         if the package.json declares runtime `dependencies`, call
 *         `manager.addSourceToSettings(source, { local: false })`, and
 *         flush settings.
 *   2. Return the set of ids that were successfully activated (covers
 *      both "freshly copied" and "already installed" outcomes) so
 *      `installRecommendedExtensions` can skip them.
 *
 * A failure on one id is logged via `onProgress` but does NOT abort the
 * loop — other bundled ids and the subsequent dynamic install still run.
 */
export async function installBundledExtensions(
  onProgress?: ProgressCallback,
): Promise<string[]> {
  const bundledDir = getBundledExtensionsDir();
  if (!bundledDir) return [];

  const { BUNDLED_EXTENSION_IDS, RECOMMENDED_EXTENSIONS } = await import(
    "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js"
  );

  const presentOnDisk = new Set(
    readdirSync(bundledDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  );

  const pm = await loadPiPackageManager();
  if (!pm?.DefaultPackageManager || !pm?.SettingsManager) {
    // Pi not installed yet — the earlier install step is responsible
    // for that. Bundled activation will be retried on next launch.
    return [];
  }

  const agentDir = path.join(os.homedir(), ".pi", "agent");
  const cwd = os.homedir();
  const settingsManager = pm.SettingsManager.create(cwd, agentDir);
  const manager = new pm.DefaultPackageManager({ cwd, agentDir, settingsManager });

  const activated: string[] = [];
  for (const id of BUNDLED_EXTENSION_IDS) {
    if (!presentOnDisk.has(id)) continue;
    const entry = RECOMMENDED_EXTENSIONS.find((e: any) => e.id === id);
    if (!entry) continue; // manifest drift; test should have caught this

    const step = entry.displayName;
    const bundledSrc = path.join(bundledDir, id);
    try {
      // Skip-if-present: existing user install (CLI or prior launch) wins.
      const existingPath = manager.getInstalledPath?.(entry.source, "user");
      if (existingPath && existsSync(existingPath)) {
        onProgress?.({ step, status: "done", output: "Already installed" });
        activated.push(id);
        continue;
      }

      // Compute pi's git cache path for this source.
      const parsed = parseBundledGitSource(entry.source);
      if (!parsed) {
        onProgress?.({
          step,
          status: "error",
          error: `Cannot parse git source: ${entry.source}`,
        });
        continue;
      }
      const targetDir = path.join(agentDir, "git", parsed.host, parsed.path);

      onProgress?.({ step, status: "running", output: "Copying bundled files…" });
      mkdirSync(path.dirname(targetDir), { recursive: true });
      cpSync(bundledSrc, targetDir, { recursive: true });

      // Run npm install --omit=dev only if runtime deps are declared.
      const pkgJsonPath = path.join(targetDir, "package.json");
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
          const hasDeps = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
          if (hasDeps) {
            onProgress?.({ step, status: "running", output: "Installing runtime dependencies…" });
            const npmCmd = resolveNpm();
            await runNpmInstall(["--omit=dev"], targetDir, npmCmd, (output) => {
              onProgress?.({ step, status: "running", output });
            });
          }
        } catch (err: any) {
          // Non-fatal: extension source is in place; pi may still load it.
          onProgress?.({
            step,
            status: "running",
            output: `npm install skipped: ${String(err?.message ?? err).slice(0, 80)}`,
          });
        }
      }

      // Persist the git URL in settings so pi's update() can later re-resolve.
      manager.addSourceToSettings(entry.source, { local: false });
      await settingsManager.flush?.();

      onProgress?.({ step, status: "done", output: "Bundled" });
      activated.push(id);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "bundled activation failed");
      onProgress?.({ step, status: "error", error: msg });
      // Continue with the rest — this id falls back to the dynamic install path.
    }
  }

  return activated;
}
