/**
 * Zrok tunnel integration via `zrok share public` subprocess.
 * Spawns zrok as a long-lived child process that actually proxies traffic.
 * Supports both zrok v1 (~/.zrok) and v2 (~/.zrok2) environments.
 * Uses reserved shares for persistent URLs across restarts.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawn, type ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import {
  isProcessAlive,
  killProcess,
  killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const zrokResolver = new ToolResolver({ processExecPath: process.execPath });
import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { CONFIG_FILE } from "@blackbelt-technology/pi-dashboard-shared/config.js";

export type { TunnelStatus };

export interface ZrokEnv {
  apiEndpoint: string;
  envZId: string;
  token: string;
}

function getZrokPidPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "zrok.pid");
}
const SPAWN_TIMEOUT_MS = 30_000;

let activeProcess: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let zrokAvailable: boolean | null = null;
// Serialization: any concurrent createTunnel() call while one is already in
// flight returns the same promise instead of spawning a second zrok process.
// Without this, a UI double-click or a race between startup auto-connect and
// an explicit `/api/tunnel-connect` created two parallel reservations and
// two running `zrok share` processes for the same port.
let pendingCreate: Promise<string | null> | null = null;

// ── Binary Detection ────────────────────────────────────────────────

function checkZrokOnPath(): boolean {
  // Delegate binary lookup to the shared platform primitive (handles the
  // where/which split on Windows vs Unix, managed-bin search, and login
  // shell fallback). See change: consolidate-platform-handlers.
  return zrokResolver.which("zrok") !== null;
}

/**
 * Detect whether the `zrok` binary is available on PATH.
 * Caches the result after first call.
 */
export function detectZrokBinary(): boolean {
  if (zrokAvailable !== null) return zrokAvailable;
  zrokAvailable = checkZrokOnPath();
  return zrokAvailable;
}

/** Reset the cached binary detection result (for testing). */
export function _resetBinaryCache(): void {
  zrokAvailable = null;
}

/** Override the cached binary availability (for testing). */
export function _setBinaryAvailable(available: boolean): void {
  zrokAvailable = available;
}

// ── PID File Helpers ────────────────────────────────────────────────

export function writeZrokPid(pid: number): void {
  fs.mkdirSync(path.dirname(getZrokPidPath()), { recursive: true });
  fs.writeFileSync(getZrokPidPath(), String(pid) + "\n");
}

export function readZrokPid(): number | null {
  try {
    const content = fs.readFileSync(getZrokPidPath(), "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function removeZrokPid(): void {
  try {
    fs.unlinkSync(getZrokPidPath());
  } catch {
    // File may not exist — fine
  }
}

// ── Stale Process Cleanup ───────────────────────────────────────────

/**
 * Clean up stale zrok processes from previous server runs.
 * Reads PID file, kills process if running (via the platform helper so
 * Windows uses `taskkill /F /T /PID`), removes PID file.
 * See change: route-kill-paths-through-platform.
 */
export async function cleanupStaleZrok(): Promise<void> {
  const pid = readZrokPid();
  if (pid === null) return;

  if (isProcessAlive(pid)) {
    try {
      const result = await killProcess(pid, { timeoutMs: 2000 });
      if (result.ok) {
        console.log(`Killed stale zrok process (PID ${pid})`);
      }
    } catch (err: any) {
      console.warn(`Failed to kill stale zrok process (PID ${pid}): ${err.message}`);
    }
  }
  removeZrokPid();
}

// ── Zrok Environment ────────────────────────────────────────────────

/**
 * Load zrok environment from ~/.zrok2/environment.json or ~/.zrok/environment.json.
 * Checks v2 path first, falls back to v1.
 */
export function loadZrokEnv(): ZrokEnv | null {
  try {
    const v2 = path.join(os.homedir(), ".zrok2", "environment.json");
    const v1 = path.join(os.homedir(), ".zrok", "environment.json");
    const envFile = fs.existsSync(v2) ? v2 : v1;
    if (!fs.existsSync(envFile)) return null;

    const data = JSON.parse(fs.readFileSync(envFile, "utf-8"));
    const apiEndpoint = data.api_endpoint;
    const envZId = data.ziti_identity;
    const token = data.zrok_token;

    if (!apiEndpoint || !envZId || !token) return null;
    return { apiEndpoint, envZId, token };
  } catch {
    return null;
  }
}

// ── Reserved Share ───────────────────────────────────────────────────

/**
 * Save the reserved token to config.json so it persists across restarts.
 */
function saveReservedToken(token: string): void {
  try {
    const raw = fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
      : {};
    raw.tunnel = { ...raw.tunnel, reservedToken: token };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n");
  } catch (err: any) {
    console.warn(`Failed to save reserved token to config: ${err.message}`);
  }
}

/**
 * Release a reserved share via `zrok release <token>`. Best-effort, non-throwing.
 * Returns true if the release command exited cleanly, false otherwise. Callers
 * should invoke this whenever abandoning a reserved token so the zrok edge
 * doesn't keep an orphaned reservation record (which is what causes stale
 * URLs like `tgbdzzvlar6b.share.zrok.io` to persist after the agent dies).
 */
export function releaseShare(token: string): boolean {
  if (!token) return false;
  try {
    execSync(`zrok release ${token}`, {
      timeout: 10_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan `ps` for orphan `zrok share` processes that point at the given port
 * via `--override-endpoint http://localhost:<port>` and SIGTERM them.
 *
 * This complements `cleanupStaleZrok` (which only knows about the single PID
 * in our pid-file): when the retry logic in `createTunnel` leaks processes
 * across failures, or when a previous server instance crashed, the pid-file
 * loses track of them. On startup we scavenge them directly from the process
 * table so a fresh tunnel doesn't compete with orphans.
 *
 * Returns the list of PIDs we killed.
 */
export function scavengeOrphanZrokProcesses(port: number): number[] {
  const killed: number[] = [];
  let output = "";
  try {
    output = execSync("ps -ax -o pid=,args=", {
      encoding: "utf-8",
      timeout: 5_000,
    }).toString();
  } catch {
    return killed;
  }

  const endpointMarker = `--override-endpoint http://localhost:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes("zrok share")) continue;
    if (!trimmed.includes(endpointMarker)) continue;
    const m = trimmed.match(/^(\d+)\s+/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (pid === process.pid) continue; // never kill ourselves
    try {
      // Group-kill on Unix so zrok's child workers die with it; taskkill /T
      // already handles the tree on Windows (killPidWithGroup routes the
      // platform-correct path).
      killPidWithGroup(pid, "SIGTERM");
      killed.push(pid);
      console.log(`Scavenged orphan zrok process (PID ${pid})`);
    } catch {
      // Process may have exited between ps and kill — ignore
    }
  }
  return killed;
}

/**
 * Create a reserved share via `zrok reserve public`.
 * Returns the share token or null on failure.
 */
function reserveShare(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const result = execSync(
        `zrok reserve public http://localhost:${port} --json-output`,
        { timeout: 30_000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const data = JSON.parse(result.trim());
      const token = data.token ?? data.share_token ?? data.shareToken;
      if (token) {
        console.log(`Reserved zrok share: ${token}`);
        saveReservedToken(token);
        return resolve(token);
      }
      console.warn("zrok reserve: no token in output", result.trim());
      resolve(null);
    } catch (err: any) {
      console.warn(`zrok reserve failed: ${err.message}`);
      resolve(null);
    }
  });
}

// ── Subprocess Tunnel ───────────────────────────────────────────────

/**
 * Create a tunnel by spawning zrok. Uses reserved shares for persistent URLs.
 * On first run, reserves a share and saves the token to config.
 * On subsequent runs, reuses the reserved token.
 * Returns URL or null on failure.
 */
export function createTunnel(
  port: number,
  reservedToken?: string,
  retriesLeft: number = 1,
): Promise<string | null> {
  // Fast path: another caller is already creating a tunnel — join that promise.
  if (pendingCreate) return pendingCreate;
  // Fast path: tunnel already up — return its URL without spawning.
  if (activeTunnelUrl) return Promise.resolve(activeTunnelUrl);

  const promise = _createTunnelInner(port, reservedToken, retriesLeft);
  pendingCreate = promise;
  promise.finally(() => {
    if (pendingCreate === promise) pendingCreate = null;
  });
  return promise;
}

function _createTunnelInner(
  port: number,
  reservedToken?: string,
  retriesLeft: number = 1,
): Promise<string | null> {
  return new Promise(async (resolve) => {
    if (!detectZrokBinary()) {
      resolve(null);
      return;
    }

    const env = loadZrokEnv();
    if (!env) {
      console.warn("zrok not enrolled — skipping tunnel creation");
      resolve(null);
      return;
    }

    // Track whether this call reserved the token itself (so we know to
    // release it if we subsequently time out or fail — the caller-provided
    // `reservedToken` is owned by the caller / config and must not be released
    // on transient timeouts).
    const callerProvidedToken = !!reservedToken;
    let token = reservedToken;
    if (!token) {
      token = await reserveShare(port) ?? undefined;
    }

    let resolved = false;
    let output = "";

    // Use reserved share if we have a token, otherwise fall back to public
    const args = token
      ? ["share", "reserved", token, "--headless", "--override-endpoint", `http://localhost:${port}`]
      : ["share", "public", "--headless", `http://localhost:${port}`];

    const child = spawn("zrok", args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    // Timeout: kill process if URL not parsed in time. Escalate SIGTERM
    // → SIGKILL after a grace period so a wedged zrok doesn't keep a stale
    // reservation attached after we've moved on. If we reserved the token
    // just-in-time within this call, release it on the zrok edge too so we
    // don't leak a dead reservation (root cause of stale URLs like
    // `tgbdzzvlar6b.share.zrok.io`).
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn("zrok tunnel creation timed out (30s)");
        try {
          if (child.pid != null) killPidWithGroup(child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch { /* already dead */ }
        setTimeout(() => {
          try {
            if (child.pid != null) killPidWithGroup(child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch { /* already dead */ }
        }, 2_000);
        if (token && !callerProvidedToken) releaseShare(token);
        removeZrokPid();
        resolve(null);
      }
    }, SPAWN_TIMEOUT_MS);

    const handleOutput = (chunk: Buffer) => {
      output += chunk.toString();
      // zrok prints the tunnel URL to stdout or stderr — match the public share URL (not localhost)
      const urlMatch = output.match(/https?:\/\/[^\s"]*\.share\.zrok\.io[^\s"]*/)
      if (urlMatch && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        const url = urlMatch[0];
        activeTunnelUrl = url;
        activeProcess = child;
        writeZrokPid(child.pid!);
        resolve(url);
      }
    };

    child.stdout!.on("data", handleOutput);
    child.stderr!.on("data", handleOutput);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.warn(`zrok tunnel spawn failed: ${err.message}`);
        resolve(null);
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // If reserved share failed, token may be expired or already attached
        // to an orphan process. Release it on the zrok edge before retrying so
        // we don't leak dead reservations (which is what produced stale URLs
        // like `tgbdzzvlar6b.share.zrok.io` pointing at nothing).
        if (token && retriesLeft > 0) {
          console.warn(`Reserved share failed (code ${code}), releasing token ${token} and creating new reservation...`);
          releaseShare(token);
          // Bypass the mutex wrapper so we don't self-deadlock: call the inner
          // implementation directly for the retry attempt.
          resolve(_createTunnelInner(port, undefined, retriesLeft - 1));
        } else if (token) {
          console.warn(`Reserved share failed (code ${code}) and retry budget exhausted; releasing token ${token}`);
          releaseShare(token);
          resolve(null);
        } else {
          console.warn(`zrok process exited before producing URL (code ${code})`);
          resolve(null);
        }
      } else if (activeProcess === child) {
        // Unexpected exit after successful start
        console.warn(`zrok tunnel process exited unexpectedly (code ${code})`);
        activeProcess = null;
        activeTunnelUrl = null;
        removeZrokPid();
      }
    });
  });
}

/**
 * Stop the active tunnel. Kills the subprocess and removes PID file.
 * Also sweeps any orphan zrok processes bound to the given port so restart
 * paths (which call `deleteTunnel` then spawn a new server) don't leave
 * dead reservations attached to the zrok edge.
 */
export async function deleteTunnel(port?: number): Promise<void> {
  const child = activeProcess;
  activeProcess = null;
  activeTunnelUrl = null;

  if (child) {
    try {
      if (child.pid != null) {
        // Route through the platform helper so Windows gets taskkill
        // semantics (tree-kill). See change: route-kill-paths-through-platform.
        await killProcess(child.pid, { timeoutMs: 2000 });
      } else {
        child.kill("SIGTERM");
      }
    } catch (err: any) {
      console.warn(`zrok tunnel cleanup failed: ${err.message}`);
    }
  }
  removeZrokPid();

  // Belt-and-braces: sweep any orphan zrok processes that escaped pid-file
  // tracking (e.g. from a previous crash or a failed retry chain).
  if (typeof port === "number") {
    try { scavengeOrphanZrokProcesses(port); } catch { /* best-effort */ }
  }
}

/**
 * Get the active tunnel URL, or null if no tunnel is active.
 */
export function getTunnelUrl(): string | null {
  return activeTunnelUrl;
}

/**
 * Get the current tunnel status for the REST endpoint.
 */
export function getTunnelStatus(): TunnelStatus {
  const serverOs = process.platform;
  if (activeTunnelUrl) {
    return { status: "active", url: activeTunnelUrl, serverOs };
  }
  if (detectZrokBinary()) {
    return { status: "inactive", serverOs };
  }
  return { status: "unavailable", serverOs };
}
