/**
 * Real-environment factory for {@link InstallerEnv}. This is the ONLY module
 * that touches the real OS — every probe and side effect is concentrated here
 * so the state machine (`install.ts`) stays pure and Linux-testable.
 *
 * Config paths and the hardened atomic write now live in the `mcp-client`
 * plugin's `./core` (design D2/D3): this factory only builds the
 * `mcp-client.config` service with the real filesystem IO and the default
 * adapter port, so target paths resolve through the adapter's own helpers and
 * honour `PI_CODING_AGENT_DIR` (a hard-coded `~/.pi/agent` would not).
 *
 * Security discipline (see change: add-apple-tools-imcp-plugin, Decision 4):
 *   - `brew` is invoked with an argv array via execFileSync — never a shell,
 *     so no probed value (path, sw_vers output) can reach a shell string.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  type AdapterPort,
  type ConfigIO,
  createMcpClientConfigService,
  createRealConfigIO,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { IMCP_BREW_CASK } from "./detect.js";
import type { BrewResult, InstallerEnv } from "./install.js";

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

export interface CreateEnvOptions {
  /** Operator override for the imcp-server path. */
  overridePath?: string;
  /** Test seam: inject config IO (defaults to the real filesystem). */
  configIO?: ConfigIO;
  /** Test seam: inject the adapter port (defaults to the worker-thread port). */
  adapter?: AdapterPort;
}

/** Build a real InstallerEnv wired to the current host. */
export function createInstallerEnv(opts: CreateEnvOptions = {}): InstallerEnv {
  return {
    platform: process.platform,
    homedir: homedir(),
    probeOsVersion,
    pathExists: existsSync,
    brewPath,
    runBrewCask,
    ...(opts.overridePath ? { overridePath: opts.overridePath } : {}),
    // Global scope only — the CLI never writes a project layer, so the
    // known-cwd admission set is empty.
    mcps: createMcpClientConfigService({
      configIO: opts.configIO ?? createRealConfigIO(),
      knownCwds: () => [],
      ...(opts.adapter ? { adapter: opts.adapter } : {}),
    }),
  };
}
