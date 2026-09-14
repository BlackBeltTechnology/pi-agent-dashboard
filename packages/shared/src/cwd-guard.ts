/**
 * Canonical folder-admission guard shared by first-party plugins that accept a
 * caller-supplied `cwd` and then touch disk under it (kb-plugin, mcp-client).
 *
 * A cwd is admitted when it — or the resolved MAIN CHECKOUT of the git
 * repository it belongs to — is a member of the host's known-folder set
 * (session cwds ∪ pinned dirs). Both sides are realpath-canonicalized, so a
 * symlinked route to the same folder matches, and a git worktree whose main
 * checkout is known is admitted even though the worktree itself is never
 * pinned (worktrees are transient; the durable repo root is the trust anchor).
 *
 * Extracted from `packages/kb-plugin/src/server/kb-routes.ts` so both plugins
 * import ONE implementation. See change: extract-mcp-client-plugin.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { checkoutRoots, hasGitPathSegment, isBoundCheckout } from "./platform/git.js";

/** Canonicalize an absolute path for comparison: resolve, then follow symlinks
 *  (best-effort — a non-existent path keeps its resolved form). Pins are stored
 *  realpath-canonicalized while session cwds / the raw query string may reach
 *  the same folder via a symlink (macOS /var→/private/var, a symlinked repo
 *  root), so BOTH sides of the guard must canonicalize identically or the match
 *  spuriously fails. See change: fix-kb-worktree-cwd-guard. */
export function canonPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** The MAIN CHECKOUT of `cwd` — the durable git repo root admission anchors on
 *  — or null when none resolves. Server-derived via git, never client-supplied.
 *
 *  Uses the shared checkout-root resolution rather than the superseded
 *  `dirname(--git-common-dir)`, which names a real checkout only when the git
 *  dir happens to sit inside one. Under `--separate-git-dir` that parent is a
 *  real but UNRELATED directory which could itself be a known folder — an
 *  over-admission this anchor closes.
 *
 *  The `.git`-segment rejection and the repository binding are this
 *  consumer's OWN obligations: the resolver returns a user-controlled
 *  `core.worktree` value verbatim and does not judge it. Being an
 *  AUTHORIZATION consumer, the safe response is to derive no main path at all,
 *  so the value is never matched against the known-folder set. Binding
 *  re-resolves the candidate and requires it to point back at the SAME common
 *  dir, which closes a repository-local `core.worktree` naming an unrelated
 *  KNOWN folder.
 *
 *  A submodule resolves to its own checkout and therefore does NOT inherit
 *  trust from its superproject; a worktree of a bare hub resolves to null and
 *  is rejected unless independently known.
 *  The probes run through the SYNCHRONOUS runner on a Fastify request path, so
 *  the per-probe budget is what bounds event-loop blocking. The superseded
 *  implementation blocked for at most one 2000ms `execFileSync`; resolving the
 *  cwd takes up to FIVE probes and binding a linked-worktree candidate takes up
 *  to FIVE MORE, so the budget is 200ms each to hold the SAME 2s worst case
 *  (10 × 200ms) rather than multiplying it. A healthy git answers in ~10ms; only
 *  a pathological (network-mounted, unresponsive) checkout approaches the bound,
 *  and a timeout degrades to "no result" → reject, never admit.
 *  See changes: add-git-checkout-root-resolver (was: fix-kb-worktree-cwd-guard),
 *  widen-containment-to-resolved-checkout. */
export function mainCheckoutPath(cwd: string): string | null {
  const roots = checkoutRoots({ cwd, timeout: 200 });
  const main = roots?.mainCheckout;
  if (!main) return null;
  return isBoundCheckout(main, roots.commonDir, { timeout: 200 }) ? main : null;
}

/** Pure cwd guard: a cwd is allowed when it (or its resolved MAIN CHECKOUT) is
 *  a known folder. Both sides canonicalize.
 *  See change: fix-plugin-action-fanout-and-handlers. */
export function isAllowedCwd(cwd: string | undefined, known: () => string[]): cwd is string {
  if (!cwd) return false;
  const target = canonPath(cwd);
  // A git-internal path is never a legitimate project root, so it is rejected
  // BEFORE either admission path — including the direct known-folder match,
  // which a stray pinned or session cwd of `<repo>/.git` would otherwise satisfy.
  //
  // The CANONICAL form is the only one worth testing. `hasGitPathSegment`
  // normalizes before splitting, so a raw `<repo>/.git/..` collapses to
  // `<repo>` on both sides — and `<repo>` is not a traversal, it IS the known
  // folder. `canonPath` additionally realpaths, so a symlink AIMED at a git dir
  // is caught here and would be missed by a raw-string test.
  if (hasGitPathSegment(target)) return false;
  const knownCanon = known().map(canonPath);
  if (knownCanon.includes(target)) return true;
  // Admit a cwd whose MAIN CHECKOUT is a known folder (covers a session-less
  // worktree — worktrees are never pinned and their session is transient, so
  // the durable repo root is the trust anchor).
  const main = mainCheckoutPath(cwd);
  if (main && knownCanon.includes(canonPath(main))) return true;
  return false;
}
