# Widen File-Read Containment to the Resolved Checkout

> Change 3 of 3. Depends on `add-git-checkout-root-resolver` (shipped).
> Design and spec deltas are in `design.md` / `specs/`; the
> `doubt-driven-review` + `security-hardening` gate is tasks §1 and must land
> before any code in tasks §2–§5.

## Why

`packages/server/src/lib/path-containment.ts` keeps its own inline fail-closed
guard, `basename(commonDir) === ".git"` (line 94), and derives the containment
root with `dirname()`. `add-git-checkout-root-resolver` deliberately did NOT
convert it.

That was not an oversight. As a *classifier* the basename test is invalid — it
calls a worktree-of-submodule and a worktree-of-bare "not worktrees" (measured).
As a fail-closed *containment* test it is still sound: it under-approximates, so
it denies reads it should allow rather than allowing reads it should deny.

Converting it therefore **WIDENS a security boundary**: a submodule or
`--separate-git-dir` session goes from cwd-only reach to its whole own checkout.
A widening needs its own spec deltas, its own review, and its own tests — not a
line changed in passing while fixing a display bug.

## What Changes

- Anchor file-read containment on the resolver's `thisCheckout` AND
  `mainCheckout` (equal for every non-worktree state; both needed for a linked
  worktree so the existing worktree→main-checkout reach survives) instead of
  `dirname(--git-common-dir)`, so a submodule / `--separate-git-dir` session may
  read its OWN checkout. Each anchor is first BOUND to the repository (below).
- Expose the resolver's `commonDir` (identity only, never an anchor) and an
  async wiring of the same resolver, so the file route does not block.
- **Both `file-read-containment` requirements currently mandate `dirname()`**, so
  both need MODIFIED deltas — the code cannot simply be changed under them.
- Add tests for the widened states. The current suite builds only the non-repo
  and bare cases inline; the shared
  `packages/shared/src/test-support/git-fixtures.ts` builder now covers all nine
  and should be reused.

## Carried forward from change 1's review (load-bearing)

The resolver returns a user-controlled `core.worktree` **verbatim** and does not
judge it. Change 1's consumers reject only the *inside a git dir* case (the
`.git`-segment test). A `core.worktree` pointing **OUTSIDE the repository** is
NOT rejected there.

That was reviewed and accepted for the kb guard, because it opens the store at
the request's own `cwd`, bounding reach to the requester's own files.
**This change must not inherit that reasoning.** Containment is a file-READ
boundary where the same case costs far more, so it owns an explicit
outside-the-repository check.

### Also carried forward: bind the kb guard's anchor to the repository

Change 1's review raised the same gap against `isAllowedCwd` itself: a linked
worktree can set repository-local `core.worktree` to an unrelated KNOWN folder
and thereby admit an otherwise-unknown request `cwd`. It was accepted for change
1 on the bounded-reach argument above (the store opens at the request's own
`cwd`), and because closing it properly means *binding* `mainCheckout` to the
repository — re-resolving the claimed main checkout and requiring it to point
back at the same common dir — which is up to five new probes on an
authorization request path (design D4 re-budgets the guard to hold its 2 s
ceiling), not a line change.

This change SHALL settle it for both consumers at once, so the guard and
containment do not diverge on what "the repository owns this path" means. A
`security-hardening` pass covers it; the bounded-reach argument SHALL be
re-tested, not re-assumed, because `reindexAll` follows a cwd-local
`knowledge_base.json` whose `resolvedSources` need not stay under that cwd.

## Coordination

`add-access-grants-and-review` (planned, unshipped) also carries a MODIFIED
delta on the `file-read-containment` layered-check requirement (it adds a layer
3 and freezes per-site anchor sets). The two are compatible: this change alters
how layer 2 DERIVES an anchor's checkout roots, not which anchors a site passes.
Whichever change archives second re-derives its delta on the then-current main
spec (tasks 5.4).

## Impact

- `packages/server/src/lib/path-containment.ts` + `__tests__/path-containment.test.ts`.
- MODIFIED deltas for all four `file-read-containment` requirements (the third and fourth only re-word "git common root" → bound checkout roots and correct the site enumeration; no `system-routes` site exists).
- `packages/shared/src/platform/git.ts`: `commonDir` field, `checkoutRootsAsync`,
  shared `isBoundCheckout` — MODIFIED delta for `git-checkout-root-resolution`'s
  *three distinct facts* requirement plus an ADDED *repository binding*
  requirement.
- `packages/kb-plugin/src/server/kb-routes.ts` (`isAllowedCwd`) +
  `__tests__/kb-routes.test.ts` — the SAME repository-binding rule, so the guard
  and containment cannot diverge on what "the repository owns this path" means.
- MODIFIED delta for `kb-plugin-cwd-guard`'s *Git-repo-main admission* requirement.

## Discipline Skills

- `security-hardening`: this change is a deliberate WIDENING of a file-read
  boundary. The pass must enumerate what becomes readable in each of the nine git
  states and confirm no state gains reach outside its own checkout.
- `doubt-driven-review`: required BEFORE implementation, and specifically against
  the widening. Change 1's cycle 2 already caught "a security widening wrongly
  asserted to be behaviour-preserving" in an earlier draft of this very work.
- `review-code`: standard pre-commit review over the diff.
- `performance-optimization` not triggered: containment already probes git on a
  path that does disk I/O.
- `observability-instrumentation` not triggered: no new endpoint, job, or
  external call.
