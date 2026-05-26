## 1. Shared types + bridge detection

- [x] 1.1 Add `GitWorktreeInfo` interface to `packages/shared/src/types.ts` (`mainPath: string; name: string; base?: string`) and `gitWorktree?: GitWorktreeInfo` on `DashboardSession`
- [x] 1.2 Mirror the field on `GitInfo` in `packages/extension/src/vcs-info.ts` (`git-info.ts` was renamed in an earlier change)
- [x] 1.3 Implement `detectWorktree(cwd)` in `vcs-info.ts`: run `git rev-parse --git-common-dir` and `--show-toplevel` via new `commonDirOr` / `toplevelOr` recipes in `platform/git.ts`; return `{ mainPath, name }` when common-dir is outside top-level, else `undefined`
- [x] 1.4 Wire `detectWorktree` into `gatherGitInfo` and ensure failure of the rev-parse pair short-circuits to `undefined` (does NOT block branch / remote / PR detection)
- [x] 1.5 Unit tests for `detectWorktree`: main checkout (abs + rel commonDir), worktree, sibling-layout worktree, nested-cwd-not-worktree, rev-parse failure (mocked at platform layer)
- [x] 1.6 Forward `gitWorktree` on `git_info_update` payload (session_register itself does not carry git info; followup git_info_update covers both register and live update paths); add `lastGitWorktreeJson` change-detection cache to `BridgeContext` + sync wrappers

## 2. Server-side propagation + meta persistence

- [x] 2.1 Store `gitWorktree` on the in-memory `Session` model — already handled by `Object.assign` in `memory-session-manager.ts#update`; field added to `DashboardSession` in §1
- [x] 2.2 Forward `gitWorktree` on `session_added` / `session_updated` browser messages — already covered by generic `broadcastSessionUpdated(updates)` spread; `event-wiring.ts` now includes `gitUpdates.gitWorktree`
- [x] 2.3 Extend `.meta.json` writer to persist a new optional `gitWorktreeBase: string` field on `SessionMeta`
- [x] 2.4 Compose `gitWorktree.base` into browser payloads via new pure helper `composeWorktreePayload` in `packages/server/src/git-worktree-compose.ts`; wired into `event-wiring.ts#git_info_update`; `session-scanner.ts` loads `meta.gitWorktreeBase` onto `DashboardSession.gitWorktreeBase` (server-internal cache field)
- [x] 2.5 Backward-compat tests: 5 unit tests for `composeWorktreePayload` (undefined / null / wire-without-base / wire-with-base / cache-merge / immutability); 4 tests for `SessionMeta.gitWorktreeBase` round-trip incl. legacy-meta-file scenario

## 3. Pure helpers

- [x] 3.1 Create `packages/server/src/git-worktree.ts` with pure `slugifyBranch(branch: string): string` matching the design's slug rule
- [x] 3.2 Add pure `parsePorcelainWorktrees(stdout: string): WorktreeEntry[]` parser; first record flagged `isMain: true`
- [x] 3.3 Add pure `resolveDefaultBase({ currentBranch, localBranches, remoteBranches }): { ok: true, base } | { ok: false, error: "no_usable_base" }` implementing the fallback chain (current → develop → main → master, local-first then `origin/<x>`)
- [x] 3.4 Add pure `ensureWorktreeExcludeLine(existing: string): { content: string; appended: boolean }` for idempotent `.git/info/exclude` mutation
- [x] 3.5 33 unit tests pass: slug (8 cases incl. spec example + length cap + all-strippable), porcelain (8 cases incl. main-only, multi, detached, bare, locked-tolerated, CRLF, malformed), fallback (9 cases incl. local-over-remote precedence + detached + total-miss), exclude (7 cases incl. CRLF + boundary substrings)

## 4. Server endpoints

- [x] 4.1 Add `readHead(cwd)` to `packages/server/src/git-operations.ts`; returns `{ branch, detached, sha }` using `git symbolic-ref --quiet --short` + `rev-parse --short HEAD`
- [x] 4.2 Add `listWorktrees(cwd)` to `git-operations.ts`; runs `git worktree list --porcelain`; calls `parsePorcelainWorktrees`
- [x] 4.3 Add `addWorktree({ cwd, base, newBranch, path, force })` to `git-operations.ts`; resolves parent repo via `git-common-dir` (works from any worktree); pre-flight path-exists check; runs `git worktree add` with shell-escaped args; appends `.worktrees/` to `.git/info/exclude` (idempotent, only when path was auto-derived); maps stderr patterns onto stable error codes (`branch_in_use` / `branch_exists` / `base_not_found` / `path_exists` / `git_failed`)
- [x] 4.4 Register `GET /api/git/head` in `packages/server/src/routes/git-routes.ts` (localhost-only, `validateCwd` realpath check via `safeRealpathSync`, stable `code` field on errors)
- [x] 4.5 Register `GET /api/git/worktrees`
- [x] 4.6 Register `POST /api/git/worktree` returning `{ path, branch, excludeAppended }`; HTTP status 200 success / 400 input / 409 state-conflict (branch/path) / 500 unclassified. (§8 wires §-aware `gitWorktreeBase` meta-persistence into the spawn flow.)
- [x] 4.7 Integration tests: 13 unit-level ops tests (happy path + every error arm + cross-worktree parent-resolve) + 10 HTTP-level route tests (envelope shape + status codes + stable codes for each documented arm). Also extended `ApiResponse` with `stderr?: string` to support inline git-error rendering.

## 5. Client grouping + display

- [x] 5.1 Extend `resolveSessionGroupPath` in `packages/client/src/lib/session-grouping.ts` with the new step 3 (`gitWorktree.mainPath`); platform inference also samples worktree mainPaths
- [x] 5.2 Extend `clusterByWorkspaceName` to also key on `gitWorktree?.name`; empty-key cluster sorts first; remaining keys alphabetical
- [x] 5.3 7 new unit tests in `session-grouping-worktree.test.ts`: worktree session collapses under pinned/unpinned parent, explicit pin of worktree wins, jj+worktree both present → jj wins (both grouping AND clustering), cluster adjacency with server-provided ordering, plain-checkout backward-compat. Pre-existing 6 jj tests still pass (no regressions).
- [x] 5.4 Added `<WorktreePill session>` component in `SessionCard.tsx`; rendered inline at end of `GitInfo` (after branch + PR). Renders `<span data-testid="worktree-pill">worktree</span>` with the specified styling tokens; `title` attribute reflects `base` presence. Mobile branch already does not invoke `GitInfo`, so mobile is pill-free by construction.
- [x] 5.5 9 component tests in `WorktreePill.test.tsx`: standalone pill (3 cases: base / no-base / absent), styling-token assertions, GitInfo integration (branch unchanged + document-order check), plain-checkout absence, no-branch absence, desktop-card-renders, mobile-card-does-not-render.

## 6. Worktree dialog

- [x] 6.1 Added client fetch helpers to `git-api.ts`: `fetchGitHead`, `fetchWorktrees`, `createWorktree`. Discriminated `CreateWorktreeResult` so callers can branch on stable `code` field.
- [x] 6.2 Created `WorktreeSpawnDialog.tsx` with two stacked sections (existing list + create form) and full-screen chrome matching `PinDirectoryDialog`. Native `<select>` for the base picker (full `BranchPicker` integration deferred — the select is keyboard-accessible and the dialog stays lean).
- [x] 6.3 On mount fetches `getHead` + `listWorktrees` + `listBranches` in parallel via `Promise.all`; default base computed via shared `resolveDefaultBase` (moved to `packages/shared/src/git-worktree-helpers.ts`; server re-exports for back-compat).
- [x] 6.4 Existing-worktree rows are buttons keyed by `worktree-row-<path>`; click → `onSpawn(path)` (no `gitWorktreeBase` since the worktree was created elsewhere).
- [x] 6.5 Create form: native base `<select>`, new-branch input, live-derived path field (editable). Submit → `createWorktree` → `onSpawn(path, { gitWorktreeBase: base })`.
- [x] 6.6 Structured errors rendered inline (`data-testid="worktree-dialog-error"`); stable `code` shown, `stderr` in a collapsed `<details>`; tone mapped by code (yellow for state conflicts, orange for input errors, red otherwise). Error clears on next form edit.
- [x] 6.7 Conditional submodule footnote: `readHead` now also stat-probes `<repo>/.gitmodules` and returns `hasSubmodules: boolean`. Dialog renders a yellow-toned note when true. Cheap (no extra subprocess; one fs.existsSync call).
- [x] 6.8 15 component tests covering: loading state, existing-list render + spawn-on-click, default-base resolution (current-branch / detached fallback), live slug preview, submit happy path (calls createWorktree + onSpawn), submit disabled on empty, structured error inline render + stderr details, error-clears-on-edit, load-error path, cancel button, Escape key, submodule footnote (both arms).

## 7. Action-bar integration

- [x] 7.1 Added `+Worktree` button to `FolderActionBar.tsx` between `+Session` and `Terminals(N)` with `mdiSourceBranchPlus` icon and yellow hover tone.
- [x] 7.2 Hidden when folder is not a git repo. Signal: `isGitRepo` prop wired from `SessionList` based on `group.sessions.some((s) => !!s.gitBranch)` — same any-session-has-branch heuristic used by other folder-level git affordances. `isGitRepo` undefined defaults to hidden (defensive).
- [x] 7.3 Loopback gate **rejected during review** — the worktree-add runs on the server (= the user's machine) in every access mode (localhost, tunnel, authenticated remote), so a tunneled browser is functionally identical to a local one. Access control for `POST /api/git/worktree` is enforced server-side by `networkGuard`. Spec scenario amended from "hide on non-loopback" to "button renders identically for local and tunneled browsers".
- [x] 7.4 `SessionList` holds `worktreeDialogCwd` state; the button's onClick sets it. Dialog mounts once at the SessionList level (not per-folder) so only one is open at a time. `onSpawn(path)` closes the dialog and calls `onSpawnSession(path)`. (Second arg `gitWorktreeBase` is dropped pending §8 wiring.)
- [x] 7.5 7 component tests covering: render with all conditions, hidden when not git repo, hidden when isGitRepo undefined, hidden on non-loopback (via mocked isLocalhost), hidden when handler absent, click invokes handler, +Session button still renders regardless of git/localhost state.

## 8. Auto-spawn wiring

- [x] 8.1 Client: `handleSpawnSession(cwd, attachProposal?, opts?: { gitWorktreeBase? })` extended; `SessionList.WorktreeSpawnDialog onSpawn` forwards `opts` through. Protocol: `SpawnSessionBrowserMessage.gitWorktreeBase?: string` added (additive, backward-compatible).
- [x] 8.2 Server: new `pending-worktree-base-registry.ts` (sibling of `pending-attach-registry.ts`, FIFO per cwd, 60s TTL, cap 8). `handleSpawnSession` enqueues on spawn. `event-wiring.ts#onSessionRegistered` consumes on register, stamps `DashboardSession.gitWorktreeBase`, calls `mergeSessionMeta` (synchronous durability), and broadcasts `session_updated`. `server.ts#onChange` save payload now includes `gitWorktreeBase` so the debounced meta-persistence path also picks it up after natural session updates.
- [x] 8.3 9/9 tests pass: 7 unit-level for the registry (FIFO, cap, TTL, normalization, empty-base) + 2 end-to-end via a real `DashboardServer` over local WS gateways (spawn→register→meta.json persistence; absence path when `gitWorktreeBase` omitted). Also caught and fixed a clobber bug: `event-wiring.ts`'s `writeSessionMeta({source: "dashboard"})` was overwriting sibling sync meta writes; replaced with `mergeSessionMeta`.

## 9. Supersede prior changes

- [x] 9.1 Added superseded note at top of `worktree-awareness/proposal.md` citing this change + summarising the deltas (different card-display choice, missed grouping fix).
- [x] 9.2 Added superseded note at top of `workspace-actions/proposal.md` (different layout, missing grouping + auto-spawn + unified dialog).
- [x] 9.3 Moved both directories to `openspec/changes/archive/2026-05-26-worktree-awareness/` and `archive/2026-05-26-workspace-actions/` via `git mv` (date-prefix convention matching all other archived changes; project does not use a `superseded/` subdirectory). Artifacts preserved verbatim including the superseded note.
- [x] 9.4 `openspec list` no longer shows either change in the active list. `openspec validate add-worktree-spawn-dialog --strict` still passes.

## 10. Documentation

- [x] 10.1 Add a row to `docs/file-index-server.md` for the new `git-worktree.ts` helper (caveman style, path-alphabetical)
- [x] 10.2 Add a row to `docs/file-index-client.md` for `WorktreeSpawnDialog.tsx` (caveman style)
- [x] 10.3 Update existing rows for `git-operations.ts` / `git-routes.ts` to mention the new endpoints (one-line append; do not pad)
- [x] 10.4 Update existing rows for `git-info.ts` / `session-grouping.ts` to mention worktree fields and precedence step 3
- [x] 10.5 Mention the new `.worktrees/` layout convention in `docs/architecture.md` (one short paragraph under git workflow / repo conventions)

## 11. Validation

- [x] 11.1 Run `openspec validate --change add-worktree-spawn-dialog --strict`
- [x] 11.2 Run full test suite (`npm test`); ensure all new tests pass and no existing tests regress
- [x] 11.3 Manual smoke test on a real repo: open dialog, see main + any existing worktrees listed; create a new worktree from `develop`; confirm session card renders worktree pill; confirm session groups under parent pinned dir _(deferred to release-QA per user decision 2026-05-26; all automated tests green + openspec strict-valid)_
- [x] 11.4 Cross-platform check: same smoke test on Windows (path separators in derived paths, exclude file) _(deferred to release-QA per user decision 2026-05-26; covered by existing `qa/` VM-based test infrastructure when release is cut)_
