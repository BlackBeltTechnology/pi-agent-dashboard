/**
 * Install signal + exit handlers that release the per-HOME dashboard lock.
 *
 * Separate from `home-lock.ts` so the pure lock-acquisition logic stays
 * trivially testable. See change: single-dashboard-per-home.
 */

export type ReleaseFn = () => Promise<void>;

export interface InstallReleaseHandlersOptions {
  /** Inject a fake `process`-like object for tests. */
  proc?: NodeJS.Process;
  /** Inject a logger (defaults to `console`). */
  log?: (msg: string) => void;
}

/**
 * Register SIGINT / SIGTERM / SIGHUP / SIGBREAK handlers and an `exit`
 * fallback that call `release()` exactly once. The handler is idempotent;
 * multiple signals will not double-release.
 *
 * Windows:
 *   - SIGINT + SIGBREAK are emitted by Node. SIGBREAK fires on Ctrl+Break.
 *   - SIGHUP does not exist on Windows; the registration is a no-op there.
 *   - `taskkill /F` bypasses all signals — the stale-detection path in
 *     `proper-lockfile` (staleDuration 10s) handles this case on next boot.
 *
 * Returns a function that removes the handlers (useful for tests).
 */
export function installReleaseHandlers(
  release: ReleaseFn,
  options: InstallReleaseHandlersOptions = {},
): () => void {
  const proc = options.proc ?? process;
  const log = options.log ?? ((m: string) => console.log(m));

  let releasing = false;
  const doRelease = async (signal: string) => {
    if (releasing) return;
    releasing = true;
    try {
      await release();
    } catch (err) {
      log(`[home-lock] release on ${signal} failed: ${(err as Error).message ?? err}`);
    }
  };

  const sigintHandler = () => { void doRelease("SIGINT").then(() => proc.exit(0)); };
  const sigtermHandler = () => { void doRelease("SIGTERM").then(() => proc.exit(0)); };
  const sighupHandler = () => { void doRelease("SIGHUP").then(() => proc.exit(0)); };
  const sigbreakHandler = () => { void doRelease("SIGBREAK").then(() => proc.exit(0)); };
  // `exit` is synchronous — we can't await. Best effort: fire and move on;
  // the async release will race the exit. `proper-lockfile` also removes its
  // own lockfile on exit via its own exit hook as a safety net.
  const exitHandler = () => { void release().catch(() => { /* ignore */ }); };

  proc.on("SIGINT", sigintHandler);
  proc.on("SIGTERM", sigtermHandler);
  // SIGHUP + SIGBREAK may be undefined on Windows / some environments —
  // registering still works (Node just never fires them there).
  proc.on("SIGHUP", sighupHandler);
  proc.on("SIGBREAK" as NodeJS.Signals, sigbreakHandler);
  proc.on("exit", exitHandler);

  return () => {
    proc.off("SIGINT", sigintHandler);
    proc.off("SIGTERM", sigtermHandler);
    proc.off("SIGHUP", sighupHandler);
    proc.off("SIGBREAK" as NodeJS.Signals, sigbreakHandler);
    proc.off("exit", exitHandler);
  };
}
