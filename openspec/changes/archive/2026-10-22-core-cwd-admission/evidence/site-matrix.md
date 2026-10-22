# Site matrix — core-cwd-admission

Gate vocabulary: **admit** = `admitRouteCwd` + branch on `admissionAllows(admission, cwd)` in the route / the one validating helper (`validateCwd`, `admitGitCwd`, `admitOpenSpecCwd`, `depGates`). Token released on `reply.raw` close (see Notes).
Refusals: git `400 {code:"cwd_unknown"}`; ungated openspec `403 {code:"cwd_unknown", …}`; gated openspec = today's body. Indeterminate everywhere: `503` + `Retry-After: 1` + shared body.

## Git (23 sites) — `packages/server/src/routes/git-routes.ts`

19 `validateCwd` call sites + 4 unvalidated routes. cwd source: query `cwd` (GET) / body `cwd` (POST). Operations receive `token.canonCwd`.

| # | Route | Before | After | Path-like inputs (owner) | Lib sink |
|---|---|---|---|---|---|
| 1 | GET `/api/git/branches` | presence only (`cwd_required`) | `admitGitCwd` | — | `isGitRepo`, `listBranches` |
| 2 | POST `/api/git/checkout` | presence only (`cwd_and_branch_required`) | `admitGitCwd` | `branch` (argv, not a path) | `checkoutBranch` |
| 3 | POST `/api/git/init` | presence only (`cwd_required`) — **writes** | `admitGitCwd` | — | `gitInit` |
| 4 | POST `/api/git/stash-pop` | presence only (`cwd_required`) | `admitGitCwd` | — | `stashPop` |
| 5 | GET `/api/git/status` | `validateCwd` (realpath+stat on raw) | `validateCwd` (admit → stat canon) | — | `isGitRepo`, `getGitStatus` |
| 6 | GET `/api/git/changed-files` | `validateCwd` | same | — | `getChangedFiles` |
| 7 | POST `/api/git/commit` | `validateCwd` | same | `files[]` (lib `commitFiles` path-escape check) | `commitFiles` |
| 8 | POST `/api/git/commit-draft` | `validateCwd` | same | `files[]` (non-empty strings; bridge builds the diff), `sessionId` (matched against session cwd) | relay only |
| 9 | GET `/api/git/head` | `validateCwd` | same | — | `readHead` |
| 10 | GET `/api/git/worktrees` | `validateCwd` | same | — | `listWorktrees` |
| 11 | GET `/api/git/worktree/init-status` | `validateCwd` | same | — | `resolveConfigRoot`, `readInitHook`, `evaluateGate` |
| 12 | POST `/api/git/worktree/init` | `validateCwd` | same | `confirmHash`, `requestId` (not paths) | `runInitHook` |
| 13 | POST `/api/git/worktree` | `validateCwd` | same | `base`, `newBranch` (argv), `path` (lib `addWorktree`) | `addWorktree` |
| 14 | POST `/api/git/worktree/orphan-cleanup` | `validateCwd` | same | `path` (lib `orphanCleanup` containment) | `orphanCleanup` |
| 15 | POST `/api/git/worktree/remove` | `validateCwd` | same | — | `classifyRemoval`, `removeWorktree` |
| 16 | POST `/api/git/worktree/remove-batch` | per-item `validateCwd`, hard-coded `cwd_invalid` | sequential, memo per raw cwd, 10 s budget, `min(cap, remaining)` deadline, classification memo by `canonCwd`, per-item code pass-through, one `finally` release, 200 envelope | `items[].cwd` | same as 15 |
| 17 | POST `/api/git/worktree/prune` | `validateCwd` | same | — | `pruneWorktrees` |
| 18 | POST `/api/git/worktree/merge` | `validateCwd` | same | — | `mergeWorktree` |
| 19 | POST `/api/git/worktree/push` | `validateCwd` | same | — | `pushBranch` |
| 20 | POST `/api/git/worktree/pr` | `validateCwd` | same | `title`, `body` (gh argv) | `createPullRequest` |
| 21 | GET `/api/git/pull-requests` | `validateCwd` | same | — | `listPullRequests` |
| 22 | POST `/api/git/worktree/from-pr` | `validateCwd` | same | `prNumber` (int), `path` (lib `addWorktreeFromPr`) | `addWorktreeFromPr` |
| 23 | GET `/api/git/worktree/diff-stat` | `validateCwd` | same | — | `worktreeDiffStat` |

`validateCwd` order: required → admit → 503 / `cwd_unknown` → `stat(canonCwd)` (`cwd does not exist` / `cwd is not a directory` as `cwd_invalid`, admitted cwds only) → `{ok, cwd: canonCwd, token}`.

## Openspec (12 caller-`cwd` sites) — `packages/server/src/routes/openspec-routes.ts`

Operations and keys keep the guarded **raw** `cwd` (D1). Ungated = 403 `cwd_unknown` body (D4); gated = admission first, then the existing exact membership + opt-out (raw and canonical) + global-dir checks with today's refusal.

| # | Site | cwd source | Before | After | Path-like inputs (owner) | Lib sink |
|---|---|---|---|---|---|---|
| 1 | GET `/api/openspec/config` | query, optional | none; fallback `knownCwds()[0] ?? process.cwd()` | admit when a non-empty cwd is given; fallback unchanged, not admitted | — | `configListAsync` |
| 2 | POST `/api/openspec/config` | body, optional | none; same fallback | same as 1 | — | `configProfile` |
| 3 | POST `/api/openspec/update` | body `cwd` or `all` | none | `cwd` admitted; `all` iterates `knownCwds()` unchanged, no admission | — | `openspecUpdate` |
| 4 | POST `/api/openspec/workflow-schema` | body | gated: 400 `untracked` | gated: admit → `knownInitTargets` exact → enabled → opt-out (raw + canon) | `changes[]` / `pinTo` / `previousDefault` (lib `validateSchemaName`) | `runWorkflowSchemaAction` |
| 5 | GET `/api/openspec/dependencies` | query | gated: 403 `cwd-not-tracked` | gated via `depGates` (admit first) | `change` (`KEBAB_ID_REGEX` + `isPortableProjectName`) | `readDeclared` |
| 6 | PUT `/api/openspec/dependencies` | body | gated | gated via `depGates`; uses the gate's guarded cwd | `change`, `blockedBy[]`… (`KEBAB_ID_REGEX`; `change` also `isPortableProjectName`) | `writeGuard`, `writeDependenciesFile` |
| 7 | POST `/api/openspec/init` | body | gated: 400 | gated: admit → exact membership | — | `openspecInitAsync` |
| 8 | GET `/api/openspec-archive` | query | none | admit (ungated) | — | `scanOpenSpecArchive` |
| 9 | GET `/api/pi-resources` | query, optional | none; fallback `process.cwd()` | admit when given; fallback unchanged | — | `refreshPiResources` |
| 10 | GET `/api/pi-resources/commands` | query | shape check (absolute) only | shape check first, then admit | — | `refreshPiResources` |
| 11 | GET `/api/openspec/tasks` | query | none | admit; then `isPortableProjectName(change)` → 400 `invalid_name` | `change` (**now `isPortableProjectName`**; lib joins it) | `readTasks` |
| 12 | POST `/api/openspec/tasks/toggle` | body | none | admit; then `isPortableProjectName(change)` | `change` (**now `isPortableProjectName`**) | `toggleTask` |

Out of scope (unchanged): `GET /api/pi-resource-file` (no `cwd`, path allowlist), `update {all:true}` list, the no-`cwd` fallbacks.
The `change` request value is the only path segment joined under a cwd by an openspec lib; `isPortableProjectName` also refuses Windows-reserved names / trailing dots (CHANGELOG).

## Folder-project — `packages/server/src/routes/folder-project-routes.ts`

Already admitted (`admitCwd` + `admissionAllows`). Change: `finally` release added next to the `reply.raw` close listener; 503 body unchanged (`{error, message, retryAfterMs}`, no `code`; its clients read `error`).

## Client audit (task 4.8)

Grepped `WorktreeSpawnDialog`, `SessionCard`, `useInitStatus`, `git-api.ts`: no branching on `cwd_invalid` or on 400/503 of the git routes (only `git-api.ts` checkout `409 + dirty`). `CloseWorktreeDialog.tsx:66` (`cwd_invalid` → "already gone") and `ManageWorktreesDialog.tsx` `describeFailure` are the two readers; both handled. `fetchWorktreeInitStatus` now reports `cwdUnknown` on the fail-open path; `useInitStatus`, `WorktreeInitButton`, `FolderActionBanner` treat it as the existing `{hasHook:false}` (no checklist = unknown).

## CodeQL classification of the baseline entries on these routes / libs (task 1.1)

Per-file before/after counts and the residue: `evidence/codeql.md`. Classification: entries in `routes/git-routes.ts` (3), `worktree-init.ts` (4), `openspec-tasks.ts` (5), `openspec-archive.ts` (4), `dependencies-file.ts` (2), `workflow-schema.ts` (1), `shared/openspec-dependencies.ts` (2) were **cwd-fed** (closed). `git-operations.ts` 23 → 13: 10 cwd-fed closed; the 13 left sit in lib-owned containment of `path` / `files[]` inputs (rows 7, 13, 14, 22) — booked as residue. `routes/openspec-routes.ts` (1) and `routes/folder-project-routes.ts` (1) remain (not cwd-fed through the shapes above; line-level confirmation is for `triage-codeql-alert-debt`).

## Notes (deviations from the written design, none behavioural)

- **Release point.** Git and openspec routes release the admission token on `reply.raw` `close` (registered inside the one helper) instead of a `try/finally` in each of the 19 + 12 handlers; `remove-batch` and folder-project use `finally`. Fastify emits `close` before `inject` resolves and on a thrown handler and on a client disconnect (probe test), so the observable contract — token not live after the response — is the same (tests X5, X8, X9).
- **D6 (non-directory cwd).** The regular-file → 503 case was confirmed (E5 red). The fix is NOT a guard `stat` (a new `fs` sink on the request value in `cwd-guard.ts` was reported by the CodeQL ratchet as a NEW `js/path-injection`, and it broke the folder-project "no fs call under the cwd" test): `checkoutRootsClassifiedAsync` now reads a `spawn ENOTDIR` as "not a repository" (`none`), so the guard refuses. Scenario delta: `specs/plugin-cwd-admission/spec.md`. Windows may report a different errno and keeps the old (503) behaviour there.
- **Openspec known set default.** `registerOpenSpecRoutes` defaults `knownFolderCwds` to the same `listKnownFolderCwds({sessionManager, preferencesStore})` it already has; `server.ts` passes the shared function explicitly. Git routes have no preferences store, so `knownCwds` is explicit there (fail closed when absent).
- **Existing-test edits.** Tests that pointed routes at temp dirs now register them as known (`KNOWN`/`pinned` stand-ins). One assertion changed on intent: `folder-commands-route.test.ts` E11 expected `200` for an *unknown missing* path; that is now `403` (the spec's refusal), and the `200`-never-500 intent is kept for a pinned-but-deleted folder.
