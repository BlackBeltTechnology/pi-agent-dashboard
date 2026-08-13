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
  /** Deadline in ms. Defaults to the shared `SERVER_STARTUP_DEADLINE_MS`. */
  deadlineMs?: number;
}

/**
 * Run `core` under a deadline. On success: nothing else happens — `teardown`
 * is never invoked and every listener stays open (E3).
 *
 * On failure (throw or deadline): `teardown` runs first, then the ORIGINAL
 * error propagates (E2). The caller (`cli.ts` `main().catch`) exits non-zero.
 */
export async function runBoundedStartup(opts: BoundedStartupOpts): Promise<void> {
  const deadlineMs = opts.deadlineMs ?? SERVER_STARTUP_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StartupDeadlineError(deadlineMs)), deadlineMs);
    // The deadline timer itself must never be what keeps the process alive.
    timer.unref?.();
  });

  try {
    await Promise.race([opts.core(), deadline]);
  } catch (err) {
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
