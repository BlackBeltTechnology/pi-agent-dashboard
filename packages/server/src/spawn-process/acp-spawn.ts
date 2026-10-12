/**
 * ACP spawn routing: one entry point for WS `spawn_session`, REST
 * `POST /api/session/spawn` and the plugin spawn hook when an `agent` is given.
 *
 * - non-durable agent (default) → host A, in-process (`startLocalAcpSession`)
 * - durable agent → headless keeper whose child is the acp-bridge adapter,
 *   regardless of the configured spawn strategy, without resolving pi.
 *
 * Returns an ordinary `SpawnResult` so callers keep using the same headless PID
 * registry, spawn token, register watchdog and spawn-error surfacing. A spawn
 * with no `agent` never reaches this module.
 *
 * See change: add-acp-session-driver (D2).
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcpAgentConfig } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { type LocalHostDeps, startLocalAcpSession } from "../acp-bridge/local-host.js";
import { mintSpawnToken } from "../auth/spawn-token.js";
import { type SpawnResult, spawnPiSession } from "./process-manager.js";
import type { PreflightReason, PreflightResult } from "./spawn-preflight.js";

const ADAPTER_BIN = fileURLToPath(new URL("../../bin/acp-bridge.mjs", import.meta.url));

let localHost: LocalHostDeps | null = null;

/** Server wiring: how host A attaches to the gateway. */
export function setLocalAcpHost(host: LocalHostDeps | null): void {
  localHost = host;
}

function resolveAcpAgent(id: string): AcpAgentConfig | undefined {
  return loadConfig().acpAgents.find((a) => a.id === id);
}

/** The ONLY agent data the browser sees: `{ id, name }` — never command/args/env. */
export function acpAgentsForClient(): Array<{ id: string; name: string }> {
  return loadConfig().acpAgents.map((a) => ({ id: a.id, name: a.name }));
}

function resolveOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (command.includes("/") || command.includes("\\") || path.isAbsolute(command)) {
    return existsSync(command) ? command : undefined;
  }
  const exts = process.platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""]; // platform-branch-ok: PATHEXT lookup for the preflight
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Validation shared by WS + REST + plugin spawns: unknown agent, none configured. */
export function validateAcpAgent(id: unknown): { ok: true; agent: AcpAgentConfig } | { ok: false; message: string } {
  const agents = loadConfig().acpAgents;
  if (agents.length === 0) return { ok: false, message: "No ACP agents are configured" };
  if (typeof id !== "string") return { ok: false, message: "agent must be a string" };
  const agent = agents.find((a) => a.id === id);
  return agent ? { ok: true, agent } : { ok: false, message: `Unknown ACP agent "${id}"` };
}

/** ACP preflight (replaces the pi/tmux preflight): cwd valid, node + agent command resolvable. */
export function preflightAcpSpawn(cwd: string, agent: AcpAgentConfig): PreflightResult {
  const reasons: PreflightReason[] = [];
  if (!existsSync(cwd)) {
    reasons.push({ code: "cwd_missing", message: `Directory does not exist: ${cwd}` });
  } else if (!statSync(cwd).isDirectory()) {
    reasons.push({ code: "cwd_not_directory", message: `Not a directory: ${cwd}` });
  }
  if (agent.durable && !existsSync(process.execPath)) {
    reasons.push({ code: "node_missing", message: `Node binary not found: ${process.execPath}` });
  }
  if (!resolveOnPath(agent.command)) {
    reasons.push({ code: "acp_command_missing", message: `ACP agent command not found: ${agent.command}` });
  }
  return { ok: reasons.length === 0, reasons };
}

export async function spawnAcpSession(
  cwd: string,
  opts: { agent: string; spawnToken?: string },
): Promise<SpawnResult> {
  const agent = resolveAcpAgent(opts.agent);
  if (!agent) return { success: false, code: "SPAWN_ERRNO", message: `Unknown ACP agent "${opts.agent}"` };
  if (!existsSync(cwd)) return { success: false, code: "DIR_MISSING", message: `Directory does not exist: ${cwd}` };
  const spawnToken = opts.spawnToken ?? mintSpawnToken();

  if (!agent.durable) {
    if (!localHost) return { success: false, code: "SPAWN_ERRNO", message: "In-process ACP host is not available", spawnToken };
    const r = startLocalAcpSession(localHost, { agent, settings: loadConfig().acp, cwd, spawnToken });
    return r.success
      ? { success: true, dashboardSpawned: true, message: r.message, pid: r.pid, process: r.process, spawnToken }
      : { success: false, code: "SPAWN_ERRNO", message: r.message, spawnToken };
  }

  const result = await spawnPiSession(cwd, {
    strategy: "headless",
    spawnToken,
    childCmd: [process.execPath, ADAPTER_BIN, "--agent", agent.id],
  });
  return { ...result, spawnToken };
}

/**
 * Plugin spawn hook validation: with `agent` set, pi-only options are rejected
 * (never silently dropped) and an unknown id is rejected. Returns the error
 * message, or `undefined` when the spawn may proceed.
 */
export function validatePluginAcpSpawn(opts: { agent?: unknown; scope?: unknown; resume?: unknown; model?: unknown }): string | undefined {
  if (opts.agent === undefined) return undefined;
  const v = validateAcpAgent(opts.agent);
  if (!v.ok) return v.message;
  const piOnly = (["scope", "resume", "model"] as const).filter((k) => opts[k] !== undefined);
  return piOnly.length > 0 ? `option(s) ${piOnly.join(", ")} are pi-only and cannot be combined with agent "${v.agent.id}"` : undefined;
}
