# Test Plan — fix-worktree-grouping-lost-on-remove

Stage: design   Generated: 2026-09-14

No clarifications needed — every Triple slot resolves from the delta specs + design (poll interval `GIT_POLL_INTERVAL = 30_000` in `packages/extension/src/bridge.ts`; on-disk broken shape = `gitWorktree` key absent).

Requirement refs: **GC** = `git-context` "Worktree identity propagation through session protocol"; **SG** = `session-grouping` "Cold-start grouping parity for worktree/workspace sessions"; **BP** = `bridge-session-state-poll` "Change-detected git forwarding". Design refs D1–D4.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | GC "Worktree removed underneath" / D1 | state-transition (set→null) | L1 | automated | `prior = {mainPath:"/repo", name:"x"}`, `cachedBase = undefined` | `composeWorktreePayload(null, undefined, prior)` | returns the SAME object reference as `prior` |
| E2 | GC "Null clears when no parentage" / D1 | state-transition (unset→null) | L1 | automated | `prior = undefined` | `composeWorktreePayload(null, undefined, undefined)` | returns `null` (existing case, now with explicit third arg) |
| E3 | GC "Live worktree state update" / D1 | state-transition (set→set) | L1 | automated | `prior = {mainPath:"/a", name:"x"}`, wire `{mainPath:"/b", name:"y"}`, `cachedBase = "main"` | compose | returns `{mainPath:"/b", name:"y", base:"main"}` — prior does not block object updates |
| E4 | GC "Backward compatibility" / D1 | EP (omitted field) | L1 | automated | `prior` set, wire `undefined` | compose | returns `undefined` (no change) — unchanged branch |
| E5 | GC "Worktree removed underneath" (server) | state-transition | L1 | automated | session `s` registered cwd `/repo/.worktrees/x`, `gitWorktree` set via prior `git_info_update` | `git_info_update { gitWorktree: null, gitBranch: "x" }` | `sessionManager.get(s).gitWorktree` unchanged; `gitWorktreeReported === true`; `broadcastSessionUpdated` payload `gitWorktree` equals prior object |
| E6 | GC "Null clears when no parentage" (server) | state-transition | L1 | automated | session `s` with no `gitWorktree` | `git_info_update { gitWorktree: null }` | `gitWorktree === undefined`; `gitWorktreeReported === true` |
| E7 | GC "Reattach in the same cwd preserves parentage" / D2b | state-transition (reattach) | L1 | automated | `register({id:s, cwd:"/repo/.worktrees/x"})`, `update(s, {gitWorktree:{mainPath:"/repo",name:"x"}})` | `register({id:s, cwd:"/repo/.worktrees/x", registerReason:"reattach"})` | `get(s).gitWorktree` deep-equals `{mainPath:"/repo",name:"x"}` |
| E8 | GC "Reattach in a different cwd resets parentage" / D2b | state-transition (reattach, cwd Δ) | L1 | automated | same as E7 | `register({id:s, cwd:"/elsewhere"})` | `get(s).gitWorktree === undefined` |
| E9 | GC "Reattach … preserves" + "removed underneath" chain / D2b+D1 | state-transition (2-step) | L1 | automated | E7 state after reattach | `git_info_update { gitWorktree: null }` | `gitWorktree` still `{mainPath:"/repo",name:"x"}` |
| E10 | SG "Missing parentage inferred" / D3 | decision-table (persisted absent) | L1 | automated | `.meta.json` `{cwd:"<tmp>/repo/.worktrees/feat-x", cachedAt: now}` (no `gitWorktree` key), `<tmp>/repo/.git` dir exists | `scanAllSessions` | session `gitWorktree` deep-equals `{mainPath:"<tmp>/repo", name:"feat-x"}`; `.meta.json` bytes identical to before scan |
| E11 | SG "Missing parentage inferred" (explicit null) | decision-table (persisted null) | L1 | automated | as E10 but `gitWorktree: null` in meta | scan | same as E10 |
| E12 | SG "Session cwd is a subdirectory" / D3 | BVA (depth > 1) | L1 | automated | cwd `<tmp>/repo/.worktrees/feat-x/packages/foo`, `<tmp>/repo/.git` | scan | `{mainPath:"<tmp>/repo", name:"feat-x"}` |
| E13 | SG "Implausible persisted parentage is replaced" / D3 | decision-table (persisted implausible) | L1 | automated | meta `gitWorktree.mainPath = "<tmp>/super/.git/modules/x"`, cwd `<tmp>/repo/.worktrees/feat-x`, `<tmp>/repo/.git` | scan | `{mainPath:"<tmp>/repo", name:"feat-x"}` |
| E14 | SG persisted plausible wins / D3 step order | decision-table (persisted plausible) | L1 | automated | meta `gitWorktree = {mainPath:"<tmp>/other", name:"z"}`, `<tmp>/other/.git` dir, cwd `<tmp>/repo/.worktrees/feat-x` with `<tmp>/repo/.git` | scan | `mainPath === "<tmp>/other"`, `name === "z"`; stat log contains `<tmp>/other/.git` and NOT `<tmp>/repo/.git` |
| E15 | SG "Inference declines when parent is not a repo" | decision-table (`<X>/.git` absent) | L1 | automated | cwd `<tmp>/scratch/.worktrees/feat-x`, no `<tmp>/scratch/.git` | scan | `gitWorktree === undefined`; exactly one stat on `<tmp>/scratch/.git` |
| E16 | SG "Inference declines for relative or leading-`.worktrees`" / D3 | BVA (segment index 0 / empty X) | L1 | automated | cwd `.worktrees/feat-x` and separately `/.worktrees/feat-x` | scan | `gitWorktree === undefined`; stat log contains NO path ending in `.git` for these records (no relative stat against server cwd) |
| E17 | SG "Legacy session without persisted parentage" | EP (no `.worktrees` segment) | L1 | automated | cwd `<tmp>/elsewhere/feat-x`, no parentage in meta | scan | `gitWorktree === undefined`; no stat under `<tmp>/elsewhere` |
| E18 | SG nested `.worktrees` (design D3 known limitation) | BVA (two `.worktrees` segments) | L1 | automated | cwd `<tmp>/repo/.worktrees/a/.worktrees/b`, `<tmp>/repo/.git` dir, `<tmp>/repo/.worktrees/a/.git` file | scan | `{mainPath:"<tmp>/repo", name:"a"}` (first segment wins) |
| E19 | SG inference is read-only vs stale-cache path / D4 | state-transition (cachedAt older than jsonl) | L1 | automated | E10 meta but `cachedAt` older than the jsonl mtime | scan | `.meta.json` IS rewritten by the pre-existing stale-cache path but still has NO `gitWorktree` key; in-memory session has inferred parentage |
| E20 | BP "present→absent encoded explicitly" (unchanged bridge) | regression | L1 | automated | existing `model-tracker` / git-poll tests | run unchanged | bridge still sends `gitWorktree: null` on present→absent (no extension change) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | SG inference "no subprocess" / D3 | invariant (fs-mock counter) | L1 | automated | 500 seeded records under `<tmp>/repo/.worktrees/<i>` without parentage | `spawn`/`execFileSync` call count == 0; stat calls on `<tmp>/repo/.git` == 500 (one per record) | single scan |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | SG "Missing parentage inferred" → sidebar | state-convergence (restart re-seed) | L3 | automated | harness: `FIXTURE_GIT` pinned; `docker exec` writes an ended session `.meta.json` with cwd `<FIXTURE_GIT>/.worktrees/e2e-heal-<token>` and NO `gitWorktree` key (exemplar `tests/e2e/submodule-folder-grouping.spec.ts` seeding) | `POST /api/restart`, `waitForRestart` | `GET /api/sessions` row has `gitWorktree.mainPath === FIXTURE_GIT`; `folder-home-row-*` set does NOT contain `<FIXTURE_GIT>/.worktrees/e2e-heal-<token>` |
| F2 | GC "Worktree removed underneath" end-to-end | state-convergence (live poll) | L3 | automated | harness: worktree created via `/api/git/worktree` under `FIXTURE_GIT`, session spawned in it (exemplar `manage-worktrees.spec.ts` + `submodule-folder-grouping.spec.ts` spawn glue); `docker exec` `git worktree remove --force <path>` then `mkdir -p <path>/node_modules` to leave a residual dir | wait ≤ 2 × 30 s poll ticks (`expect.poll` on `/api/sessions`) | session row keeps `gitWorktree.mainPath === FIXTURE_GIT` for the whole window; `folder-home-row-*` never gains the worktree path |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | SG inference stat failure | fault-injection (stat throws EACCES) | L1 | automated | fs mock: `statSync("<tmp>/repo/.git")` throws `EACCES` | scan record with cwd `<tmp>/repo/.worktrees/x` | `gitWorktree === undefined`; scan completes; no throw propagates |
| X2 | GC guard + restart in removal window / D2b | fault-injection (server restart mid-window) | L3 | automated | F2 setup after the residual dir exists and the session still alive | `POST /api/restart`; bridge reattaches (reconnect cache reset forces a `null` re-send) | after reattach `GET /api/sessions` row still has `gitWorktree.mainPath === FIXTURE_GIT` |
| X3 | GC persisted meta after end | fault-injection (session end after removal) | L3 | automated | X2 state | `shutdownSession`, then `docker exec cat <session>.meta.json` | meta JSON has `gitWorktree.mainPath === FIXTURE_GIT` |

---

## Coverage summary

- Requirements covered: 3/3 (GC 8/8 scenarios, SG 8/8 scenarios, BP 1 regression)
- Scenarios by class: edge 20 · perf 1 · frontend 2 · error 3
- Scenarios by level: L1 22 · L2 0 · L3 4
- Scenarios by disposition: automated 26 · manual-only 0

## New infra needed

- none — L1 rows extend `git-worktree-compose.test.ts`, `event-wiring-worktree-rekey.test.ts`, `memory-session-manager.test.ts`, `session-worktree-phantom-repair.test.ts` (fs-mock stat/spawn logger already present); L3 rows reuse `submodule-folder-grouping.spec.ts` (meta seeding + restart + folder rows) and `manage-worktrees.spec.ts` (worktree create + `docker exec` teardown).
