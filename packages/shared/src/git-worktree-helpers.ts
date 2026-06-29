/**
 * Pure helpers for the git-worktree feature that BOTH the server and the
 * client need (slug derivation for the live path preview, base-branch
 * fallback chain for the dialog's default base). Server-only helpers
 * (porcelain parser, `.git/info/exclude` mutation) stay in
 * `packages/server/src/git-worktree.ts`.
 *
 * Pure: no fs, no child_process, no platform branching. Safe to import
 * in any package.
 *
 * See change: add-worktree-spawn-dialog.
 */

/**
 * Convert a branch name into a filesystem-safe slug suitable for use as
 * a directory name under `.worktrees/`.
 *
 *   feat/Dark Mode!   → feat-dark-mode
 *   release/2026.05   → release-2026.05
 *   WIP: try a thing  → wip-try-a-thing
 *
 * Empty / all-stripped input yields `""` — callers SHOULD treat that
 * as a validation failure rather than fabricate a path.
 */
export function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[\/\\:\s]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Strip a remote prefix from a branch ref to get the local branch name
 * git would DWIM-create.
 *
 *   localNameOf("origin/foo") === "foo"
 *   localNameOf("foo")        === "foo"
 *   localNameOf("upstream/x")  === "x"
 *
 * Only the first path segment is treated as the remote. Branch names
 * that legitimately contain slashes (`feat/bar`) keep everything after
 * the first segment when that first segment looks like a remote — we
 * can't distinguish `origin/feat/bar` from a local `feat/bar` purely
 * lexically, so the rule is: drop the first segment iff the ref is of
 * the shape `<remote>/<rest>` AND has no other interpretation here.
 * Callers only pass either a bare local name or an `origin/<x>`-shaped
 * remote ref, so first-segment stripping is safe for this feature.
 *
 * See change: worktree-checkout-existing-branch.
 */
export function localNameOf(ref: string): string {
  const slash = ref.indexOf("/");
  if (slash <= 0) return ref;
  return ref.slice(slash + 1);
}

/**
 * Resolve the local branch name used for a checkout-mode worktree, and
 * therefore the `.worktrees/<slug>` path slug derived from it.
 *
 * The decision rule that MUST stay identical on client and server:
 *   - `base` is an existing LOCAL branch → keep its full name, even when
 *     it contains a slash (`openspec/foo` → `openspec/foo`). Stripping
 *     would diverge from the path git actually creates.
 *   - otherwise `base` is a remote-tracking ref (`origin/foo`) → strip
 *     the remote prefix so git DWIM-creates `foo` and the worktree lands
 *     at `.worktrees/foo` (not `.worktrees/origin-foo`).
 *
 * `localNameOf` alone cannot distinguish a remote ref from a local
 * branch with a slash; the caller supplies the authoritative
 * local-branch verdict (server: `git show-ref`; client: branch-list
 * membership). Centralising the `? :` here stops the two sides drifting.
 *
 * See change: fix-worktree-checkout-local-slash-path.
 */
export function resolveCheckoutLocalName(base: string, baseIsLocalBranch: boolean): string {
  return baseIsLocalBranch ? base : localNameOf(base);
}

export interface ResolveDefaultBaseInput {
  /** Current HEAD branch in the parent repo, or `null` if detached. */
  currentBranch: string | null;
  /** All local branch names. */
  localBranches: ReadonlyArray<string>;
  /** All remote-tracking branch names (e.g. `origin/develop`). */
  remoteBranches: ReadonlyArray<string>;
}

export type ResolveDefaultBaseResult =
  | { ok: true; base: string }
  | { ok: false; error: "no_usable_base" };

/**
 * Pick a base branch for a new worktree:
 *   current (if attached + local) → develop → main → master → fail.
 * Local-first then `origin/<x>`. Detached HEAD falls through to named
 * candidates (never base-on-SHA).
 */
export function resolveDefaultBase(input: ResolveDefaultBaseInput): ResolveDefaultBaseResult {
  const { currentBranch, localBranches, remoteBranches } = input;
  const local = new Set(localBranches);
  const remote = new Set(remoteBranches);
  if (currentBranch && local.has(currentBranch)) {
    return { ok: true, base: currentBranch };
  }
  for (const candidate of ["develop", "main", "master"] as const) {
    if (local.has(candidate)) return { ok: true, base: candidate };
    if (remote.has(`origin/${candidate}`)) return { ok: true, base: `origin/${candidate}` };
  }
  return { ok: false, error: "no_usable_base" };
}
