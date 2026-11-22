# Test Plan — fix-openspec-readiness-shared-skills

Stage: design   Generated: 2026-11-20

Scope: `hasOpenSpecSkillsFor` (`packages/server/src/directory-service.ts:591`) probes `<configRoot>/.pi/skills/openspec-explore` then `<configRoot>/.agents/skills/openspec-explore` (short-circuit, existence-only via `statMtimeOr` = `fs.statSync`, follows symlinks); `null` root → `false`, nothing probed under cwd. Spec: `openspec-readiness` (2 MODIFIED requirements). Doc-comment + docs edits have no runtime observable → no scenarios.

Harness exemplars (verified to exist):
- L1 → `packages/server/src/__tests__/directory-service-readiness.test.ts` — service-level pattern = test "E14: worktree cwd inherits…" (`mkProject`, `fakeConfigRoot`, `service.refreshOpenSpec(cwd)`); null-root pattern = "apply-checkout-root E20…". Needs one new helper variant `mkProject(cwd,{sharedSkills:true})` creating `.agents/skills/openspec-explore`.
- L3 → `tests/e2e/openspec-init-affordances-folder.spec.ts` (helpers `makeDir`, `dsh`, `pinAndExpand`, `initDir`, `folderCard`, `section`; STALE·missing-skills pattern = F3 "rm -rf .pi") and `tests/e2e/openspec-init-affordances-session-card.spec.ts` (F9 `spawnSessionIn`, `session-openspec-disabled`). NOTE: most existing cases in both files are `test.fixme` under #683 (quarantine); new specs should live in their own non-fixme `test()` blocks.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | Skill presence / "Shared-layout project is not missing skills" | EP (valid class: shared-only) | L1 | automated | `<cwd>/openspec/changes/` + `<cwd>/.agents/skills/openspec-explore/`; no `.pi/`; config root = cwd; recorded sig = current sig | `service.refreshOpenSpec(cwd)` | `out.hasOpenSpecSkills === true`; `out.readiness` toEqual `{state:"READY"}` (not STALE/missing-skills). Exemplar: readiness.test "READY parity" |
| S3 | Skill presence (short-circuit order) | decision-table (row both=Y) | L1 | automated | both `.pi/skills/openspec-explore/` and `.agents/skills/openspec-explore/` exist | `refreshOpenSpec(cwd)` | `hasOpenSpecSkills === true`; readiness READY |
| S4 | "Project initialized without pi tooling" + "Non-worktree without skills is stale" | decision-table (row both=N) | L1 | automated | `openspec/changes/` only; neither layout; recorded sig present | `refreshOpenSpec(cwd)` | `initialized: true` AND `hasOpenSpecSkills === false`; readiness toEqual `{state:"STALE", reason:"missing-skills"}`. Exemplar: "attaches readiness + hasOpenSpecSkills to a polled payload (STALE path)" |
| S5 | Skill presence (sentinel is `openspec-explore`) | EP (invalid class: wrong sibling) | L1 | automated | `<cwd>/.agents/skills/` exists with `other-skill/` and `openspec-propose/` but no `openspec-explore/`; no `.pi/skills` | `refreshOpenSpec(cwd)` | `hasOpenSpecSkills === false`; STALE·missing-skills |
| S6 | Skill presence (empty parent dir) | BVA (min: dir exists, 0 entries) | L1 | automated | `<cwd>/.agents/skills/` empty dir; no `.pi/skills` | `refreshOpenSpec(cwd)` | `hasOpenSpecSkills === false` |
| S7 | Worktree / "Worktree inherits a shared-layout answer from its main checkout" | decision-table (row wt=N, main=shared) | L1 | automated | `fakeConfigRoot: wt→main`; worktree has `openspec/changes/` only; main has `.agents/skills/openspec-explore/` only | `refreshOpenSpec(worktree)` | `hasOpenSpecSkills === true`; readiness READY. Exemplar: "E14" |
| S9 | Worktree / accepted trade-off ("inherits false from a main checkout that lacks it") | decision-table (row wt=shared, main=none) | L1 | automated | `fakeConfigRoot: wt→main`; worktree itself has `.agents/skills/openspec-explore/`; main has neither layout | `refreshOpenSpec(worktree)` | `hasOpenSpecSkills === false`; STALE·missing-skills (answer comes from config root only, no per-layout worktree exemption) |
| S10 | Worktree (mixed layouts) | decision-table (row wt=shared, main=legacy) | L1 | automated | worktree has `.agents/skills/openspec-explore/`; main has `.pi/skills/openspec-explore/` only | `refreshOpenSpec(worktree)` | `true` (main's legacy answer wins; worktree's own copy irrelevant) |
| S11 | "Null config root refuses both layouts" | decision-table (row root=null, shared at cwd) | L1 | automated | `fakeConfigRoot = () => null`; `<cwd>/.agents/skills/openspec-explore/` exists | `refreshOpenSpec(cwd)` | `hasOpenSpecSkills === false` (second probe respects refusal, not coerced to cwd). Exemplar: "apply-checkout-root E20" |
| S12 | Null config root (both layouts) | decision-table (row root=null, both at cwd) | L1 | automated | `fakeConfigRoot = () => null`; both layouts under cwd | `refreshOpenSpec(cwd)` | `false`; additionally `fs.statSync` spy never called with any path under cwd matching `/skills/openspec-explore` |
| S13 | Null-root TTL recovery (existing behaviour must hold for shared layout) | state-transition (null → resolvable) | L1 | automated | shared-only project; `fakeConfigRoot=()=>null`, `Date.now` mocked | poll → root becomes cwd → advance 61s → poll | 1st+2nd poll `false` (2nd with no extra `configRootCalls`); post-TTL poll `true` + READY. Exemplar: "a null config root is re-probed after its TTL…" |
| S14 | Non-goal pin: no ancestor walk | EP (invalid class: skills in ancestor) | L1 | automated | `fakeConfigRoot: pkg→pkg`; `<tmp>/.agents/skills/openspec-explore/` at the PARENT of `<tmp>/pkg` (which has `openspec/changes/` only) | `refreshOpenSpec(pkg)` | `hasOpenSpecSkills === false` (config root checked only; pi would discover it but dashboard intentionally doesn't) |
| S15 | Skill presence (symlinked shared skill) | EP (valid: symlink→dir; invalid: broken symlink) | L1 | automated | (a) `.agents/skills/openspec-explore` symlink → existing dir; (b) symlink → nonexistent target | `refreshOpenSpec(cwd)` | (a) `true`; (b) `false` (statSync follows links; ENOENT swallowed). Skip on win32 (symlink privilege) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Proposal Discipline claim: "one extra short-circuited stat" | call-count threshold (dependency signal) | L1 | automated | single `refreshOpenSpec(cwd)` with `fs.statSync` spied; case A: legacy present; case B: legacy absent + shared present; case C: both absent | count of `statSync` calls on `…/openspec-explore` paths: A = exactly 1 (short-circuit, no `.agents` probe); B = 2; C = 2 | single poll |

(No latency/soak scenario: change adds ≤1 `stat` to an existing per-poll stat pass; no new endpoint/loop. Stating a ms threshold would be invented.)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Shared-layout not missing skills (issue #1165 folder-card symptom) | state-transition + convergence | L3 | automated | dir created via `makeDir`, pinned+expanded; `initDir` (real CLI writes `.pi/skills`); then `rm -rf <dir>/.pi` → folder state pill `skills missing` | out-of-band `mkdir -p <dir>/.agents/skills/openspec-explore` (no server restart), wait for next poll | `folder-openspec-state` pill converges to NOT matching `/skills missing/i` and the folder OpenSpec board/section (non-`stale` variant via `section(page,dir,"")`) becomes visible; asserted by web-first `expect().toHaveText/not.toHaveText` with poll timeout 30s, no fixed sleeps. Exemplar: `openspec-init-affordances-folder.spec.ts` F3 setup (`initDir`, `dsh rm -rf .pi`, `folder-openspec-state`) |
| F2 | Shared-layout not missing skills (session-card controls) | state-transition + invariant | L3 | automated | dir with `openspec/` initialised and skills ONLY under `.agents/skills/openspec-explore` (`.pi` removed); `spawnSessionIn(page, dir)` | open session card after next poll | `session-openspec-disabled` has count 0 (controls enabled; no "skills are missing" reason text). Exemplar: `openspec-init-affordances-session-card.spec.ts` F9 (reverse polarity of its missing-skills branch) |
| F3 | Reverse transition (regression: removing both layouts re-raises the pill) | state-transition (illegal/negative edge) | L3 | automated | continue F1 end-state; then `rm -rf <dir>/.agents` | next poll | pill converges back to `/skills missing/i` (readiness not stuck READY from a cached answer) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Skill presence (probe fault tolerance) | fault-injection (abort: EACCES on legacy probe) | L1 | automated | `fs.statSync` spy throws `EACCES` for `<root>/.pi/skills/openspec-explore`; `.agents/skills/openspec-explore/` exists | `refreshOpenSpec(cwd)` | no throw; poll completes; `hasOpenSpecSkills === true` (second probe still runs after first fails) |
| X2 | Skill presence (both probes fail) | fault-injection (abort: EACCES on both) | L1 | automated | `fs.statSync` throws `EACCES` for both skill paths | `refreshOpenSpec(cwd)` | no throw; `hasOpenSpecSkills === false`; readiness STALE·missing-skills; payload otherwise intact (`initialized: true`) |
| X3 | Skills presence recomputed every poll (spec scenario "Skills relocation is reflected on the next poll"; gap G1 → recomputed each poll) | state-transition (cache staleness) | L1 | automated | service, project with `openspec/changes/` only and no skills dir → first `pollDirectoryGated` returns `hasOpenSpecSkills === false`; then create `<cwd>/.agents/skills/openspec-explore` WITHOUT touching `openspec/` mtimes; then (second step) remove `<cwd>/.agents` | second `pollDirectoryGated` after creation; third after removal | second payload `hasOpenSpecSkills === true` + READY (not frozen by the unchanged-`openspec/` gate reuse); third payload `false` + STALE·missing-skills. If apply-time code check shows a cached answer, falling to a fingerprint widening is a scope decision (see proposal) |

---

## Coverage summary

- Requirements covered: 2/2 MODIFIED requirements + the new "Skills relocation is reflected on the next poll" scenario (X3/F1/F3). Spec scenarios map: "Shared-layout project is not missing skills" S1/F2; "Project initialized without pi tooling" S4; "Worktree inherits a shared-layout answer" S7; "Non-worktree without skills is stale" S4; "Null config root refuses both layouts" S11.
- Scenarios by class: edge 13 · perf 1 · frontend 3 · error 3
- Scenarios by level: L1 17 · L2 0 · L3 3 (F1,F2,F3)
- Scenarios by disposition: automated 20 · manual-only 0
- Not tabled (already covered by existing, unchanged tests; ids S2/S8/S16 retired): legacy-only READY (`READY parity` in `directory-service-readiness.test.ts`), legacy worktree inheritance (`E14`), `undefined` never infers absence (`hasOpenSpecSkills unknown (undefined) never marks STALE`). Task 1.1 re-runs them as the regression guard.
- Former manual task 4.3 is replaced by F1/F2/F3 (automatable at L3).

## New infra needed

- `mkProject` option `sharedSkills` for `.agents/skills/openspec-explore` (trivial, same test file).
- L3: none (harness exists); new `test()` blocks live in a new non-fixme spec file (existing cases in the openspec-init-affordances specs are `test.fixme` under #683).
