## 1. Composer guard — parentage immutable once resolved (tests first)

All tests extend `packages/server/src/__tests__/git-worktree-compose.test.ts` (copy its `describe("composeWorktreePayload")` case style).

- [ ] 1.1 Test (test-plan #E1): `prior = {mainPath:"/repo", name:"x"}` · `composeWorktreePayload(null, undefined, prior)` · returns the same object reference as `prior`. Verify red.
- [ ] 1.2 Test (test-plan #E2): update the existing "returns null when bridge explicitly clears" case to pass `prior = undefined` explicitly · compose `null` · returns `null`. Verify passes before and after.
- [ ] 1.3 Test (test-plan #E3): `prior = {mainPath:"/a",name:"x"}`, wire `{mainPath:"/b",name:"y"}`, `cachedBase = "main"` · compose · returns `{mainPath:"/b",name:"y",base:"main"}`. Verify passes before and after.
- [ ] 1.4 Test (test-plan #E4): `prior` set, wire `undefined` · compose · returns `undefined`. Verify passes before and after.
- [ ] 1.5 Implement the `prior` parameter in `packages/server/src/git-worktree/git-worktree-compose.ts` per design D1 (`wire === null && prior !== undefined` → return `prior`); update the header comment's case list. Verify 1.1–1.4 green.

## 2. Server handler wiring (tests first)

Tests in `packages/server/src/__tests__/event-wiring-worktree-rekey.test.ts` (reuse its `git_info_update` harness: session manager + browser gateway spy).

- [ ] 2.1 Test (test-plan #E5): session registered cwd `/repo/.worktrees/x` with `gitWorktree` set by a prior `git_info_update` · send `git_info_update { gitWorktree: null, gitBranch: "x" }` · `get(s).gitWorktree` unchanged, `gitWorktreeReported === true`, `broadcastSessionUpdated` payload `gitWorktree` equals the prior object. Verify red.
- [ ] 2.2 Test (test-plan #E6): session with no `gitWorktree` · send `git_info_update { gitWorktree: null }` · `gitWorktree === undefined` and `gitWorktreeReported === true`. Verify passes before and after.
- [ ] 2.3 Implement in `packages/server/src/event-wiring.ts` `git_info_update` handler: pass `sessionManager.get(sessionId)?.gitWorktree` as `prior`; fix the handler comment ("`null` clears unless parentage already set") and the `gitWorktree` doc comment on `git_info_update` in `packages/shared/src/protocol.ts` (no shape change). Verify 2.1–2.2 green and the rest of the rekey suite unchanged-green.

## 3. Same-cwd reattach keeps parentage (tests first)

Tests in `packages/server/src/__tests__/memory-session-manager.test.ts` (copy the existing reattach / `hidden`-preserved case glue).

- [ ] 3.1 Test (test-plan #E7): `register({id:s, cwd:"/repo/.worktrees/x"})`, `update(s,{gitWorktree:{mainPath:"/repo",name:"x"}})` · `register({id:s, cwd:"/repo/.worktrees/x", registerReason:"reattach"})` · `get(s).gitWorktree` deep-equals `{mainPath:"/repo",name:"x"}`. Verify red.
- [ ] 3.2 Test (test-plan #E8): same setup · `register({id:s, cwd:"/elsewhere"})` · `get(s).gitWorktree === undefined`. Verify passes before and after.
- [ ] 3.3 Test (test-plan #E9, in `event-wiring-worktree-rekey.test.ts`): E7 state after reattach · `git_info_update { gitWorktree: null }` · `gitWorktree` still `{mainPath:"/repo",name:"x"}`. Verify red before 3.4 (register drops it today).
- [ ] 3.4 Implement in `packages/server/src/session/memory-session-manager.ts` `register()` carry-over block per design D2b (`gitWorktree: existing.cwd === params.cwd ? existing.gitWorktree : undefined`), comment `See change: fix-worktree-grouping-lost-on-remove`. Verify 3.1–3.3 green; `reattach-placement.test.ts` + `recovery-reattach-retraction.test.ts` unchanged-green.

## 4. Load-time inference from `.worktrees/` layout (tests first)

Tests in `packages/server/src/__tests__/session-worktree-phantom-repair.test.ts` (reuse its `scanAllSessions` + tmp-dir + module-level `node:fs` mock with `statCalls` / `spawns` loggers).

- [ ] 4.1 Test (test-plan #E10): meta `{cwd:"<tmp>/repo/.worktrees/feat-x", cachedAt: now}` with NO `gitWorktree` key, `<tmp>/repo/.git` dir exists · `scanAllSessions` · session `gitWorktree` deep-equals `{mainPath:"<tmp>/repo", name:"feat-x"}` and `.meta.json` bytes identical to before. Verify red.
- [ ] 4.2 Test (test-plan #E11): as 4.1 but meta has `gitWorktree: null` · scan · same result. Verify red.
- [ ] 4.3 Test (test-plan #E12): cwd `<tmp>/repo/.worktrees/feat-x/packages/foo`, `<tmp>/repo/.git` · scan · `{mainPath:"<tmp>/repo", name:"feat-x"}`. Verify red.
- [ ] 4.4 Test (test-plan #E13): meta `gitWorktree.mainPath = "<tmp>/super/.git/modules/x"` (implausible), cwd `<tmp>/repo/.worktrees/feat-x`, `<tmp>/repo/.git` · scan · `{mainPath:"<tmp>/repo", name:"feat-x"}`. Verify red.
- [ ] 4.5 Test (test-plan #E14): meta `gitWorktree = {mainPath:"<tmp>/other", name:"z"}` with `<tmp>/other/.git` dir, cwd `<tmp>/repo/.worktrees/feat-x` with `<tmp>/repo/.git` · scan · `mainPath === "<tmp>/other"`, `name === "z"`; `statCalls` contains `<tmp>/other/.git` and NOT `<tmp>/repo/.git`. Verify passes before and after (step-order regression guard).
- [ ] 4.6 Test (test-plan #E15): cwd `<tmp>/scratch/.worktrees/feat-x`, no `<tmp>/scratch/.git` · scan · `gitWorktree === undefined`; exactly one stat on `<tmp>/scratch/.git`. Verify red on the stat-count assertion.
- [ ] 4.7 Test (test-plan #E16): cwd `.worktrees/feat-x` and separately `/.worktrees/feat-x` · scan · `gitWorktree === undefined`; `statCalls` has no entry ending in `.git` for these records. Verify red would mean a relative stat against the server cwd — must be green after 4.11.
- [ ] 4.8 Test (test-plan #E17): cwd `<tmp>/elsewhere/feat-x`, no parentage · scan · `gitWorktree === undefined`; no stat under `<tmp>/elsewhere`. Verify passes before and after.
- [ ] 4.9 Test (test-plan #E18): cwd `<tmp>/repo/.worktrees/a/.worktrees/b`, `<tmp>/repo/.git` dir, `<tmp>/repo/.worktrees/a/.git` file · scan · `{mainPath:"<tmp>/repo", name:"a"}`. Verify red.
- [ ] 4.10 Test (test-plan #E19): 4.1 meta but `cachedAt` older than the jsonl mtime · scan · `.meta.json` is rewritten by the pre-existing stale-cache path yet still has NO `gitWorktree` key; in-memory session has inferred parentage. Verify red on the in-memory assertion.
- [ ] 4.11 Implement `inferWorktreeFromCwd(cwd)` in `packages/server/src/session/session-scanner.ts` per design D3 (`isAbsolute(cwd)`, first `.worktrees` segment with a follower, non-empty absolute `X`, `isPlausibleWorktreeMainPath(X)`) and chain it after the persisted-plausible branch in `sessionFromMeta`; comment `See change: fix-worktree-grouping-lost-on-remove`. Verify 4.1–4.10 green and `session-scanner.test.ts` unchanged-green.
- [ ] 4.12 Test (test-plan #X1): fs mock `fault` makes `statSync("<tmp>/repo/.git")` throw `EACCES` · scan record with cwd `<tmp>/repo/.worktrees/x` · `gitWorktree === undefined`, scan completes without throwing. Verify green after 4.11.
- [ ] 4.13 Test (test-plan #P1): 500 seeded records under `<tmp>/repo/.worktrees/<i>` without parentage · one scan · `spawns.length === 0` and stat calls on `<tmp>/repo/.git` === 500. Verify green after 4.11.
- [ ] 4.14 Test (test-plan #E20): run the existing extension `model-tracker` / git-poll vitest suites unchanged · bridge still sends `gitWorktree: null` on present→absent. Verify green (regression guard; no code change).

## 5. Browser E2E against the docker harness (tests first)

New spec `tests/e2e/worktree-grouping-survives-remove.spec.ts`. Harness glue: meta seeding via `docker exec`, `POST /api/restart` + `waitForRestart`, `folder-home-row-*` reader — copy from `tests/e2e/submodule-folder-grouping.spec.ts`; worktree create via `/api/git/worktree` + `afterEach` `docker exec git worktree remove --force` / `git branch -D` / `git worktree prune` — copy from `tests/e2e/manage-worktrees.spec.ts`. Ports from `.pi-test-harness.json`; start with `PI_E2E_SEED=1 docker/test-up.sh -d --build`.

- [ ] 5.1 Test (test-plan #F1): `FIXTURE_GIT` pinned; `docker exec` writes an ended session `.meta.json` with cwd `<FIXTURE_GIT>/.worktrees/e2e-heal-<token>` and NO `gitWorktree` key · `POST /api/restart`, `waitForRestart` · `GET /api/sessions` row has `gitWorktree.mainPath === FIXTURE_GIT`; `folder-home-row-*` set does not contain the worktree path. Verify red on a pre-change image, green after.
- [ ] 5.2 Test (test-plan #F2): worktree created under `FIXTURE_GIT`, session spawned in it; `docker exec git worktree remove --force <path>` then `mkdir -p <path>/node_modules` (residual dir) · `expect.poll` on `/api/sessions` for ≤ 2 × 30 s · row keeps `gitWorktree.mainPath === FIXTURE_GIT` throughout; `folder-home-row-*` never gains the worktree path. Verify red on a pre-change image.
- [ ] 5.3 Test (test-plan #X2): 5.2 state with the session still alive · `POST /api/restart`, bridge reattaches · after reattach `GET /api/sessions` row still has `gitWorktree.mainPath === FIXTURE_GIT`. Verify red on a pre-change image (register drop + reconnect resend clears it).
- [ ] 5.4 Test (test-plan #X3): 5.3 state · `shutdownSession`, then `docker exec cat <session>.meta.json` · JSON has `gitWorktree.mainPath === FIXTURE_GIT`. Verify green after 5.3.

## 6. Verification

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` → grep shows no `FAIL`; `npm run quality:changed` clean.
- [ ] 6.2 `npm run test:e2e -- worktree-grouping-survives-remove` green against the local-code harness (see skill `run-dashboard-e2e-local-changes`); harness torn down after.
- [ ] 6.3 Restart the local server (`curl -X POST http://localhost:8000/api/restart`), then confirm via `GET /api/sessions` that zero sessions with `cwd` under `/Users/robson/Project/pi-agent-dashboard/.worktrees/` lack `gitWorktree` (was 57, incl. the 2 subdirectory-cwd records under `.worktrees/ab-impl/`), and the sidebar shows no top-level `.worktrees/<name>` folder cards.

## 7. Docs closeout

- [ ] 7.1 Update rows in `packages/server/src/git-worktree/AGENTS.md` (+ `git-worktree-compose.ts.AGENTS.md` sidecar: new `prior` arg, "`null` (bridge cleared)" → conditional), `packages/server/src/session/AGENTS.md` (+ `session-scanner.ts.AGENTS.md`: inference step, test file; `memory-session-manager.ts` row: `gitWorktree` reattach carry-over), `packages/shared/src/AGENTS.md` row for `protocol.ts` if it quotes the null-clears wording, and `tests/e2e/AGENTS.md` row for the new spec. Verify `kb dox lint` reports no stale rows for these files.
- [ ] 7.2 Delegate to DocScribe: if `docs/architecture.md` describes the `git_info_update` null-clear path or cold-start grouping, add the immutability rule + reattach carry-over + inference in caveman style. Verify grep for `gitWorktree` in `docs/` reflects the new behaviour.
