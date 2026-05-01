/**
 * Server discovery and lifecycle management for Electron.
 * Uses health check → spawn server.
 *
 * NOTE: This module must NOT import from @blackbelt-technology/pi-dashboard-shared
 * or @blackbelt-technology/pi-dashboard-server via dynamic import(). In the packaged
 * Electron app, those packages are inside resources/server/node_modules/ which is NOT
 * on the ESM module resolution path. All config reading and health checking is inlined.
 */
import { spawnDetached, waitForReady } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveJitiFromAnchor } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";
import { toFileUrl, shouldUrlWrapEntry } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readModeFile } from "./wizard-state.js";
import { detectSystemNode, detectPiDashboardCli, detectPi } from "./dependency-detector.js";
import { getBundledNodePath } from "./bundled-node.js";
import { isDashboardRunning } from "./health-check.js";
import type { DashboardStatus } from "./health-check.js";
import { MANAGED_DIR } from "./managed-paths.js";

/**
 * Pure helper: build the options object passed to spawnDetached for the
 * dashboard-server launch. Extracted for unit testing — keeps the `detach:
 * false` invariant asserted in a pure test without booting Electron.
 *
 * detach: false on Windows keeps the child inside Electron's Job Object, so
 * no new console is allocated (no flash) and the server dies when Electron
 * exits.
 */
export function buildServerSpawnOptions(params: {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  logFd: number | undefined;
}): Parameters<typeof spawnDetached>[0] {
  return {
    cmd: params.cmd,
    args: params.args,
    env: params.env,
    cwd: params.cwd,
    logFd: params.logFd,
    detach: false,
  };
}

let serverStartedByUs = false;

/** Expected server version — read from bundled server package.json or Electron package.json. */
function getExpectedVersion(): string | null {
  try {
    // Try bundled server package.json
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      const serverPkg = path.join(resourcesPath, "server", "packages", "server", "package.json");
      if (existsSync(serverPkg)) {
        return JSON.parse(readFileSync(serverPkg, "utf-8")).version ?? null;
      }
    }
    // Dev mode: relative to electron package
    const devPkg = path.resolve(__dirname, "..", "..", "..", "server", "package.json");
    if (existsSync(devPkg)) {
      return JSON.parse(readFileSync(devPkg, "utf-8")).version ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

/** Log a warning if the running server version doesn't match what we expect. */
function checkVersionCompatibility(serverVersion: string | undefined): void {
  const expected = getExpectedVersion();
  if (!expected) return; // Can't determine expected version — skip check
  if (!serverVersion) {
    console.warn(`[pi-dashboard] Server does not report a version (expected ${expected}). It may be outdated.`);
    return;
  }
  if (serverVersion !== expected) {
    console.warn(`[pi-dashboard] Server version ${serverVersion} does not match expected version ${expected}.`);
  }
}

/** Did Electron start the server this session? */
export function didWeStartServer(): boolean {
  return serverStartedByUs;
}

// ── Inlined config reading (replaces @blackbelt-technology/pi-dashboard-shared/config) ──

interface KnownServerEntry {
  host: string;
  port: number;
  label?: string;
}

interface MinimalConfig {
  port: number;
  piPort: number;
  knownServers: KnownServerEntry[];
}

export function loadMinimalConfig(): MinimalConfig {
  const defaults: MinimalConfig = { port: 8000, piPort: 9999, knownServers: [] };
  try {
    const configFile = path.join(os.homedir(), ".pi", "dashboard", "config.json");
    if (!existsSync(configFile)) return defaults;
    const raw = readFileSync(configFile, "utf-8").trim();
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const knownServers: KnownServerEntry[] = Array.isArray(parsed.knownServers)
      ? parsed.knownServers.filter((s: any) => s && typeof s.host === "string" && typeof s.port === "number")
          .map((s: any) => ({ host: s.host, port: s.port, ...(typeof s.label === "string" ? { label: s.label } : {}) }))
      : [];
    return {
      port: typeof parsed.port === "number" ? parsed.port : defaults.port,
      piPort: typeof parsed.piPort === "number" ? parsed.piPort : defaults.piPort,
      knownServers,
    };
  } catch {
    return defaults;
  }
}

// Health check imported from ./health-check.ts

// ── Server discovery and launch ────────────────────────────────────────────────

/**
 * Discover or launch the dashboard server.
 * Returns the URL to connect to.
 */
export async function ensureServer(): Promise<string> {
  const config = loadMinimalConfig();

  // 1. Health check — is the server already running?
  const status = await isDashboardRunning(config.port);
  if (status.running) {
    checkVersionCompatibility(status.version);
    return `http://localhost:${config.port}`;
  }

  if (status.portConflict) {
    throw new Error(`Port ${config.port} is in use by another service. Change the dashboard port in ~/.pi/dashboard/config.json`);
  }

  // 2. Mode-aware server launch
  const mode = readModeFile();
  const isPowerUser = mode?.mode === "power-user";

  if (isPowerUser) {
    // Power-user: prefer pi-dashboard CLI on PATH → managed → bundled
    const cli = detectPiDashboardCli();
    if (cli.found && cli.path) {
      await launchViaCli(cli.path, config.port, config.piPort);
      serverStartedByUs = true;
      return `http://localhost:${config.port}`;
    }
    // Fall through to tsx + cli.ts resolution
  }

  // Standalone (or power-user fallback): bundled → managed → tsx + cli.ts
  await launchServer(config.port, config.piPort);
  serverStartedByUs = true;
  return `http://localhost:${config.port}`;
}

/**
 * Attempt to resolve jiti's register hook from a pi installation.
 * Tries managed pi first, then system pi detected via PATH.
 * Returns a file:// URL to jiti-register.mjs, or null.
 *
 * Anchor-resolution logic is delegated to the shared primitive. This was
 * previously a duplicate of `packages/shared/src/resolve-jiti.ts` — the
 * very drift vector that `fix-windows-server-parity` had to patch in two
 * places. The duplicate is now removed; see change: consolidate-platform-handlers.
 */
export function resolveJitiFromPi(): string | null {
  // 1. Try managed pi install
  const managedPiPkg = path.join(MANAGED_DIR, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
  const jitiFromManaged = resolveJitiFromAnchor(managedPiPkg);
  if (jitiFromManaged) return jitiFromManaged;

  // 2. Try system pi via detectPi() path
  const piResult = detectPi();
  if (piResult.found && piResult.path) {
    try {
      const resolved = realpathSync(piResult.path);
      // pi binary → dist/cli.js or similar — resolve jiti from its package tree
      const jitiFromSystem = resolveJitiFromAnchor(resolved);
      if (jitiFromSystem) return jitiFromSystem;
    } catch { /* ignore */ }
  }

  return null;
}

/** Resolve tsx as [command, ...prefixArgs] to avoid .cmd and shell:true on Windows.
 *  On Unix: returns ["path/to/tsx"]
 *  On Windows: returns ["path/to/node.exe", "path/to/tsx/dist/cli.mjs"]
 *  This avoids spawning .cmd batch files which need shell:true and flash a console window.
 */
function resolveTsxCommand(): string[] | null {
  // Try managed install first
  const managedTsxCli = path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  if (process.platform === "win32" && existsSync(managedTsxCli)) {
    // On Windows, find node.exe and run tsx's entry point directly
    const nodePath = getBundledNodePath() || detectSystemNode().path;
    if (nodePath) return [nodePath, managedTsxCli];
  }

  // Unix or fallback: use the tsx binary directly
  const ext = process.platform === "win32" ? ".cmd" : "";
  const managed = path.join(MANAGED_DIR, "node_modules", ".bin", "tsx" + ext);
  if (existsSync(managed)) return [managed];

  // System PATH
  try {
    const { execSync } = require("node:child_process"); // ban:child_process-ok electron bundle prefers require() for cold-start cost; dev-only tsx probe
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = execSync(`${whichCmd} tsx`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (result) return [result.split("\n")[0]];
  } catch { /* not found */ }

  return null;
}

/** Find the server CLI path. */
function findServerCli(): string | null {
  const candidates = [
    // Bundled with Electron app (resources/server/)
    (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, "server", "packages", "server", "src", "cli.ts")
      : null,
    // Dev mode: relative to electron package
    path.resolve(__dirname, "..", "..", "..", "..", "server", "src", "cli.ts"),
    // Managed install
    path.join(MANAGED_DIR, "node_modules", "@blackbelt-technology", "pi-agent-dashboard", "packages", "server", "src", "cli.ts"),
  ].filter(Boolean) as string[];

  try {
    candidates.push(require.resolve("@blackbelt-technology/pi-dashboard-server/cli.ts"));
  } catch { /* not resolvable */ }

  return candidates.find(p => { try { return existsSync(p); } catch { return false; } }) || null;
}

/**
 * Launch the dashboard server via the pi-dashboard CLI directly.
 * Used in power-user mode when the CLI is on PATH. No tsx resolution needed.
 */
async function launchViaCli(cliPath: string, port: number, piPort: number): Promise<void> {
  const logDir = MANAGED_DIR;
  const logPath = path.join(logDir, "server.log");
  try { mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

  const launchInfo = `[${new Date().toISOString()}] Launching via CLI: ${cliPath} start --port ${port} --pi-port ${piPort}\n`;
  try { writeFileSync(logPath, launchInfo); } catch { /* ignore */ }

  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
  } catch { /* can't write log, use ignore */ }

  // Build env with the CLI's bin directory on PATH so node/tsx are available
  // (GUI apps on macOS don't inherit shell PATH where nvm/volta live)
  const cliBinDir = path.dirname(cliPath);
  const env = { ...process.env };
  env.PATH = `${cliBinDir}${path.delimiter}${env.PATH || ""}`;

  // Route through buildServerSpawnOptions so detach:false invariant is
  // enforced here too (Electron's Windows Job Object hosts the CLI child).
  const r = await spawnDetached(buildServerSpawnOptions({
    cmd: cliPath,
    args: ["start", "--port", String(port), "--pi-port", String(piPort)],
    env,
    cwd: process.cwd(),
    logFd,
  }));
  if (!r.ok) {
    throw new Error(`pi-dashboard CLI failed to spawn: ${r.error}`);
  }

  const ready = await waitForReady({
    probe: async () => (await isDashboardRunning(port)).running,
    deadlineMs: 15_000,
    child: r.process,
  });
  if (ready.ok) return;

  let logContent = "";
  try { logContent = readFileSync(logPath, "utf-8"); } catch { /* ignore */ }
  const lastLines = logContent.split("\n").slice(-20).join("\n");

  // Decorate the error with the resolved candidate path AND a
  // `readlink -f` hint so a slipped-through self-recursion case is
  // recognizable from the error dialog alone (vs. a real CLI bug).
  // See change: fix-electron-appimage-cli-self-detection (D5).
  throw new Error(
    `pi-dashboard CLI failed to start server within 15 seconds (${ready.error}).\n` +
    `Command: ${cliPath} start --port ${port} --pi-port ${piPort}\n` +
    `Resolved CLI path: ${cliPath}\n` +
    `Verify with: readlink -f $(which pi-dashboard) \u2014 it should NOT point at the Electron binary or under $APPDIR\n` +
    (lastLines ? `\nServer log:\n${lastLines}` : "\nNo server log available.")
  );
}

/** Launch the dashboard server as a detached background process. */
async function launchServer(port: number, piPort: number): Promise<void> {
  // Find server CLI first (needed for both tsx and jiti paths)
  const cliPath = findServerCli();
  if (!cliPath) {
    throw new Error("Dashboard server CLI not found. Run the setup wizard or reinstall the app.");
  }

  // Resolve tsx command (avoids .cmd on Windows — no shell needed, no cmd window)
  const tsxCmd = resolveTsxCommand();

  // If tsx not found, try jiti from pi as fallback TS loader
  const jitiPath = !tsxCmd ? resolveJitiFromPi() : null;

  if (!tsxCmd && !jitiPath) {
    throw new Error(
      "No TypeScript loader found (tsx or jiti). " +
      "Install pi (`npm install -g @mariozechner/pi-coding-agent`) or " +
      "run the setup wizard to install dependencies."
    );
  }

  // Resolve Node.js for the PATH
  const systemNode = detectSystemNode();
  const bundledNode = getBundledNodePath();
  const nodeBinDir = bundledNode ? path.dirname(bundledNode) : (systemNode.found ? path.dirname(systemNode.path!) : null);
  const nodePath = bundledNode || (systemNode.found ? systemNode.path! : null);

  // Build environment
  const env = { ...process.env };

  // Resolve pi's bin directory so the server can spawn pi sessions
  // (GUI apps on macOS don't inherit nvm/volta/homebrew paths)
  const piResult = detectPi();
  const piBinDir = piResult.found && piResult.path ? path.dirname(piResult.path) : null;

  // Build spawn command depending on loader
  let spawnBin: string;
  let spawnArgs: string[];

  if (tsxCmd) {
    // tsx path: tsxCmd is [node, tsx-cli.mjs] or [tsx]
    spawnBin = tsxCmd[0];
    spawnArgs = [...tsxCmd.slice(1), cliPath, "--port", String(port), "--pi-port", String(piPort)];
    const tsxBinDir = path.dirname(tsxCmd[0]);
    const extraPath = [piBinDir, nodeBinDir, tsxBinDir].filter(Boolean).join(path.delimiter);
    env.PATH = `${extraPath}${path.delimiter}${env.PATH || ""}`;
  } else {
    // jiti path: spawn node --import <jiti-register.mjs> <cli.ts>
    // Loader is always URL-wrapped (Node needs file:// for --import on Windows
    // drive letters). Entry is URL-wrapped only on Windows + non-tsx loader;
    // on POSIX the entry MUST be raw because jiti's resolver misbehaves on
    // file:// URL entries. See openspec/changes/archive/2026-04-24-fix-windows-entry-script-url.
    if (!nodePath) {
      throw new Error("Node.js not found. Install Node.js >= 20.6 or run the setup wizard.");
    }
    spawnBin = nodePath;
    const wrapEntry = shouldUrlWrapEntry(jitiPath);
    // entry is gated by shouldUrlWrapEntry: true only on Windows + non-tsx.
    // On POSIX the raw path is required — jiti misresolves file:// entries.
    const entry = wrapEntry ? toFileUrl(cliPath) : cliPath;
    spawnArgs = ["--import", toFileUrl(jitiPath!), entry, "--port", String(port), "--pi-port", String(piPort)]; // ban:raw-node-import-ok: entry gated by shouldUrlWrapEntry
    const extraPath = [piBinDir, nodeBinDir].filter(Boolean).join(path.delimiter);
    env.PATH = `${extraPath}${path.delimiter}${env.PATH || ""}`;
  }

  // Ensure NODE_PATH includes bundled server's node_modules
  // cli.ts is at <serverRoot>/packages/server/src/cli.ts — go up 3 levels to the workspace root
  // where node_modules/ and package.json live (created by bundle-server.sh)
  const serverRoot = path.resolve(path.dirname(cliPath), "..", "..", "..");
  const bundledModules = path.join(serverRoot, "node_modules");
  const managedModules = path.join(MANAGED_DIR, "node_modules");
  env.NODE_PATH = [bundledModules, managedModules, env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);

  const cwd = serverRoot;

  // Log server startup for debugging
  const logDir = MANAGED_DIR;
  const logPath = path.join(logDir, "server.log");
  try { mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

  const launchInfo = [
    `[${new Date().toISOString()}] Launching dashboard server`,
    `  command: ${spawnBin} ${spawnArgs.join(" ")}`,
    `  cwd: ${cwd}`,
    `  PATH: ${env.PATH?.split(path.delimiter).slice(0, 3).join(path.delimiter)}...`,
    `  NODE_PATH: ${env.NODE_PATH}`,
    "",
  ].join("\n");
  try { writeFileSync(logPath, launchInfo); } catch { /* ignore */ }

  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
  } catch { /* can't write log, use ignore */ }

  // Launch via spawnDetached primitive — uniform detached/windowsHide/
  // shell:false/stdio:ignore+fd defaults on every platform.
  // Electron manages lifecycle via stopServerIfNeeded().
  //
  // detach: false — keep the child inside Electron's Windows Job Object
  // (no cmd.exe flash on spawn; server dies with Electron). Mirrors the
  // pi-session spawn decision in process-manager.ts::spawnHeadlessDetached.
  const r = await spawnDetached(buildServerSpawnOptions({ cmd: spawnBin, args: spawnArgs, env, cwd, logFd }));
  if (!r.ok) {
    throw new Error(`Server process failed to spawn: ${r.error}`);
  }

  const ready = await waitForReady({
    probe: async () => (await isDashboardRunning(port)).running,
    deadlineMs: 15_000,
    child: r.process,
  });
  if (ready.ok) return;

  let logContent = "";
  try { logContent = readFileSync(logPath, "utf-8"); } catch { /* ignore */ }
  const lastLines = logContent.split("\n").slice(-20).join("\n");

  throw new Error(
    `Server failed to start within 15 seconds (${ready.error}).\n` +
    `Command: ${spawnBin} ${spawnArgs.join(" ")}\n` +
    `CWD: ${cwd}\n` +
    (lastLines ? `\nServer log:\n${lastLines}` : "\nNo server log available.")
  );
}

/** Stop the server if we started it. */
export async function stopServerIfNeeded(): Promise<void> {
  if (!serverStartedByUs) return;
  const config = loadMinimalConfig();
  try {
    await fetch(`http://localhost:${config.port}/api/shutdown`, { method: "POST" });
  } catch { /* already stopped */ }
}
