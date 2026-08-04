/**
 * Real-environment factory for {@link InstallerEnv}. This is the ONLY module
 * that touches the real OS — every probe and side effect is concentrated here
 * so the state machine (`install.ts`) stays pure and Linux-testable.
 *
 * Security discipline (see change: add-apple-tools-imcp-plugin, Decision 4):
 *   - `brew` is invoked with an argv array via execFileSync — never a shell,
 *     so no probed value (path, sw_vers output) can reach a shell string.
 *   - config writes are temp-file + atomic rename.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { IMCP_BREW_CASK } from "./detect.js";
import type { BrewResult, InstallerEnv } from "./install.js";
import type { ConfigIO } from "./mcp-config.js";

/** 10-minute cap on the brew cask install (design X4). */
export const BREW_TIMEOUT_MS = 10 * 60 * 1000;

function probeOsVersion(): string | null {
  try {
    const out = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
    const v = out.trim();
    return v === "" ? null : v;
  } catch {
    return null;
  }
}

function brewPath(): string | null {
  try {
    const out = execFileSync("/usr/bin/which", ["brew"], { encoding: "utf8" });
    const p = out.trim();
    return p === "" ? null : p;
  } catch {
    return null;
  }
}

function runBrewCask(brew: string): BrewResult {
  try {
    // argv array; NEVER a shell string. The cask ref is a constant, not a probe.
    execFileSync(brew, ["install", "--cask", IMCP_BREW_CASK], {
      encoding: "utf8",
      timeout: BREW_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; signal?: string; stderr?: Buffer | string; code?: string };
    const timedOut = err.signal === "SIGTERM" || err.code === "ETIMEDOUT";
    const stderr = typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? "");
    return { code: err.status ?? 1, stderr, timedOut };
  }
}

/**
 * Atomic write: temp file in the target dir, fsync, then rename over the
 * destination. Hardened per the security pass:
 *  - `wx` + a random name: never follow or clobber a pre-planted symlink.
 *  - mode 0600: a rename carries the temp file's mode onto the destination, so
 *    a default-umask temp would silently widen a 0600 user config that may hold
 *    another server's credential `env` block.
 *  - fsync before rename: a rename over unflushed data can surface as a
 *    zero-length config after a crash — the truncation this exists to prevent.
 *  - unlink the temp on failure: no leftovers on ENOSPC/EACCES.
 */
function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw e;
  }
}

const realConfigIO: ConfigIO = {
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFileAtomic,
};

export interface CreateEnvOptions {
  /** Operator override for the imcp-server path. */
  overridePath?: string;
  /** Override the pi agent home (defaults to ~/.pi/agent). */
  piAgentHome?: string;
}

/** Build a real InstallerEnv wired to the current host. */
export function createInstallerEnv(opts: CreateEnvOptions = {}): InstallerEnv {
  const home = homedir();
  const agentHome = opts.piAgentHome ?? join(home, ".pi", "agent");
  return {
    platform: process.platform,
    homedir: home,
    probeOsVersion,
    pathExists: existsSync,
    brewPath,
    runBrewCask,
    ...(opts.overridePath ? { overridePath: opts.overridePath } : {}),
    mcpJsonPath: join(agentHome, "mcp.json"),
    settingsJsonPath: join(agentHome, "settings.json"),
    configIO: realConfigIO,
  };
}