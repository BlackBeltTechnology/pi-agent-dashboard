/**
 * Bounded server startup (D1).
 *
 * `piGateway.start()` binds the gateway port early in `start()`, long before
 * `fastify.listen()`. A startup step that throws — or never settles — after
 * that point leaves a process holding the gateway port while never serving
 * its dashboard port (the captured PID-78379 signature: gateway held 5h52m,
 * dashboard port never bound, live event loop).
 *
 * Teardown alone is insufficient: the gateway's ping interval keeps the loop
 * alive even after the socket closes. So startup is BOTH torn down and
 * bounded by a deadline, and the original failure is preserved — a teardown
 * error must never replace the error that triggered it.
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { SERVER_STARTUP_DEADLINE_MS } from "@blackbelt-technology/pi-dashboard-shared/config.js";

export class StartupDeadlineError extends Error {
  readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`Server startup exceeded its ${deadlineMs}ms deadline; tearing down`);
    this.name = "StartupDeadlineError";
    this.deadlineMs = deadlineMs;
  }
}

export interface BoundedStartupOpts {
  /** The real startup body. */
  core: () => Promise<void>;
  /**
   * Release every listener/timer already opened by `core`. Runs ONLY on
   * failure. Its own errors are swallowed so the original rejection survives.
   */
  teardown: () => Promise<void> | void;
  /**
   * Deadline in ms, or `null` for teardown-only (no deadline).
   *
   * `null` is for IN-PROCESS callers (tests, embedders) that own the server's
   * lifetime already: killing their boot on a wall-clock timer buys nothing
   * and, on a slow host, yanks a legitimately-slow-but-fine startup out from
   * under them. The deadline exists for the STANDALONE server process, where
   * nobody else is watching — `cli.ts` passes it. Teardown-on-failure applies
   * either way.
   */
  deadlineMs?: number | null;
}

/**
 * Run `core` under a deadline. On success: nothing else happens — `teardown`
 * is never invoked and every listener stays open (E3).
 *
 * On failure (throw or deadline): `teardown` runs first, then the ORIGINAL
 * error propagates (E2). The caller (`cli.ts` `main().catch`) exits non-zero.
 */
export async function runBoundedStartup(opts: BoundedStartupOpts): Promise<void> {
  const deadlineMs = opts.deadlineMs === undefined ? SERVER_STARTUP_DEADLINE_MS : opts.deadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = deadlineMs === null
    ? null
    : new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StartupDeadlineError(deadlineMs)), deadlineMs);
        // The deadline timer itself must never be what keeps the process alive.
        timer.unref?.();
      });

  // The deadline cannot CANCEL `core` — it keeps running after the race
  // rejects. Two consequences, both handled here:
  //
  //  1. Its late settle needs an owner, or a boot that fails after the
  //     deadline throws into nothing (unhandled rejection).
  //  2. Worse, a late step can OPEN something after teardown already ran —
  //     `fastify.listen()` sits at the very end of startup, so a boot that
  //     crawls past the deadline could bind the dashboard port moments after
  //     we released it, resurrecting the resident-but-not-serving process
  //     this module exists to prevent. So teardown runs AGAIN when a
  //     superseded core finally settles, closing anything it opened late.
  let superseded = false;
  const core = opts.core();
  const sweepIfSuperseded = async () => {
    if (!superseded) return;
    try {
      await opts.teardown();
    } catch {
      /* best-effort sweep */
    }
  };
  core.then(sweepIfSuperseded, sweepIfSuperseded);

  try {
    await (deadline === null ? core : Promise.race([core, deadline]));
  } catch (err) {
    // From here on `core` (if still running) is superseded: whatever it opens
    // afterwards must be swept by the handler above.
    superseded = true;
    try {
      await opts.teardown();
    } catch {
      /* teardown failures must not mask the original startup error */
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
