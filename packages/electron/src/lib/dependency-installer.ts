/**
 * Installs pi, dashboard, openspec, and tsx into the managed location.
 * Uses system npm when available, falls back to bundled npm.
 * All installs run async (child_process.exec) to avoid blocking Electron's main process.
 */
import { exec, spawn as cpSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectSystemNode } from "./dependency-detector.js";
import { getBundledNodePath, getBundledNpmPath } from "./bundled-node.js";
import { MANAGED_DIR } from "./managed-paths.js";

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

/** Resolve the npm command to use (system or bundled). */
function resolveNpm(): string {
  const systemNode = detectSystemNode();
  if (systemNode.found) {
    return "npm";
  }
  // Use bundled Node + npm
  const nodePath = getBundledNodePath();
  const npmPath = getBundledNpmPath();
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
