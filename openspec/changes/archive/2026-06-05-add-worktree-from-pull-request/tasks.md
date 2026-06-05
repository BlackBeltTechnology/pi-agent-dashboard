# Tasks

> **Prerequisite:** `worktree-base-branch-typeahead` should be applied first (provides the reusable `BranchListbox` + `useBranchListboxKeyboard` shell). If not yet applied, build `PrCombobox` self-contained and note the follow-up to share primitives.

## 0. Spike — resolve the checkout mechanic (BLOCKING)

- [x] 0.1 Run the spike in `design.md` against a real GitHub repo with a same-repo PR and a fork PR. Confirm Candidate B (`git fetch origin refs/pull/<N>/head:<ref>` + `git worktree add`) works for both, including fork PRs with default `origin` config.
- [x] 0.2 Decide the local branch naming (`pr-<N>` leaning) and the re-checkout collision behaviour (reuse existing `branch_exists`/`branch_in_use` codes).
- [x] 0.3 Record the outcome in `design.md` ("Decision gate"). If Candidate B fails, document the Candidate A fallback chosen. **Do not start §2 until this is closed.**

## 1. Shared types

- [x] 1.1 Add `PullRequestInfo` (shape in `design.md`) to `packages/shared/src/` (locate the git/worktree types module via `grep -rn "GitBranchEntry\|GitWorktreeInfo" packages/shared/src`). Export from the same barrel as the existing git types.
- [x] 1.2 Add the request/response envelope types for the new endpoint(s) to `packages/shared/src/rest-api.ts` (or wherever `ApiResponse` and the git route payloads live).

## 2. Server — list pull requests

- [x] 2.1 In `packages/server/src/git-operations.ts`, add `listPullRequests(opts: { cwd: string; ghPath: string }): { ok: true; data: PullRequestInfo[] } | { ok: false; code: "gh_not_authed" | "no_remote" | "git_failed"; stderr?: string }`. Shell out: `gh pr list --json number,title,headRefName,headRefOid,author,isDraft,isCrossRepository,statusCheckRollup --limit 100`. Parse JSON; derive `author` from `.author.login`; collapse `statusCheckRollup` → `checkRollup` summary. Map gh stderr → stable codes (reuse the `mapPrStderr`-style helper from `git-worktree-lifecycle.ts`, extend if needed).
- [x] 2.2 Add `GET /api/git/pull-requests` route in `packages/server/src/routes/git-routes.ts`: `preHandler: networkGuard`, `validateCwd`, resolve `gh` via `getDefaultRegistry().resolve("gh")` → `gh_not_found` envelope when absent (mirror the `/api/git/worktree/pr` block at line ~515). Map failure codes to HTTP status (401 `gh_not_authed`, 400 `no_remote`/`cwd_invalid`, 500 otherwise).
- [x] 2.3 Unit tests `packages/server/src/__tests__/` for `listPullRequests`: happy parse (incl. draft + cross-repo + each rollup state), empty list, malformed JSON, gh-stderr → code mapping. Mock the `gh` exec.
- [x] 2.4 Route contract test: `gh` absent → `gh_not_found` 400; success → `{ success: true, data: [...] }`; auth failure → 401.

## 3. Server — create worktree from PR

- [x] 3.1 In `git-operations.ts`, add `addWorktreeFromPr(opts: { cwd: string; prNumber: number; path?: string; ghPath: string })` implementing the **spike-decided** mechanic (Candidate B default): fetch `refs/pull/<N>/head` → derive local branch `pr-<N>` → `git worktree add <path> -b pr-<N> <fetched-ref>`. Reuse the repo-root resolution + `.git/info/exclude` housekeeping from `addWorktree` (extract a shared helper if duplication is non-trivial; otherwise call-through). Return the `AddWorktreeSuccess | AddWorktreeFailure` union plus PR codes (`pr_not_found`).
- [x] 3.2 Add `POST /api/git/worktree/from-pr` route: body `{ cwd, prNumber, path? }`, `networkGuard`, `validateCwd`, gh-resolution. Reuse `addWorktree`'s HTTP-status mapping; add `pr_not_found` → 404. Response `{ success: true, data: { path, branch, prNumber } }`.
- [x] 3.3 Tests against a fixture repo: same-repo PR checkout, simulated fork PR (pre-seed a `refs/pull/<N>/head` ref), re-checkout collision (`branch_exists`), `pr_not_found`. Verify worktree HEAD == PR head commit and the current working tree is untouched.

## 4. Client — PrCombobox

- [x] 4.1 Create `packages/client/src/components/PrCombobox.tsx`. Props: `cwd: string`, `value: PullRequestInfo | null`, `onChange: (pr: PullRequestInfo) => void`, `onGhUnavailable?: (code: "gh_not_found" | "gh_not_authed") => void`, `"data-testid"?: string`. Fetches `GET /api/git/pull-requests` on first open (lazy, per `design.md`). Owns loading / error / empty / gh-unavailable states.
- [x] 4.2 Reuse `useBranchListboxKeyboard` (or its generic equivalent) + popover chrome from the typeahead change for highlight/Arrow/Enter/Esc nav. Row renderer is PR-specific: `#<number> · <title> · @<author>` + a CI/draft badge derived from `checkRollup`/`isDraft`. Filter matches number + title + headRefName (case-insensitive).
- [x] 4.3 Tests `packages/client/src/components/__tests__/PrCombobox.test.tsx`: loading spinner, error state, empty list, `gh_not_found`/`gh_not_authed` → `onGhUnavailable` fired, filter narrows, Arrow+Enter selects, click selects, Esc closes popover without bubbling.

## 5. Client — dialog mode toggle

- [x] 5.1 In `WorktreeSpawnDialog.tsx`, add a source toggle to the "Create a new worktree" section: **From a branch** (existing base + new-branch + path) vs **From a pull request** (`PrCombobox` + derived path). Default to "From a branch".
- [x] 5.2 Gate the "From a pull request" toggle: render optimistically; on first activation, `PrCombobox` fetches. If `onGhUnavailable` fires, disable the toggle with an inline hint ("Install/authenticate `gh` to checkout PRs"). Per `design.md` (no eager probe at mount).
- [x] 5.3 PR-mode path derivation: default `<repo>/.worktrees/pr-<number>`, editable via the existing Path input. Wire submit to `POST /api/git/worktree/from-pr` with `{ cwd, prNumber, path }`. The branch-mode submit path is unchanged.
- [x] 5.4 Update `WorktreeSpawnDialog.test.tsx`: toggle switches field sets; gh-unavailable disables the PR toggle with hint; PR-mode submit posts the `from-pr` payload. Branch-mode tests unchanged.

## 6. Documentation

- [x] 6.1 Delegate to a general-purpose subagent (AGENTS.md "Documentation Update Protocol", caveman style passed verbatim): add per-file rows for `PrCombobox.tsx`, updated rows for `WorktreeSpawnDialog.tsx` (PR mode), `git-operations.ts` (`listPullRequests`, `addWorktreeFromPr`), `git-routes.ts` (two new routes) in the matching `docs/file-index-*.md` splits. `See change: add-worktree-from-pull-request` annotations.
- [x] 6.2 Add a one-line entry to `docs/architecture.md` (or the git/worktree topic doc) noting the inbound-PR data flow (`gh pr list` → `/api/git/pull-requests` → `PrCombobox`; `refs/pull/N/head` fetch → worktree). Delegated, caveman style.
- [x] 6.3 If a recurring "how do I check out a PR" question is likely, add a `docs/faq.md` row. Delegated.

## 7. Verification

- [x] 7.1 `npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` clean.
- [x] 7.2 `npm run build` succeeds; TS strict passes.
- [x] 7.3 Manual smoke on a repo with open PRs (incl. a fork PR): `npm run build && curl -X POST http://localhost:8000/api/restart`. Open Worktree dialog → "From a pull request" → list loads → filter → select → worktree created at PR head; current checkout untouched. Repeat with `gh` logged out → toggle disabled with hint.
- [x] 7.4 `npx openspec validate add-worktree-from-pull-request --strict`.

## 8. Subagent delegation plan

Per user direction "for implementations use subagents":

- **§0 spike**: main agent runs the `git`/`gh` commands directly (cheap, exploratory, needs judgement to set the decision gate). Not delegated.
- **§1–§3 (shared types + server)**: `nodejs-expert` subagent — `git-operations.ts`, `git-routes.ts`, server tests. Pass proposal + design + §1–§3 + exact paths.
- **§4–§5 (client)**: `react-expert` subagent — `PrCombobox`, dialog toggle, client tests. Pass design's reuse-boundary decision + §4–§5.
- **§6 (docs)**: general-purpose subagent with caveman-style rule verbatim.
- **§7 verification**: main agent.
