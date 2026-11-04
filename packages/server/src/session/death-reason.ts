import { type KillFn, signalZero } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import type { ClosedReason } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PidTarget } from "./pid-target.js";

/**
 * Best-effort classification of an involuntary death from the recorded `pid`.
 *
 * Involuntary termination causes and a severed network link are identical from
 * the server's position: silence. The probe can only distinguish "the process is
 * gone" from "we could not tell", and NEVER names a signal or a kill mechanism
 * (spec: "Process-liveness classification SHALL NOT overclaim").
 *
 * `pid` is self-reported by the bridge and optional, and operating systems
 * recycle pids. A live probe is therefore NOT evidence of a live pi: a recycled
 * pid makes a dead process probe as alive, so a live probe downgrades to
 * `unknown` rather than claiming the process persists. An unprobeable pid
 * (EPERM, no pid) is likewise `unknown`.
 *
 * Only a pid whose resolved target is `host` is probed. Any other target —
 * remote origin, WSL, a container, `unknown` — lives in (or may live in)
 * ANOTHER pid namespace, where a local ESRCH asserts `process_gone` about a
 * process this host cannot see (a running remote pi behind a dropped tunnel is
 * the common case). Those downgrade to `unknown` WITHOUT probing.
 * See changes: stop-discarding-known-session-state (design D1, task 4.10),
 *              scope-pids-to-namespace (D3).
 */
export function classifyCarrierLoss(
  session: { pid?: number },
  target: PidTarget | undefined,
  opts: { kill?: KillFn } = {},
): ClosedReason {
  if (session.pid === undefined) return "unknown";
  if (target?.kind !== "host") return "unknown";
  // `esrch` is PROOF of absence; `alive` (including a recycled pid) and
  // `other-errno` (e.g. EPERM — process exists but is not ours) are both
  // "we could not tell", so they read `unknown`.
  return signalZero(session.pid, opts) === "esrch" ? "process_gone" : "unknown";
}
