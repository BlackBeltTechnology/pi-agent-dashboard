/**
 * Remote folder gate. A non-local socket may only pin / add / move a folder that
 * already lies inside the shared-root set; otherwise the command is dropped and
 * ONLY that socket is told. A local socket is unchanged.
 *
 * Without this a remote caller could `pin_directory /opt/secret` and so widen
 * its own browse roots. Consistency ("ask the host to pin it" stays true), not
 * a hard boundary: see design.md threat model.
 * See change: harden-server-capability-bounds (D1b).
 */
import { isWithinBrowseRoots } from "../lib/browse-roots.js";
import type { BrowserHandlerContext } from "./handler-context.js";

/**
 * Run `proceed` for a local socket (`locallyTrusted === true`; synchronously, exactly as
 * before) or for a remote (or unflagged) socket when `path` is inside the shared roots. Anything else, including
 * a root computation failure or a missing root resolver, refuses (fail closed).
 */
export function gateRemoteFolder(
  ctx: BrowserHandlerContext,
  path: string,
  command: string,
  proceed: () => void,
): void {
  // Default-deny: only an explicit `true` is local; an absent bit is treated as remote.
  if (ctx.locallyTrusted === true) {
    proceed();
    return;
  }
  const refuse = (why: string): void => {
    // JSON.stringify: the path is caller-controlled (no newline may forge a log line).
    console.warn(`[folder-gate] refused remote ${command} ${JSON.stringify(path)}: ${why}`);
    ctx.sendTo(ctx.ws, { type: "folder_refused", path, reason: "outside_allowed_roots" });
  };
  const roots = ctx.browseRoots;
  if (!roots) {
    refuse("no root resolver");
    return;
  }
  roots()
    // `null` = confinement is switched off (`browse.confineRemote: false`).
    .then((allowed) => (allowed === null ? true : isWithinBrowseRoots(path, allowed)))
    .then(
      (ok) => {
        if (!ok) return refuse("outside the shared roots");
        try {
          proceed();
        } catch (err) {
          // The check passed; a failing command is the handler's problem, not a refusal.
          console.error(`[folder-gate] ${command} ${JSON.stringify(path)} failed after the root check:`, err);
        }
      },
      (err: unknown) => refuse(`root check failed: ${err instanceof Error ? err.message : String(err)}`),
    );
}
