# CodeQL before/after (task 1.1 / 6.2, test-plan #E17)

Tool: CodeQL CLI 2.27.2, `codeql/javascript-queries` 2.4.7, models sha256 `d93b86d7…ea43` (`npm run codeql`, local ratchet). "Before" = the committed `codeql-baseline.json` (develop scan, `js/path-injection`); "after" = after this change and `node scripts/codeql-local.mjs --prune`.

Result: `pass` — **0 new results**; 28 baseline results closed (31 counting multiplicity). `js/path-injection` total **109 → 78**.

| File | Before | After |
|---|---|---|
| `packages/server/src/git-worktree/git-operations.ts` | 23 | 13 |
| `packages/server/src/git-worktree/worktree-init.ts` | 4 | 0 |
| `packages/server/src/openspec/openspec-tasks.ts` | 5 | 0 |
| `packages/server/src/openspec/openspec-archive.ts` | 4 | 0 |
| `packages/server/src/openspec/dependencies-file.ts` | 2 | 0 |
| `packages/server/src/openspec/workflow-schema.ts` | 1 | 0 |
| `packages/shared/src/openspec-dependencies.ts` | 2 | 0 |
| `packages/server/src/routes/git-routes.ts` | 3 | 0 |
| `packages/server/src/routes/openspec-routes.ts` | 1 | 1 |
| `packages/server/src/routes/folder-project-routes.ts` | 1 | 1 |

Residue for `triage-codeql-alert-debt`:
- `git-operations.ts` 13 — lib-owned containment of `path` (`addWorktree`, `addWorktreeFromPr`, `orphanCleanup`) and `files[]` (`commitFiles`) inputs; two are `github-dismissed` (#301, #306), the rest `operator-authz`.
- `routes/openspec-routes.ts` 1, `routes/folder-project-routes.ts` 1 — `operator-authz` entries not fed by the cwd shapes covered here.

The first analysis reported ONE new alert: a `stat` of the canonical cwd added to `shared/src/cwd-guard.ts` for D6. It was replaced (see `site-matrix.md` Notes) and the re-run is clean.
PR CodeQL analysis (same per-file drop expected): recorded at ship time in the PR.
