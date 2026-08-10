/**
 * Defense-in-depth guard against destructive PID-registry sweeps during tests.
 *
 * Production startup code paths (headlessPidRegistry.cleanupOrphans/killAll,
 * editorPidRegistry.cleanupOrphans) read PID files and send SIGTERM. If they
 * ever run under vitest AGAINST the developer's real $HOME, they can kill
 * live pi sessions.
 *
 * This guard returns true when:
 *   - we appear to be inside a vitest run (VITEST env var), AND
 *   - HOME still points at the real user home (tripwire missed).
 *
 * Callers SHOULD `console.warn` and return without performing destructive work
 * when this returns true.
 *
 * Normal production servers (VITEST not set) always get `false` and behave as
 * before.
 */
import os from "node:os";

export function isUnsafeTestHomeScan(): boolean {
  if (process.env.VITEST !== "true") return false;
  const currentHome = process.env.HOME ?? "";
  const realHome = os.userInfo().homedir;
  return currentHome === "" || currentHome === realHome;
}
