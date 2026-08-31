/**
 * Ephemeral boot-parent watch (D5, fix-autostart-discovery-precedence).
 *
 * A server started with `--ephemeral` exists only to serve the agent that
 * booted it. When that boot parent dies, the server would otherwise leak its
 * ports and memory forever. This watch is a small INDEPENDENT, unconditional
 * interval — the idle timer (`createIdleTimer`) CANNOT host the check: its
 * `start()` early-returns when `config.autoShutdown` is false (the default,
 * and the exact isolated-verification config ephemeral targets) and it
 * terminates via raw `process.exit(0)`, the leak/undrained-exit path this
 * design forbids. The interval cadence IS the stated exit-latency bound.
 *
 * On a PROVEN-dead parent (kill-decision liveness, D6) it invokes
 * `onParentDead` exactly once — wired by `server.ts` to
 * `server.stop({ exitIntent: "ephemeral" })` so spawned sessions drain and
 * the exit suppresses crash recovery. Standalone and Electron-hosted servers
 * are excluded by construction: nothing passes the flag for them.
 */

import { bootParentPid } from "./boot-parent-liveness.js";

export interface EphemeralParentWatch {
  /** Arm the interval. No-op when not in ephemeral mode. */
  start(): void;
  /** Cancel the interval (idempotent). */
  stop(): void;
}

export interface EphemeralParentWatchDeps {
  /** Ephemeral opt-in — the config flag, evaluated at start and per tick. */
  isEphemeral: () => boolean;
  /**
   * Kill-decision probe: true ONLY on proof the boot parent is absent
   * (`isBootParentProvablyDead`). Alive-biased — see D6.
   */
  isParentProvablyDead: () => boolean;
  /** Graceful shutdown — `server.stop({ exitIntent: "ephemeral" })`. */
  onParentDead: () => Promise<void> | void;
  /** Tick cadence (ms). Default 5000 — the stated exit-latency bound. */
  intervalMs?: number;
  /**
   * Grace period between a COMPLETED graceful stop and the hard exit.
   * Default 5000. See the fallback note in the tick body.
   */
  exitGraceMs?: number;
  /**
   * Hard-exit fn used by the post-stop fallback. Default `() =>
   * process.exit(0)`. Test seam.
   */
  hardExit?: () => void;
  /** Log sink; default `console.log`. */
  log?: (message: string) => void;
}

/** Default tick cadence (ms) — the stated exit-latency bound. */
const DEFAULT_INTERVAL_MS = 5000;

export function startEphemeralParentWatch(deps: EphemeralParentWatchDeps): EphemeralParentWatch {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = deps.log ?? ((m: string) => console.log(m));
  let timer: ReturnType<typeof setInterval> | null = null;
  let fired = false;
  let stopped = false;

  return {
    start() {
      // Flag-only opt-in (task 5.1): never armed unless explicitly ephemeral,
      // so standalone / non-ephemeral servers are unaffected by construction.
      if (!deps.isEphemeral() || stopped || timer) return;
      timer = setInterval(() => {
        void (async () => {
          if (stopped || fired || timer === null) return;
          if (!deps.isEphemeral() || !deps.isParentProvablyDead()) return;
          fired = true;
          const t = timer;
          timer = null;
          clearInterval(t);
          log(
            `[ephemeral] boot parent (pid ${bootParentPid}) is gone — ` +
            `shutting down gracefully`,
          );
          try {
            await deps.onParentDead();
          } catch (err) {
            log(`[ephemeral] graceful shutdown failed: ${err}`);
          }
          // Doubt-review fix (D5): a COMPLETED graceful stop does not
          // guarantee process exit — any surviving ref'd handle (keeper
          // child, node-pty, tunnel agent) would leave an invisible zombie
          // with its ports closed, the exact leak D5 exists to kill. The
          // idle-timer path answers the same risk with a raw `process.exit(0)`
          // after `stopServer`. Mirror that bound: sessions are already
          // drained and the exit intent recorded by `stop()`, so a hard exit
          // here cannot lose state. unref'd → never fires in the good path.
          const graceMs = deps.exitGraceMs ?? 5000;
          setTimeout(() => {
            log("[ephemeral] still alive after graceful stop — exiting hard");
            (deps.hardExit ?? (() => process.exit(0)))();
          }, graceMs).unref?.();
        })();
      }, intervalMs);
      // Never keep the process alive on our own account.
      timer.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
