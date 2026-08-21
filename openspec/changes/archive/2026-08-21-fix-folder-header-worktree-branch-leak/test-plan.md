# Test Plan — fix-folder-header-worktree-branch-leak

Stage: design   Generated: 2026-08-20

Gate resolved before writing (4 questions answered): no-eligible-child renders the existing dimmed branch icon with no new affordance; entry-refresh asserts "strictly before the next periodic tick" with no numeric bound; no performance scenario (connect-snapshot cardinality is order-10, explicitly out of scope); PR-pill / branch-link removal verified at L3 by DOM absence.

Requirement refs: **R1** = "Server polls resolved folder group keys for git HEAD" (MODIFIED) · **R2** = "Folder header renders the folder's own HEAD with precedence over child-session branches" (MODIFIED) · **R3** = "Newly connected browsers receive the cached folder-HEAD map" (ADDED).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R2 | decision-table | L1 | automated | group cwd `/repo`; sessions ordered [worktree child cwd `/repo/.worktrees/os-foo` branch `os/foo`, main child cwd `/repo` branch `develop`]; no folder-git entry | render `GroupGitInfo` | rendered branch is `develop` |
| E2 | R2 | decision-table | L1 | automated | group cwd `/repo`; every session cwd is `/repo/.worktrees/*`; no folder-git entry; REST seed returns `develop` | render `GroupGitInfo` | no child branch is rendered; the value rendered is the REST seed `develop` |
| E3 | R2 | decision-table | L1 | automated | pinned folder cwd `/repo/.worktrees/os-foo`; its session cwd is the same path, branch `os/foo`; no folder-git entry | render `GroupGitInfo` | rendered branch is `os/foo` (eligible — cwd identity holds despite being a worktree) |
| E4 | R2 | decision-table | L1 | automated | group cwd `/repo`; eligible main child has branch `develop` and NO PR; ineligible worktree child has `gitPrNumber: 42`, `gitPrUrl`, `gitBranchUrl` | render `GroupGitInfo` | branch `develop` rendered; `prNumber`/`prUrl`/`branchUrl` are all absent — no slot is sourced from the ineligible session |
| E5 | R2 | decision-table | L1 | automated | folder-git map has `/repo → develop`; first-ordered session is a worktree child with `os/foo` | render `GroupGitInfo` | rendered branch is `develop` (shipped precedence unchanged) |
| E6 | R2 | decision-table | L1 | automated | folder-git map has `/repo → null` | render `GroupGitInfo` | dimmed / "Init git" state rendered (shipped behaviour unchanged) |
| E7 | R2 | BVA (path canonicalization) | L1 | automated | group cwd `/repo`; child session cwd `/repo/` (trailing separator) branch `develop` | render `GroupGitInfo` | child is eligible; `develop` rendered (comparison uses `pathKey`, not raw string equality) |
| E8 | R1 | state-transition | L1 | automated | previously-computed key set `{/a}`; session registers whose resolved key is `/b`; `readHead("/b") → main` | entry trigger fires | `git_head_update {cwd:"/b", branch:"main"}` broadcast strictly before any periodic tick runs |
| E9 | R1 | state-transition | L1 | automated | previously-computed key set `{/a}`; session registers whose resolved key is `/a` | entry trigger fires | no additional broadcast for `/a` |
| E10 | R1 | state-transition | L1 | automated | folder `/a` has only ENDED sessions (absent from the key set, but a known cwd so `isNewCwd` is false); new session registers at `/a` | `session_register` | `/a` is treated as entering; its HEAD is read and broadcast before the next periodic tick |
| E11 | R1 | state-transition | L1 | automated | directory `/c` has zero sessions and is not in the key set | `/c` is pinned | `/c` refreshed and broadcast before the next periodic tick |
| E12 | R1 | state-transition | L1 | automated | session registered at `/repo/.worktrees/os-foo` with no `gitWorktree`; `/repo` not in the key set | `git_info_update` supplies `gitWorktree.mainPath = /repo`, re-keying the session | `/repo` is refreshed and broadcast before the next periodic tick |
| E13 | R1 | state-transition | L1 | automated | `/a` in key set with cached `develop`; all `/a` sessions end; a recomputation observes the departure; `readHead("/a")` now yields `feature` | a new session registers at `/a` | `/a` is re-read and `git_head_update {branch:"feature"}` broadcast |
| E14 | R1 | state-transition (illegal-edge / bounded window) | L1 | automated | `/a` leaves and re-enters the set between two recomputations, so no recomputation observed the departure; HEAD changed to `feature` meanwhile | entry trigger, then one periodic cycle | the trigger MAY skip; the next periodic cycle broadcasts `feature` — convergence within one interval, never never-converging |
| E15 | R1+R3 | state-transition | L1 | automated | `/a` cached as `develop`; `/a` leaves the key set | recompute the set, then a browser connects | `/a`'s cached value is retained and appears in the connect snapshot |
| E16 | R3 | state-transition | L1 | automated | cache holds `/repo → develop` | a new browser connects | that browser receives `{cwd:"/repo", branch:"develop"}` in its initial state |
| E17 | R3 | decision-table | L1 | automated | cache holds `/repo → develop`; browser A already connected | browser B connects | browser B receives the entry; browser A receives NOTHING; the server's diff cache is byte-identical before and after |
| E18 | R3 | BVA (empty) | L1 | automated | no folder-HEAD poll exists (polling not started) | a browser connects | zero folder-HEAD entries sent; the connection succeeds |
| E19 | R3 | decision-table | L1 | automated | cache holds `/notgit → null` | a new browser connects | that browser receives `{cwd:"/notgit", branch:null}` |
| E20 | R1 | BVA (concurrency bound) | L1 | automated | 12 keys enter the set simultaneously; instrumented `readHead` records concurrent in-flight count | entry trigger fires once (debounced) | peak concurrent reads ≤ the poll's configured cap (4); all 12 keys are eventually refreshed |
| E21 | R3 | fault-injection (stub shape) | L1 | automated | a `DirectoryService` fake built like `__tests__/helpers/load-fixtures.ts` `makeFakeDirectoryService`, lacking any folder-HEAD accessor | a browser connects against it | the connect handler does not throw; the browser still receives `sessions_snapshot` and the openspec snapshot |

### Performance

None. Per the resolved gate, connect-snapshot cardinality is order-10 and explicitly out of scope; the only bounded-work assertion (E20) is an edge-case invariant, not a threshold.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R2 | state-convergence | L3 | automated | harness dashboard with a folder that has a main-checkout session on `develop` | create a worktree so a worktree session joins that folder group and is re-keyed to the front | the folder header converges to `develop` and NEVER displays the worktree branch at any point in the sequence |
| F2 | R2 | state-convergence | L3 | automated | a folder group whose only sessions are worktree sessions | render the sidebar | the folder header contains no branch link element and no PR pill element |
| F3 | R3 | state-transition | L3 | automated | dashboard with a worktree session grouped under its parent folder, server cache already warm | reload the page (fresh browser connection) | the folder header shows the parent's branch from first paint, without waiting for any HEAD change |
| F4 | R2 | state-convergence | L3 | automated | a folder group with no eligible child, REST seed still in flight | render the sidebar | the dimmed branch icon renders with no branch text and no "Init git" label; no new affordance appears |
| F5 | R1 | state-transition | L3 | automated | folder with both a main session and a worktree session; watcher attached | `git checkout` a different branch in the main checkout, out of band | the folder header converges to the new branch (shipped watcher path still works through the changed fallback) |
| F6 | R2 | visual/subjective | — | manual-only | folder header for a worktree-only folder after the PR pill and branch link are gone | a human looks at the sidebar | [judgment: header layout does not leave a visual gap or misalignment where the pill used to sit] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 | fault-injection (abort) | L1 | automated | `GET /api/git/branches` rejects for a folder with no eligible child | render `GroupGitInfo` | the header does NOT fall back to any ineligible child's branch; no worktree branch is rendered |
| X2 | R1 | fault-injection (abort) | L1 | automated | `readHead` throws for a key entering the set | entry trigger fires | the key is treated as non-git (`branch: null`), broadcast once, and the failure does not propagate out of the refresh |
| X3 | R3 | fault-injection (lifecycle race) | L1 | automated | polling has been stopped, so the poll object is null | a browser connects after shutdown | the snapshot accessor yields an empty set; no `TypeError`; the connection still completes |

---

## Coverage summary

- Requirements covered: 3/3 (R1, R2, R3)
- Scenarios by class: edge 21 · perf 0 · frontend 6 · error 3
- Scenarios by level: L1 24 · L2 0 · L3 5 · manual-only 1
- Scenarios by disposition: automated 29 · manual-only 1

L2 (qa VM smoke) is intentionally empty: nothing in this change touches install, spawn, or multi-OS runtime behaviour. Every rendered-UI assertion is routed to L3 per the AGENTS.md hard rule.

## New infra needed

None. Every level already has an exemplar to extend: `packages/client/src/components/__tests__/SessionCard.test.tsx` (L1 client), `packages/server/src/__tests__/folder-head-poll.test.ts` + `folder-head-integration.test.ts` + `browser-gateway-snapshot-on-connect.test.ts` (L1 server), `tests/e2e/folder-status-capsule.spec.ts` + `tests/e2e/manage-worktrees.spec.ts` (L3 folder-header + worktree surfaces).
