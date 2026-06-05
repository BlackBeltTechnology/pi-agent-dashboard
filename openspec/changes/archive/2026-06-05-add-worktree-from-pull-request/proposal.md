# Add "From a pull request" creation mode to the Worktree dialog

## Why

The dashboard's GitHub integration today is **outbound only**: `createPullRequest()` (`git-operations.ts:767`) shells out to `gh pr create` to open a PR *from* a worktree branch, and the UI tracks `session.gitPrNumber` + an "Open PR #N in browser" action. There is **no inbound** path — nothing lists existing PRs or lets you check one out.

A common workflow is missing: **"review or continue work on an existing PR in a fresh worktree."** Today the user must drop to a terminal (`gh pr checkout 123`), find the branch name, then come back and spawn a worktree from it — or give up on worktree isolation entirely. This change adds a "From a pull request" creation mode to `WorktreeSpawnDialog`: pick an open PR from a typeahead, and the dialog creates an isolated worktree checked out at that PR's head.

The hard infrastructure already exists and is reused:

- `gh` binary resolution via `getDefaultRegistry().resolve("gh")` (used at `git-routes.ts:515`).
- The `networkGuard` preHandler on all `gh`/network routes.
- The `gh`-stderr → stable-code mapping helper pattern (`mapPrStderr` in `git-worktree-lifecycle.ts:99`).
- The `git worktree add` orchestration in `addWorktree()` (`git-operations.ts`).
- The typeahead component family extracted by the **`worktree-base-branch-typeahead`** change (`BranchListbox` + `useBranchListboxKeyboard`). The PR picker is a sibling combobox reusing that presentational shell.

**This change depends on `worktree-base-branch-typeahead` landing first** (for the reusable `BranchListbox` shell). If that change is not yet applied, `PrCombobox` falls back to a self-contained list (noted in tasks).

## What Changes

### Server

- **New helper** `listPullRequests(cwd, ghPath)` in `git-operations.ts` — runs `gh pr list --json number,title,headRefName,headRefOid,author,isDraft,isCrossRepository,statusCheckRollup --limit 100`, parses to typed `PullRequestInfo[]`. Maps `gh` failures to the existing stable codes (`gh_not_found`, `gh_not_authed`, `no_remote`).
- **New endpoint** `GET /api/git/pull-requests?cwd=…` — `networkGuard` + `gh`-resolution, mirrors the envelope conventions of `POST /api/git/worktree/pr`. Returns `{ success: true, data: PullRequestInfo[] }` or a stable-code failure envelope.
- **New helper** `addWorktreeFromPr(opts)` in `git-operations.ts` — fetches the PR head ref into the repo and creates a worktree at it. **The exact fetch+checkout mechanic is the subject of a spike — see `design.md`.** The leading candidate is GitHub's universal `refs/pull/<N>/head` ref (works for fork and same-repo PRs without remote reconfiguration), which composes with the existing `git worktree add` machinery. Returns the same `AddWorktreeSuccess | AddWorktreeFailure` discriminated union as `addWorktree()` so the route maps cleanly.
- **Endpoint extension** — either extend `POST /api/git/worktree` to accept an optional `prNumber` (mutually exclusive with `base`/`newBranch`), OR add `POST /api/git/worktree/from-pr`. Decision deferred to `design.md` (leaning new endpoint for a clean envelope and validation contract).

### Client

- **New component** `PrCombobox` in `packages/client/src/components/` — controlled typeahead over `PullRequestInfo[]`, reusing `BranchListbox`'s presentational shell where shape allows. A PR row renders `#<number>`, title, author, and a CI/draft badge. Filter matches against number + title + branch. Loading / error / empty / `gh-unavailable` states (PR data is a network fetch, unlike local branch listing).
- **Dialog mode toggle** — the "Create a new worktree" section gains a source selector: **From a branch** (today's base + new-branch fields) vs **From a pull request** (the `PrCombobox` + derived path). The "From a pull request" option is **hidden entirely** when `gh` is unavailable (probed via the new endpoint's `gh_not_found` envelope), never shown as a dead control.
- **Derived path** — for PR mode, the worktree path derives from the PR (e.g. `<repo>/.worktrees/pr-<number>` or the slugified head ref). Editable via the existing Path input.

### Tests

- Server: `listPullRequests` JSON-parse + error-mapping unit tests (mock `gh` output); `addWorktreeFromPr` mechanic tests against a fixture repo (incl. a simulated fork PR ref); route contract tests for the new endpoint(s) covering `gh_not_found` / `gh_not_authed` / success.
- Client: `PrCombobox` tests (loading/error/empty/gh-unavailable, filter, keyboard select); `WorktreeSpawnDialog` tests for the mode toggle, gh-unavailable hiding, and the PR-mode `onSpawn` payload.

## Capabilities

### Modified Capabilities

- `git-operations-api` — adds the **List pull requests endpoint** Requirement and the **Create worktree from pull request** Requirement.
- `worktree-spawn-dialog` — adds the **From-a-pull-request creation mode** Requirement (mode toggle, `PrCombobox`, gh-unavailable gating, derived path).

## Impact

- **New capability, not a refactor** — introduces inbound PR data flow. Bigger than the typeahead change.
- **Depends on `worktree-base-branch-typeahead`** for the reusable `BranchListbox` shell. Sequence: typeahead → this.
- **Network + auth surface** — `gh pr list` is a network round-trip (slow, rate-limitable, auth-gated) unlike the instant local `git branch`. The UI owns loading/error/retry states the branch combobox does not.
- **`gh` optional** — the mode self-hides when `gh` is absent or unauthenticated. No dead controls.
- **Fork PRs** — the mechanic must handle PRs from forks (head ref not in your `origin` branch namespace). This is the primary reason for the spike (see `design.md`).
- **No persistence/protocol-version change** — purely additive REST endpoints + client UI. `GitWorktreeInfo` / session shapes unchanged. Older clients ignore the new endpoint.
- **Rollback** — additive. Revert removes the endpoint(s), helper(s), and `PrCombobox`; the dialog reverts to branch-only creation. No migration.
- **Out of scope**:
  - **Pushing back to a fork PR** — the spike's `refs/pull/N/head` candidate gives read access to PR commits but does NOT configure push-back to a contributor's fork. "Continue work and push to the PR" is a follow-on; this change targets review/local-iteration. Captured as an open question in `design.md`.
  - **Non-GitHub forges** — relies on `gh` and GitHub's `refs/pull/*` convention. GitLab/Bitbucket out of scope.
  - **PR status polling / live CI updates** — the badge reflects a point-in-time `gh pr list` snapshot. No subscription.
  - **Filtering by author/label/state** — initial version lists open PRs only. Advanced filters are a follow-on.
  - **Reusing `BranchCombobox` verbatim** — PR rows are richer than branch names; `PrCombobox` is a sibling, sharing only the `BranchListbox`/keyboard primitives where shape allows.
