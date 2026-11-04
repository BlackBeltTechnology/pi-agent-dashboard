/**
 * Link a registering session to its headless spawn entry: token → pid →
 * cwd-FIFO, gated by the register's pid target (resolved WITHOUT own-entry
 * evidence, so linking is never circular — design D2 "link time").
 *
 * - `host`: all three tiers, as before.
 * - `unknown`: pid tier only for an entry in the register's own cwd; cwd-FIFO allowed.
 * - non-local (`wsl`, `legacy-wsl`, `foreign`): token tier only — a pid number
 *   from another namespace must never claim a local spawn, nor may cwd order.
 *
 * See change: scope-pids-to-namespace (D3, task 4.6).
 */
import { isNonLocalTarget, type PidTarget } from "../session/pid-target.js";
import type { HeadlessPidRegistry } from "./headless-pid-registry.js";

export interface LinkRegisterInput {
  sessionId: string;
  spawnToken?: string;
  pid?: number;
  cwd: string;
}

export type LinkTier = "token" | "pid" | "cwd" | "none";

export function linkRegisterToSpawn(
  registry: Pick<HeadlessPidRegistry, "linkByToken" | "linkByPid" | "linkSession">,
  input: LinkRegisterInput,
  target: PidTarget | undefined,
  log: (line: string) => void = (l) => console.error(l),
): LinkTier {
  const { sessionId, spawnToken, pid, cwd } = input;
  if (spawnToken && registry.linkByToken(spawnToken, sessionId, pid)) return "token";
  if (target && isNonLocalTarget(target)) return "none";
  if (pid !== undefined) {
    const opts = target?.kind === "unknown" ? { cwd } : undefined;
    if (registry.linkByPid(sessionId, pid, opts)) return "pid";
  }
  if (spawnToken || pid !== undefined) {
    log(`[event-wiring] cwd-FIFO fallback for session ${sessionId} — token=${spawnToken ?? ""} pid=${pid ?? ""} cwd=${cwd}`);
  }
  return registry.linkSession(sessionId, cwd) ? "cwd" : "none";
}
