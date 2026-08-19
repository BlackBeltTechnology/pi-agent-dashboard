## Context

`WorktreeSpawnDialog` §1 renders a raw, uncapped dump of `GET /api/git/worktrees`.
On the reference repo that is 8 rows, 5 of them machine-generated (4 detached
`.worktrees/ab-impl/*` from the A/B harness, 1 detached out-of-tree
`/private/var/folders/…/tmp.*` from the docker harness). The 2 rows a human wants
(plus main) are buried.

Removal has no session-less entry point. The only path to
`POST /api/git/worktree/remove` is `SessionCard → WorktreeActionsMenu →
CloseWorktreeDialog`, so a worktree whose session already ended — exactly the
abandoned ones that accumulate — is unremovable from the UI.

Constraints discovered while grounding:

- `POST /api/git/worktree/remove` already accepts any `cwd`. It touches
  `sessionManager` **twice**: the `409 active_sessions` guard *and* — on success —
  a `cwdMissing: true` stamp plus a `browserGateway.broadcastSessionUpdated`
  fan-out over every session under the path (`git-routes.ts:641-648`).
- `validateCwd` calls `fs.statSync` and returns `400 cwd_invalid` for a path that
  does not exist, **before** any git command runs (`git-routes.ts:896-917`).
- `RemoveCode` already contains `branch_not_merged`, meaning the *removal*
  failed; `CloseWorktreeDialog.tsx:60` auto-ticks `--force` and retries on it.
- `parsePorcelainWorktrees` sets `branch: null` for **both** detached and `bare`
  entries (`git-worktree.ts:63-92`).
- The §1 row is itself a `<button>` (`WorktreeSpawnDialog.tsx:461`), and that
  file uses `i18nT` 22 times.
- `CloseWorktreeDialog` already takes `{ cwd, allSessions, onShutdownSession }` —
  it is `cwd`-driven, not session-driven.
- `removeWorktree()` in `git-operations.ts` has no branch handling;
  `mergeWorktree()` already carries `deleteBranch` and is the shape to copy.
- No prune capability exists anywhere.
- The mockup loop (`mockups/ux-review.md`) measured the shipped §1 row as a
  **pre-existing WCAG-AA contrast failure**: branch in `--text-tertiary`
  (4.28:1 light) and path in `--text-muted` (2.59:1 dark).

## Goals / Non-Goals

**Goals:**

- One shared `WorktreeList` component behind both surfaces, so filter and row
  rendering cannot drift apart.
- A default view that suppresses harness noise **without ever silently dropping
  a row** — hidden counts always visible.
- A session-less removal entry point reusing the existing escalation dialog
  verbatim.
- Bulk removal, prune, and optional branch deletion.
- Fix the contrast defect while the row is being rewritten anyway.

**Non-Goals:**

- No change to worktree *creation* (§2 of the spawn dialog is untouched).
- No new design token. The surface is expressible in the shipped palette.
- No server-side escalation logic. `active_sessions` / `dirty_worktree` recovery
  stays client-driven, exactly as `CloseWorktreeDialog` does it today.
- No merge/push/PR changes. Only `remove` grows an option.
- Not a general worktree "dashboard" — no per-worktree diff stats, ahead/behind,
  or last-activity columns.

## Decisions

### D1 — Filter is client-side, derived from the existing `WorktreeEntry`

Every predicate comes from fields already on the wire (`path`, `branch`, `sha`,
`bare`, `detached`, `isMain`). `inTree` is derivable because the main worktree's
own path ships in the same array: `path.startsWith(main.path + "/.worktrees/")`.

Separators are **normalised before comparison** (`\` → `/`). `WorktreeSpawnDialog`
already carries a `joinPath` comment conceding its `/` default is "slightly off
on Windows", and the repo ships per-OS QA under `qa/`. Without normalisation a
Windows porcelain path would make every row `inTree === false`, collapsing the
default view to the main worktree alone.

Text matching guards `branch: string | null` — bare and detached entries have a
null branch and must not throw on a query.

*Alternative considered:* add an `inTree`/`kind` field server-side. Rejected — it
puts a client presentation concern in the protocol, requires a `shared` type
change and a server round-trip for a value the client already holds, and would
have to be versioned for older bridges.

### D2 — Default predicate `isMain || (!detached && inTree)`, with mandatory visible counts

Hides 5 of 8 rows on the reference repo (Hick's Law).

The hard constraint is **not** that this server creates detached worktrees — it
does not. Checkout mode resolves a local branch name precisely because passing
`origin/foo` verbatim "would yield a DETACHED HEAD, not a tracking branch"
(`git-operations.ts:565-570`), and PR mode always passes `-b`
(`git-operations.ts:1645`). The constraint is that detached rows arrive from
sources outside this server's control — external harnesses, manual
`git worktree add`, other tooling on the same repo — and the filter cannot tell
noise from signal by provenance. The chip therefore always renders a live count
and states the action (`+ detached 5` / `− detached 5`) so the number cannot be
misread as "5 shown".

*Alternative considered:* hide by path pattern (`ab-impl/`, `/tmp/`). Rejected —
encodes this repo's harness layout into a general component.

*Alternative considered:* no default filter, just a search box. Rejected — the
reported symptom is the *default* view being unusable; a filter the user must
type into every time does not fix it.

**Chip coverage is an invariant, not a list of chips.** The default predicate
excludes on two independent axes (`detached`, `!inTree`), and a row can sit in
both. The rule is: *every hidden row is revealable by at least one chip*, and the
`N of M shown` count is a union, not a sum of chip counts. A **non-detached
out-of-tree** row is the case that proves it — reachable today via the spawn
dialog's free-text `pathOverride` field — and it must appear in the test fixture,
which otherwise only covers detached out-of-tree.

### D3 — Manage surface is a `Dialog size="lg"` with internal scroll, opened from `FolderActionsMenu`

A new `manage-worktrees` item in the `directory` group of `FOLDER_MENU_GROUPS`
(built in `SessionList`). Matches every other worktree surface, reuses
`DialogPortal`'s mobile-sheet behaviour, and keeps the diff to a component plus
one menu entry.

*Alternative considered:* a route under `/folder/:cwd/worktrees` — linkable and
survives refresh, with room to grow. Rejected for v1: it needs URL codec work
(`folder-path-url-codec`), a route registration, and a page shell, for a surface
used episodically. Recorded as a follow-up if the list outgrows a dialog.

### D4 — `remove-batch` returns per-item results; escalation stays client-side

`POST /api/git/worktree/remove-batch` processes every item and returns one result
per input in input order, each carrying the same stable `RemoveCode` the single
endpoint returns. It does **not** abort on first failure.

This is the compromise that makes the batch endpoint viable: the client keeps the
`active_sessions → shut down → retry with force` and `dirty_worktree → --force`
recovery it already implements in `CloseWorktreeDialog`, and applies it per
failed row. A batch endpoint that owned escalation would have to re-implement
session shutdown server-side.

*Alternative considered:* a client-side sequential loop over the existing single
endpoint. Functionally equivalent and zero new server surface, but N round-trips
and no single point to enforce per-item containment.

**The batch MUST replicate the `cwdMissing` side effect.** The single endpoint's
success path stamps `cwdMissing: true` and broadcasts `sessionUpdated` for every
session under the removed path. A batch that skips this leaves sessions rendering
as healthy over a directory that no longer exists. This is the hidden coupling in
"reuse the existing endpoint's logic" — the removal is not the whole operation.

**The batch is capped at 50 items.** `removeWorktree` uses `execSync`, so N items
are N blocking git invocations (2N with `deleteBranch`) inside one handler, on a
server also hosting two WebSocket servers. An uncapped caller-supplied array is a
self-inflicted stall. 50 is far above any realistic worktree count and far below
a meaningful stall. The cap is a **server-side guard, not a client contract**:
the client does not learn or mirror the number (that would be a duplicated
constant across layers with no protocol field to carry it), it simply surfaces
the stable rejection code if it ever trips.

**Batch item results are NOT plain `RemoveCode`.** `active_sessions` is a
*route-level* 409 carrying `data.sessionIds` — it is not a member of `RemoveCode`
(`git-worktree-lifecycle.ts:17-23`). Since D4 requires per-row `active_sessions`
escalation, each batch item result carries `code: RemoveCode | "active_sessions"
| "cwd_invalid" | "is_main_worktree"` plus `sessionIds?: string[]` on the
`active_sessions` case. Without this the per-row recovery path is unimplementable
from the spec.

### D5 — `deleteBranch` uses `git branch -d`, never `-D`, and never fails the removal

Removal from a cleanup list is a coarse, bulk-shaped gesture; force-deleting
unmerged work from it is unrecoverable. `-d` refuses an unmerged branch. The
worktree is still removed and the response reports `branchDeleted: false` with a
`branch_not_merged` reason — the destructive part the user asked for succeeds,
the irreversible part they did not think about is refused.

Mixed selections need no UI restriction: `deleteBranch` applies **per row**, and
a detached row simply skips the `git branch` invocation and reports
`branchDeleted: false`. No checkbox disabling, no "3 of 5 have one" copy.

*Alternative considered:* `-D` with a second confirmation. Rejected — adds a
modal to a flow that already has one, to enable an outcome with no undo.

**The branch outcome gets its own code space — this is load-bearing.**
`branch_not_merged` is *already* a `RemoveCode` meaning the removal failed, and
`CloseWorktreeDialog.tsx:60` responds to it by auto-ticking `--force` and
retrying. Reusing the string for "removed fine, branch refused" would make the
client force-retry an already-successful removal — which then hits `validateCwd`
on a directory that no longer exists and returns a baffling `400 cwd_invalid`
(see D8). The response therefore carries `branchDeleted: boolean` plus
`branchDeleteCode` in a namespace disjoint from `RemoveCode`, enumerated as:

```
type BranchDeleteCode = "deleted" | "unmerged" | "no_branch" | "branch_gone" | "delete_failed"
```

`"unmerged"` deliberately does not reuse the `branch_not_merged` spelling, and
the generic failure is `"delete_failed"` rather than `"git_failed"` — which IS a
`RemoveCode` value — so the two namespaces are genuinely disjoint and no client
predicate can match across them by accident. Note this
diverges from `mergeWorktree`, whose own `deleteBranch` refusal reports no code
at all — "mirror `mergeWorktree`" describes the *option*, not its (weaker)
reporting.

**The branch name must be captured BEFORE removal.** `removeWorktree` currently
never reads it, and after the worktree is gone it cannot be recovered from the
entry.

**The skip condition is `branch == null`, not `detached`.** The porcelain parser
nulls `branch` for `bare` entries too, so keying on `detached` alone would run
`git branch -d null` on a bare worktree.

### D6 — Contrast fix is in scope, and is a deliberate visible change

The failures are **per theme**, not blanket: `--text-muted` measures 2.59:1 on
dark, and `--text-tertiary` measures 4.28:1 on **light** (on dark it reaches
≈4.67:1 and passes). Since a token must clear AA in *both* themes, both are
disqualified for row text. The extracted row renders branch in `--text-primary`
and path in `--text-secondary`. Because the row is being rewritten regardless,
fixing it here costs nothing; leaving it would ship a known AA failure in new
code.

This is a *visible restyle of a shipped surface*, not a silent refactor, and is
called out as its own task rather than folded into the extraction.

### D7 — Path rendering: strip the constant prefix, elide by segment in JS

`.worktrees/` prefixes every in-tree row identically — no per-row information,
while consuming the width that distinguishes `ab-impl/auth-redirect-gaps` from
`ab-impl/ctrl-recommended`. Stated once in the section hint. The path line is
suppressed entirely when it equals `slugifyBranch(branch)` (already in
`shared/src/git-worktree-helpers.ts`), since it would restate the branch.

Long out-of-tree paths elide **in JS by path segment**. CSS `direction:rtl` is
forbidden here: bidi reordering relocates leading punctuation and renders
`.worktrees/x` as `worktrees/x.`, silently corrupting the identifier the user
reads.

Suppression is a **conservative equality check gated on `inTree`**:

```
suppress ⇔ inTree && branch != null && basename(path) === slugifyBranch(branch)
```

The `inTree` gate is the load-bearing part. `slugifyBranch` collapses `/` → `-`
(`git-worktree-helpers.ts:25-32`), so a `feat/bar` checkout lands in a *single*
segment `feat-bar`, not a nested directory; and PR mode checks out branch
`pr-<N>` into `.worktrees/pr-<N>` (`git-operations.ts:1601-1602`). Both therefore
satisfy the equality — suppression is the **normal** case for every
server-derived in-tree row, not a fork-mode special case.

The case that must NOT suppress is an out-of-tree row created via the spawn
dialog's free-text `pathOverride` (e.g. `~/scratch/my-feature` on branch
`my-feature`): the basename matches by coincidence, but the path is the row's
only unique key and the directory is somewhere the user cannot infer. `inTree`
excludes it. `branch != null` guards the detached/bare rows, where
`slugifyBranch(null)` would throw — and detached is this repo's dominant case.

### D8 — Vanished-directory rows route to `prune`, never `remove`

`git worktree list` reports registrations whose directory is gone, so they render
in the list — and they are precisely the abandoned junk the manage surface
exists to clear. But `validateCwd` rejects a nonexistent path with
`400 cwd_invalid` before git runs, so `remove` can *never* clear them. Without
this decision the surface fails at its headline job for the worst-affected rows,
and the user gets an unexplained 400 on the ✕ that looks like a bug.

The list marks such rows `missing`, replaces their ✕ with a prune affordance, and
excludes them from batch selection. `GET /api/git/worktrees` is extended with a
per-entry `exists: boolean` — the one place this change *does* touch the wire,
because directory existence is not derivable client-side.

**Missing is `exists === false`, never falsy.** Under this change's own per-layer
rollback (and under `--dev`, where a new client can pair with an older server) a
new client will see `exists: undefined` on every row. A falsy test would then
mark every worktree missing and disable every remove control — the surface would
silently stop working. Absent means "unknown, treat as present".

**Prune is repo-global, and the copy must say so.** `git worktree prune` clears
*every* stale registration in the repo, not the one row its affordance sits on.
The row-level control is a discovery affordance for a repo-level operation; it
reports how many registrations were cleared.

`WorktreeEntry` is declared twice — `packages/server/src/git-worktree/git-worktree.ts:30`
(server-only by its own header) and mirrored at
`packages/client/src/lib/git/git-api.ts:144`. There is no shared declaration;
both sites must be widened.

*Alternative considered:* let the ✕ 400 and show the error. Rejected — it
surfaces an implementation detail as a dead end.

### D9 — Manage-mode rows are not `<button>` wrappers

Spawn mode's whole-row click target is a `<button>` (`WorktreeSpawnDialog.tsx:461`).
Manage mode nests a checkbox and a ✕ inside the row, and interactive elements
cannot legally nest inside a button — it is invalid HTML and breaks keyboard and
AT traversal. Manage rows therefore use a non-button container with explicitly
focusable controls; only spawn mode keeps the whole-row button.

## Risks / Trade-offs

**A legitimately created detached worktree is hidden by default** (PR/checkout
mode produces detached HEAD) → the chip renders a live count and the list header
reads `N of M shown`; any scenario asserting the default filter must also assert
the count is visible. Never a silent drop.

**`remove-batch` accepts a caller-supplied array of paths** → each item runs the
same `validateCwd` + main-worktree resolution the single endpoint runs, per item,
under the same `networkGuard`. A malformed item fails that item only. The main
worktree is rejected as an item.

**Prune is a mutating git command with no confirm** → `git worktree prune` only
removes registrations whose directory is already gone; it cannot touch a live
worktree or any file. Reporting the pruned count is enough feedback.

**Extraction changes a shipped surface's colors** (D6) → called out as its own
task and its own spec scenario, so it lands as an intended change rather than
review surprise.

**Two dialogs can now target the same `cwd`** (`WorktreeActionsMenu` and the
manage surface) → both mount the same `CloseWorktreeDialog`; removal is
idempotent at the git level (`not_a_worktree` on the second attempt) and the
existing `cwdMissing` broadcast already fans out to every session under the path.

**Removal is NOT idempotent at the endpoint the UI calls** — `validateCwd`
rejects a vanished directory with `400 cwd_invalid` before git runs, so the
`not_a_worktree` path is unreachable for an already-removed worktree. Two dialogs
targeting the same `cwd`, a stale row, and any per-row retry all land on that
400. Mitigated by D8 (`exists` flag + prune routing) and by treating
`cwd_invalid` on a removal retry as "already gone" rather than an error.

**Trade-off accepted:** the manage surface is not linkable or refresh-surviving
(D3). Revisit if the list outgrows a dialog.

**Trade-off accepted:** `exists` on `GET /api/git/worktrees` adds a `statSync`
per entry per fetch. Bounded by worktree count (single digits), and the endpoint
is already `execSync`-bound by `git worktree list`.

## Migration Plan

No data migration, no persisted state, no protocol version bump. Every new
endpoint is additive; `deleteBranch` is an optional body field whose absence
preserves today's behaviour exactly. The one wire change is an **additive**
`exists` field on `GET /api/git/worktrees` entries (D8); an older client ignoring
it degrades to today's behaviour.

Rollback is per-layer:

- Client only → revert `WorktreeList` + the menu item; the new endpoints go
  unused and harmless.
- Server only → the two new routes are additive; removing them 404s features the
  old client never calls.

Ordering: server endpoints first (independently testable via the existing git
worktree integration-test harness), then the shared component, then the two host
surfaces.

## Open Questions

- Should `prune` be exposed at all when nothing is prunable, or hidden until the
  server reports a stale registration? Currently always visible, reporting
  "Nothing to prune". Leaning: keep it visible — a control that appears only when
  broken is undiscoverable (recognition over recall).
- Does the contrast fix (D6) warrant a follow-up sweep of the other surfaces
  using `--text-muted` for text? Out of scope here; worth a separate change.
