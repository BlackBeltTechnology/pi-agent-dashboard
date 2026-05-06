/**
 * Pure helper: classify an `ensureServer()` failure message as either
 * deadline-elapsed / child-exit (the loading page is the better surface)
 * or configuration / terminal (show the Setup/Retry/Quit dialog).
 *
 * Drives the routing decision in `main.ts` after the retry loop was
 * dropped. See change: tighten-electron-server-startup-deadline.
 *
 * The two prefixes recognised here are exactly the ones produced by
 * `buildServerStartupError` in `server-lifecycle.ts`. Keep them in sync.
 */
export function isDeadlineOrChildExitError(message: string): boolean {
  if (typeof message !== "string") return false;
  return (
    message.startsWith("Server did not respond within") ||
    message.startsWith("Server child process exited prematurely")
  );
}
