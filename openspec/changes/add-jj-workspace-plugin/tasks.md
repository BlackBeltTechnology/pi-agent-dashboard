# Tasks

## Phase 0 — Prereqs

- [x] Verify `dashboard-plugin-architecture` is implemented and shipped
- [x] Verify `add-dashboard-shell-slots-runtime` is implemented and shipped
- [x] Confirm `flows-plugin` is the canonical reference and read its package layout end-to-end

## Phase 1 — Tool registry + platform module

- [x] Add `jj` definition to `packages/shared/src/tool-registry/definitions.ts` (binary, standard strategy chain)
- [x] Add unit test asserting `getDefaultRegistry().resolve("jj")` returns a non-null Resolution when `jj` is on PATH (gated by skip when not installed)
- [x] Create `packages/shared/src/platform/jj.ts` mirroring `platform/git.ts` Recipe shape:
  - [x] `jj.version()` → semver string
  - [x] `jj.workspaceRoot(cwd)` / `jj.workspaceList(cwd)` (status info derived from these + revsets)
  - [x] `jj.workspaceAdd(cwd, destPath, baseRev?)` → `Result<void>`
  - [x] `jj.workspaceForget(cwd, name)` → `Result<void>`
  - [x] `jj.bookmarkCreate(cwd, name, rev)` / `bookmarkList(cwd)` → `Result<void> | Result<string>`
  - [x] `jj.gitInitColocate(cwd)` → `Result<void>`
  - [x] `jj.gitPush(cwd, bookmark)` → `Result<void>`
  - [x] `jj.diff(cwd, fromRev?, toRev?, path?)` → `Result<string>` (Phase 4b prereq)
  - [x] `jj.resolveList(cwd)` / `opLogHead(cwd)` / `opRestore(cwd, opId)` / `rebase(cwd, dest, src)` / `logRevset(cwd, revset)` (fold-back primitives)
- [x] Unit test each Recipe with argv-shape coverage (mirrors `platform-git.test.ts`)
- [x] Lint test: `jj.ts` does not import `node:child_process` directly (auto-satisfied by existing `no-direct-child-process.test.ts`)

## Phase 2 — Bridge probe extension

- [x] Rename `packages/extension/src/git-info.ts` → `vcs-info.ts` (`git mv`, history preserved); add jj probe alongside existing git probe
  - [x] tool registry resolves `jj` AND
  - [x] `.jj/` exists in the session cwd
- [x] Populate `Session.jjState: { isJjRepo, isColocated, workspaceName, workspaceRoot, lastError? }` via new `jj_state_update` `ExtensionToServerMessage` (mirrors `git_info_update`)
- [x] Fast-path: skip the entire jj probe when `.jj/` doesn't exist (single `fs.existsSync` before any subprocess)
- [x] Add `JjState` interface + `jjState?` field to `DashboardSession` in `packages/shared/src/types.ts`
- [x] Wire `sendJjStateIfChanged` into `bridge.ts` at the same three sites as `sendGitInfoIfChanged` (initial send + 30 s poll tick + session-change restart)
- [x] Server-side `event-wiring.ts` consumes `jj_state_update` and broadcasts via `session_updated`
- [x] Document the new `JjState` interface and `jjState?` field in `AGENTS.md` table (done in Phase 7 docs pass)

## Phase 3 — Plugin scaffold

- [x] Create `packages/jj-plugin/package.json` with `pi-dashboard-plugin` manifest:
  - [x] id: `jj`, displayName: `Jujutsu Workspaces`, priority: 100
  - [x] claims: badge / action-bar / sidebar-folder-section / command-route / settings-section
  - [x] configSchema: `./src/configSchema.json` with fields:
        `defaultPushTarget`, `workspaceRoot`, `allowDirectTrunkPush`,
        `showInitColocatedSuggestion` (default `false` — plain-git affordance opt-in)
- [x] Create `packages/jj-plugin/src/client/index.tsx` barrel:
  - [x] Phase-3 placeholder components (`JjWorkspaceBadge`, `JjActionBar`, `JjWorkspaceList`, `JjWorkspaceView`, `JjPluginSettings`); `JjFoldBackDialog` lands in Phase 4
  - [x] Predicates: `isInJjRepo`, `isInJjWorkspace`, `isInGitRepoButNotJj` (real, gating works end-to-end now)
- [x] Create `packages/jj-plugin/src/server/index.ts` (Phase-3 placeholder; routes land in Phase 5)
- [x] Auto-picked up by `packages/*` workspace glob in root package.json
- [x] Add `packages/jj-plugin/` to root `vitest.config.ts` projects array
- [x] Predicate truth-table tests + manifest validator test (20 tests passing)
- [x] Wire `packages/jj-plugin/` into the published bundle via `packages/client/package.json` deps (done in Phase 8 — plugin is `private:true`, ships inside `pi-dashboard-web` tarball)

## Phase 4 — Client components

- [x] `JjWorkspaceBadge` — chip rendering `jj:<workspaceName>`; predicate-gated; tooltip shows colocated state
- [x] `JjActionBar` — row with buttons:
  - [x] `+ Workspace` (when `isInJjRepo`) — prompts for name, calls `POST /api/jj/workspace/add`, server spawns the session
  - [x] `Fold back` (workspace cards only) — opens `JjFoldBackDialog`
  - [x] `Forget workspace` (workspace cards only) — first attempt `force:false`; 409 UNFOLDED_WORK opens `JjForgetConfirmDialog` listing commits and re-issues with `force:true` after explicit confirm
  - [x] `Enable jj workspaces` plain-git affordance — separate `JjInitAffordance` component + `session-card-action-bar` claim with `isInGitRepoButNotJj` predicate. The component reads plugin config via `usePluginConfig` and renders nothing when `showInitColocatedSuggestion` is false (default). Two-gate model: predicate filters claims, config filters inside the component.
- [x] `JjWorkspaceList` — sidebar-folder section; renders only when 2+ workspaces exist; lists name + change-id-short
- [x] `JjWorkspaceView` — `/jj` route with workspace table + refresh button (read-only)
- [x] `JjFoldBackDialog` — explainer + radio buttons (preserve / squash / pr); copies skill-invocation prompt to clipboard
- [x] `JjPluginSettings` — settings-section form for all four configSchema fields
- [x] Predicate truth-table tests (12 tests in `predicates.test.ts`)
- [x] Badge visibility tests (4 tests in `JjWorkspaceBadge.test.tsx`)
- [x] Action-bar visibility tests (4 tests in `JjActionBar.test.tsx`)
- [x] Fold-back prompt builder tests (6 tests in `JjFoldBackDialog.test.tsx`)
- [x] Client `DiffPanel` (`FileDiffView` header) renders "(vs &lt;baseLabel&gt;)" pill when `vcsKind === "jj"`

## Phase 4b — jj-aware session-diff

- [x] Refactor `packages/server/src/session-diff.ts`:
  - [x] Keep existing `enrichWithGitDiff` exported (backwards compat)
  - [x] New `enrichWithVcsDiff(cwd, files, jjState?)` dispatcher chooses git or jj path
  - [x] New `enrichWithJjDiff(cwd, files, jjState)` runs `jj.diff` per file
  - [x] Compute `baseRev` via pure `selectJjDiffBase`: `@-` for default workspace, `fork_point(@, trunk())` for others
  - [x] Compute `baseLabel`: bookmark name on `@-` if jj resolves it, else the revset literal
- [x] Add `jj.diff(cwd, fromRev, toRev, path)` Recipe to `platform/jj.ts` (done in Phase 1)
- [x] Extend `SessionDiffResponse` with optional `vcsKind`, `diffBase`, `baseLabel` (additive, opt-in)
- [x] Update `packages/server/src/routes/session-routes.ts` to thread `Session.jjState` into the enrichment call
- [x] Client `DiffPanel` (`FileDiffView` header) renders "(vs &lt;baseLabel&gt;)" pill when `vcsKind === "jj"` (done in Phase 4)
- [x] Tests:
  - [x] `selectJjDiffBase` truth-table (5 tests covering default / undefined / non-default / various names)
  - [x] Plain-git regime byte-equivalence preserved (existing session-diff.test.ts continues to pass against `enrichWithVcsDiff` via dispatcher)
  - [ ] Live integration: non-default-workspace regime captures all agent commits across multiple `jj new`s (deferred to Phase 7 integration tests)
  - [ ] Untracked file in jj path uses native `jj diff` output, not synthetic (covered structurally by code path; integration test deferred)
  - [x] Old client (no `vcsKind` reader) still renders correctly — fields are optional

## Phase 5 — Server routes

- [x] `POST /api/jj/workspace/add` — `{ fromCwd, name, baseRev?, taskDescription? }` → runs `jj.workspaceAdd`, enqueues into `pendingAttachRegistry`, calls `spawnPiSession`
  - [x] Validate `name` against `/^[a-z0-9-]+$/`
  - [x] Reject if `<workspaceRoot>/<name>` already exists
  - [x] Resolve `baseRev` from source `@`'s bookmark (fallback `trunk()`)
- [x] `POST /api/jj/workspace/forget` — `{ cwd, name, force?: boolean }`
  - [x] Inspect for unfolded commits via `jj log -r 'fork_point(<name>@, trunk()) .. <name>@'`
  - [x] Refuse with HTTP 409 (`code: "UNFOLDED_WORK"`) if non-empty AND `!force`
  - [x] On success/force: run `jj.workspaceForget` then `fs.rm({ recursive: true, force: true })` on the workspace dir
- [x] `POST /api/jj/init-colocated` — `{ cwd }` → INDEX-only dirty check (column-1 status); refuses 409 `DIRTY_INDEX` only on staged changes; allows working-tree dirt
- [x] `GET /api/jj/workspace/list?cwd=...` — returns workspace list (used by `JjWorkspaceList`)
- [x] All routes auth-gated via `networkGuard` preHandler
- [x] Route tests for `checkInitColocatedPreconditions` (8 tests — covers DIRTY_INDEX, ALREADY_JJ, NOT_GIT_REPO, INVALID_CWD, working-tree-dirt-allowed, probe-error-defensive)
- [x] Routes registered in `server.ts`

## Phase 6 — Skills

- [x] `.pi/skills/jj-workspace/SKILL.md` — operating manual for agents working in a jj workspace
  - [x] Safety section (forbidden git commands, allowed read-only, safe git mutations)
  - [x] "Working in this workspace" section with `jj st`, `jj log`, `jj describe`, `jj new` essentials
  - [x] Quick reference table (jj is not git — 9 concept mappings)
  - [x] Conflicts section + recovery affordances (`jj op log`, `jj undo`)
- [x] `.pi/skills/jj-workspace-fold-back/SKILL.md` — the fold-back operation
  - [x] Refusal preconditions section (colocated check, conflicts check, empty check, dirty git index check)
  - [x] Dirty-index refusal message: educate, don't auto-fix. Three options offered:
        `git reset` (safe), `jj new -m WIP` (jj-native), `git stash` forbidden with reason.
  - [x] Default flavor (preserve commits → rebase → push bookmark)
  - [x] Bookmark name auto-derived from workspace name verbatim (e.g. `agent-1`);
        refuses if bookmark already exists
  - [x] Conflict handling: capture pre-rebase op-id, on conflict run
        `jj op restore <pre-op>` to revert, surface details, fail cleanly
  - [x] Optional `mode: squash` flavor
  - [x] Optional `mode: pr` flavor (requires `gh` CLI; documents the dependency)
  - [x] Loud disclaimer at top: "This skill never invokes `git commit` or `git merge`."
- [x] Both skills auto-discovered via top-level `.pi/skills/` (no per-package README index to maintain — the dashboard's skill loader walks `.pi/skills/` directly)

## Phase 7 — Tests + docs

- [x] `packages/jj-plugin/src/__tests__/predicates.test.ts` — 12 truth-table tests
- [x] `packages/jj-plugin/src/__tests__/manifest.test.ts` — 8 validator + claim tests
- [x] `packages/jj-plugin/src/__tests__/JjWorkspaceBadge.test.tsx` — 4 visibility tests
- [x] `packages/jj-plugin/src/__tests__/JjActionBar.test.tsx` — 4 visibility tests
- [x] `packages/jj-plugin/src/__tests__/JjFoldBackDialog.test.tsx` — 6 prompt-builder tests
- [x] `packages/server/src/__tests__/jj-routes.test.ts` — 8 init-precondition tests
- [x] `packages/server/src/__tests__/session-diff-vcs.test.ts` — 5 diff-base selector tests
- [ ] Live integration test: temp git repo + `jj git init --colocate` + `jj workspace add` (deferred — requires `jj` on the test runner; ok as a smoke test at release time)
- [x] Update `AGENTS.md` with the new package + new `Session.jjState` field documentation (8 new rows added)
- [x] Update `README.md` with a "Jujutsu workspaces" entry under the Dev tools features list
- [x] Update `docs/architecture.md` with new "VCS Polling (Git + Jujutsu)" + "Jujutsu workspaces" subsections under Data Flow
- [x] Add both skills to the relevant skill index (top-level `.pi/skills/` already auto-discovered)

## Phase 8 — Publish

- [x] Add `@blackbelt-technology/pi-dashboard-jj-plugin` to `packages/client/package.json` deps so Vite bundles it into the published `pi-dashboard-web` tarball (mirrors flows-plugin model). Plugin is `private:true` and ships inside the client bundle, NOT as its own npm package.
- [x] No `publish.yml` change needed: the per-package publish loop only handles the 5 public packages (shared/extension/server/web/plugin-runtime + root metapackage); `private:true` workspace packages are intentionally excluded.
- [ ] Cut a release via the `release-cut` skill (separate operator action)
- [ ] Smoke test: clean `npm install` of the dashboard, install `jj` separately, verify the badge appears on a session inside a colocated repo (release-time)
- [ ] Smoke test on Windows + macOS + Linux that the tool registry resolves `jj` from each OS's standard install location (release-time)
