/**
 * Agent child launch hygiene: allowlisted environment, argv-only spawn, Windows
 * shell-script rejection. The agent runs as the user (no filesystem isolation);
 * this only keeps dashboard credentials and node-injection vars out of its env.
 *
 * See change: add-acp-session-driver (D3; "Adapter launches the agent safely").
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { AcpAgentConfig } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";

const ALLOWED = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "TMPDIR", "TZ",
  "SystemRoot", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ComSpec", "PATHEXT",
]);
const FORBIDDEN_CONFIGURED = [/^PI_/, /^ELECTRON_/, /^NODE_OPTIONS$/];

const isAllowed = (key: string): boolean => ALLOWED.has(key) || key.startsWith("LC_");

export interface AgentEnv {
  env: Record<string, string>;
  /** Configured keys dropped for being forbidden (PI_*, ELECTRON_*, NODE_OPTIONS). */
  warnings: string[];
}

/** Allowlist from the adapter env + configured agent env minus forbidden keys. */
export function buildAgentEnv(
  adapterEnv: Record<string, string | undefined>,
  configured: Record<string, string> = {},
): AgentEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(adapterEnv)) {
    if (v !== undefined && isAllowed(k)) env[k] = v;
  }
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(configured)) {
    if (FORBIDDEN_CONFIGURED.some((re) => re.test(k))) {
      warnings.push(`acp agent env key "${k}" is not passed to the agent (reserved)`);
    } else env[k] = v;
  }
  return { env, warnings };
}

/** `.cmd` / `.bat` need a shell on Windows; we never use one. */
export function assertLaunchable(command: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    throw new Error(`ACP agent command "${command}" requires a shell (.cmd/.bat); configure the .exe instead`);
  }
}

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface LaunchOptions {
  agent: Pick<AcpAgentConfig, "command" | "args" | "env">;
  cwd: string;
  adapterEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  warn?: (msg: string) => void;
}

/** Spawn the agent: argv array, `shell:false`, allowlisted env, piped stdio. */
export function launchAgentProcess(o: LaunchOptions): ChildProcess {
  assertLaunchable(o.agent.command, o.platform);
  const { env, warnings } = buildAgentEnv(o.adapterEnv ?? process.env, o.agent.env);
  for (const w of warnings) o.warn?.(w);
  return (o.spawn ?? nodeSpawn)(o.agent.command, o.agent.args ?? [], {
    cwd: o.cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}
