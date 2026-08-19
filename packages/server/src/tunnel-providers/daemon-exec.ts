/**
 * Non-blocking CLI runner for the daemon providers' READINESS predicates.
 *
 * The synchronous `defaultRunner` in each provider stays exactly as it is for
 * the connect/disconnect lifecycle, where blocking is acceptable and the code
 * is already written around it. Readiness is different: it polls every 5s from
 * an interactive surface, and a synchronous `execFileSync` cannot be bounded by
 * racing it against a timer — the timer cannot fire while the event loop is
 * blocked, so a hung `tailscale status` freezes the ENTIRE server for its 30s
 * exec timeout, not merely one row of the board.
 *
 * This runner kills the child at the bound, so the bound is real.
 *
 * See change: add-zrok-custom-reserved-name (D6).
 */
import { execFile } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { READINESS_PREDICATE_TIMEOUT_MS } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

export interface AsyncCmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AsyncCmdRunner = (args: string[]) => Promise<AsyncCmdResult>;

/**
 * `timeout` is passed to `execFile` itself, which SIGTERMs the child — the
 * bound is enforced on the process, not merely on our willingness to wait. A
 * promise-level race alone would leak a running CLI per tick.
 */
export function asyncRunner(
  getBinary: () => string,
  timeoutMs: number = READINESS_PREDICATE_TIMEOUT_MS,
): AsyncCmdRunner {
  return (args) =>
    new Promise<AsyncCmdResult>((resolve) => {
      // argv form: args as an array, never joined into a shell command line.
      execFile(getBinary(), args, { timeout: timeoutMs }, (err: any, stdout: any, stderr: any) => {
        resolve({
          code: err?.code ?? 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? err?.message ?? ""),
        });
      });
    });
}
