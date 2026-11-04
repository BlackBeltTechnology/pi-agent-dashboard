/**
 * The server's own pid namespace (`ServerPidContext`), built ONCE on first use
 * with the same builder the bridge uses, so `resolvePidTarget` compares like
 * with like and performs no I/O per call (S10).
 * See change: scope-pids-to-namespace.
 */
import { buildServerPidContext, type ServerPidContext } from "@blackbelt-technology/pi-dashboard-shared/pid-namespace.js";

let ctx: ServerPidContext | undefined;

export function getServerPidContext(): ServerPidContext {
  ctx ??= buildServerPidContext();
  return ctx;
}
