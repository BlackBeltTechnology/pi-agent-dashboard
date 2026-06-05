# Design — Add worktree from pull request

## Context

The dashboard already shells out to `gh` for outbound PR creation. This change adds inbound PR listing + worktree checkout. The two genuinely unknown mechanics are:

1. **How to materialise a PR head into a fresh worktree** — especially for PRs from forks.
2. **Whether/how to support pushing back** to the PR after checkout.

Everything else (gh resolution, network guard, envelope conventions, typeahead shell) is established pattern. This document records the design decisions and the **spike** needed before implementation.

## Spike — PR-head → worktree checkout mechanic

**This spike MUST be resolved before writing `addWorktreeFromPr`.** Run it against a real GitHub repo with (a) a same-repo PR and (b) a fork PR.

### Candidate A — `gh pr checkout <N>` (cwd-mutating)

```
gh pr checkout 123          # in CWD: fetches head, creates local branch, switches
```

- ✅ Handles forks; configures push-back tracking config.
- ❌ Operates on the **current** working tree's HEAD — incompatible with "create a *new* worktree without touching the current one". Would require checking out in a throwaway dir first, then `git worktree add` from the resulting local branch. Two-step, racy, mutates current checkout.

### Candidate B — `refs/pull/<N>/head` fetch + `git worktree add` (preferred)

```
git fetch origin refs/pull/123/head:refs/pr/123     # GitHub exposes this for EVERY pr
git worktree add <path> -b pr-123 refs/pr/123        # composes with existing addWorktree()
```

- ✅ Works for **fork and same-repo** PRs uniformly — GitHub's `refs/pull/<N>/head` points at the PR head commit regardless of fork.
- ✅ Does **not** touch the current working tree. Composes directly with the existing `git worktree add` machinery in `addWorktree()`.
- ✅ Deterministic, scriptable, testable against a fixture.
- ❌ Does **not** configure push-back to the contributor's fork — you get the commits read-only. (Acceptable for the review/local-iteration scope; push-back is explicitly out of scope.)
- ⚠️ GitHub-specific (`refs/pull/*` convention). Already implied by the `gh` dependency.

### Spike questions to answer

- [ ] Does `git fetch origin refs/pull/<N>/head:<localref>` succeed for a **fork** PR with default `origin` config? (Expected yes — GitHub serves pull refs from the base repo's remote.)
- [ ] Can `git worktree add <path> -b <branch> <localref>` create a worktree at a fetched non-branch ref? Confirm the resulting worktree HEAD is the PR head commit.
- [ ] What is the right **local branch name**? `pr-<N>` (collision-proof, matches derived path) vs the PR's `headRefName` (familiar, but collides across forks sharing a branch name). **Leaning `pr-<N>`.**
- [ ] Behaviour when `pr-<N>` already exists locally (a re-checkout) — reuse, error `branch_exists`, or force-update? Reuse the existing `addWorktree` `branch_exists`/`branch_in_use` codes.
- [ ] Does the existing `.git/info/exclude` housekeeping in `addWorktree` apply unchanged?

**Decision gate:** adopt **Candidate B** unless the spike reveals a blocker (e.g. fork pull refs unreachable without auth headers `gh` injects). If B fails, fall back to A with a throwaway-checkout wrapper and document the trade-off.

### Spike outcome (resolved)

**Candidate B confirmed.** Tested against `BlackBeltTechnology/pi-agent-dashboard` with:
- Same-repo PR (#77): `git fetch origin refs/pull/77/head:refs/pr/77` + `git worktree add <path> -b pr-77 refs/pr/77` — works.
- Fork PR (#22, `isCrossRepository: true`): same command sequence — works. GitHub serves `refs/pull/<N>/head` from the base repo for fork PRs.
- Local branch name: `pr-<N>` (collision-proof, matches derived path).
- Re-checkout collision: path-exists or branch-exists error; reuses existing stable codes.
- `.git/info/exclude` housekeeping applies unchanged.

## Decision — endpoint shape

**New endpoint `POST /api/git/worktree/from-pr`** rather than overloading `POST /api/git/worktree`.

Rationale:
- The existing `/api/git/worktree` validates `base` + `newBranch` as required strings. A `prNumber` source is mutually exclusive — overloading muddies the validation contract with "exactly one of {base+newBranch, prNumber}" branching.
- A dedicated route gets a clean envelope: `{ cwd, prNumber, path? }` in, `{ path, branch, prNumber }` out.
- Mirrors the existing `/api/git/worktree/pr` (outbound) naming.

The handler reuses `addWorktreeFromPr`, which returns the same `AddWorktreeSuccess | AddWorktreeFailure` union as `addWorktree`, so HTTP-status mapping is shared (409 for `branch_exists`/`path_exists`, 400 for `not_a_repo`/`base_not_found`, etc.) plus PR-specific codes (`pr_not_found`, `gh_not_authed`).

## Decision — `gh`-unavailable gating

The dialog probes availability lazily: on opening the "Create" section it does NOT eagerly call the PR endpoint. The "From a pull request" toggle is rendered optimistically; the **first** activation triggers `GET /api/git/pull-requests`. If that returns `gh_not_found` / `gh_not_authed`, the toggle is disabled with an inline hint ("Install/authenticate `gh` to checkout PRs") rather than a hard error. This avoids a network round-trip on every dialog open while still degrading gracefully.

Alternative considered: probe `gh` availability once via a cheap `/api/git/gh-status` endpoint at dialog mount. Rejected for now — adds a round-trip and a new endpoint for a marginal UX gain; revisit if the lazy approach feels janky.

## Decision — `PrCombobox` reuse boundary

`PrCombobox` reuses `BranchListbox`'s **keyboard primitives** (`useBranchListboxKeyboard`-style highlight/Enter/Arrow handling) and popover chrome, but **not** its row renderer — a PR row (`#N · title · @author · CI badge`) is structurally richer than a branch name. The shared piece is the generic "filterable highlightable list with keyboard nav"; the row renderer is per-domain. If during implementation the shared surface proves thin, accept mild duplication over a forced abstraction (per project simplicity-first rule).

## Data shape

```ts
interface PullRequestInfo {
  number: number;
  title: string;
  headRefName: string;        // PR head branch name (may collide across forks)
  headRefOid: string;         // head commit SHA — disambiguates
  author: string;             // login
  isDraft: boolean;
  isCrossRepository: boolean;  // true => fork PR
  checkRollup: "passing" | "failing" | "pending" | "none";  // derived from statusCheckRollup
}
```

`checkRollup` is derived server-side from `gh`'s `statusCheckRollup` array (collapse the per-check states to one summary) so the client renders a single badge without re-implementing GitHub's rollup logic.

## Open questions (carry into implementation review)

- **Push-back support** — out of scope here, but if later needed, fork PRs require `gh pr checkout`'s remote config. A future change could add a "configure push" step post-checkout. Flag in the spec as a known limitation.
- **PR list size** — `--limit 100`. Repos with >100 open PRs truncate. Is server-side filter-as-you-type (`gh pr list --search`) needed, or is client-side filter over 100 enough? Default to client-side; revisit.
- **Caching** — should the PR list cache for the dialog's lifetime, or refetch on each open? Lean: fetch once per dialog-open, manual refresh button. No background polling.
