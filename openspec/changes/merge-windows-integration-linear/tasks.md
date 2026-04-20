## Cherry-pick source

Primary source: `origin/windows-integration-v2` (80 net-new commits vs develop by patch-id).
Secondary source: `origin/windows-integration` HEAD (`bbc11a9`) — contains 2 commits that post-date v2 and are needed: `cce2e57` (tool-registry per-platform) and `304a82b` (terminal X button). The other 3 WI-only commits (`337e5c4` proposal doc duplicate, `8bfe769` compress-lock, `bbc11a9` TS errors post-merge) are v2-local or already on develop and are skipped.

SHAs below are short-form. Run `git show <sha>` on the source remote before picking to confirm.

## Phase -1. Preflight

- [x] -1.1 `git fetch origin` — ensure `origin/windows-integration`, `origin/windows-integration-v2`, `origin/develop` are current
- [x] -1.2 Confirm develop base. Local develop at `e7a51e2` (`docs(openspec): add bootstrap hardening proposals`); net-new counts reconfirmed: 80 (v2) / 54 (WI). Branching off local `develop` HEAD (includes this proposal commit `5084108` + bootstrap-hardening commit `e7a51e2`).
- [x] -1.3 `git tag -a pre-windows-v3-merge develop -m "rollback anchor before windows-integration-v3"` — tagged at `e7a51e2`; local only, push after Phase 0
- [x] -1.4 `git checkout -b windows-integration-v3 develop` — branch created at `e7a51e2`

## Phase 0. Safety fixes (bucket #5) — 5 commits

Goal: develop is less broken on fresh Windows install after this phase even if no later phase lands.

- [ ] 0.1 `git cherry-pick 8c2cde5` — chore(server): require Node >=22.18.0 via engines field
- [ ] 0.2 `git cherry-pick 4c564fc` — feat(server): refuse to start on Node versions affected by nodejs/node#58515 (node-guard.ts + 17 tests)
- [ ] 0.3 `git cherry-pick 40a1319` — fix(server): bridge auto-registration path math was off by one
- [ ] 0.4 `git cherry-pick e11f5eb` — fix(extension): resolve server CLI via require.resolve, not sibling path math
- [ ] 0.5 `git cherry-pick 9397320` — fix(server): client-dir resolution works in installed layouts  _(short SHA `9397320` on v2 = `93973206bd5edeafdaf122703a3519363cb2ba8e`)_
- [x] 0.6 Validation: `npm install && npm test` green — 2161/2161 passed in 97.7s
- [x] 0.7 Validation: `npm run build` green — client + server built, precompress ran (5.79 MB → 1.73 MB)
- [ ] 0.8 Validation: start dashboard via `npm run dev`, confirm bridge auto-registers on a fresh `~/.pi/agent/settings.json` (delete + restart if pre-seeded) _SKIPPED in agent session (destructive to live pi session); manual gate for operator_
- [x] 0.9 `git push origin windows-integration-v3 pre-windows-v3-merge` — pushed after Phase 4 per user direction (branch + tag now on origin; CI triggered)

## Phase 1. platform/ primitives foundation (bucket #1) — 9 commits

Goal: `packages/shared/src/platform/*` exists and is importable; `ToolRegistry` operational.

**Excludes** consolidation commits (`a73178d`, `2aa1d50`, `21d7dc4`, `ab017d8`, `01ac562`) per proposal §Excluded.

- [x] 1.1 `git cherry-pick 6716a4f` — fix: cross-platform server launch (conflict resolved: headless-pid-registry.ts killAll kept test-env-guard; dropped dead useGroup var)
- [x] 1.2 `git cherry-pick f7cfe82` — moved platform primitives (conflicts resolved: AGENTS.md + docs/architecture.md docs merged; consolidate-platform-handlers/tasks.md accepted incoming)
- [x] 1.3 `git cherry-pick 059dfe0` — centralize subprocess exec (conflicts resolved: 4 server files accepted theirs — directory-handler, package-manager-wrapper, pi-resource-scanner, openspec-poller now use platform/* modules)
- [x] 1.4 `git cherry-pick ca978d4` — ToolRegistry (conflicts: server.ts merged pi-core + tool-routes imports; dependency-detector.ts accepted theirs; duplicate portable-windows-pm archive removed)
- [x] 1.5 `git cherry-pick f04a173` — OS-aware path normalization (conflict: PathPicker.tsx kept develop's createDirectory + incoming withTrailingSep/inferPlatform)
- [x] 1.6 `git cherry-pick 5ab7956` — consolidate Windows spawn (conflicts: AGENTS.md tool-registry rows accepted theirs; binary-lookup.ts whichSync via spawnSync accepted theirs; runner.ts buildSafeArgv accepted theirs)
- [x] 1.7 `git cherry-pick 9c497b8` — detach option to SpawnDetachedOptions (clean)
- [x] 1.8 `git cherry-pick c26ec59` — waitForReady deadlineMs optional (clean)
- [x] 1.9 `git cherry-pick cce2e57` — tool-registry per-platform process-inspection (clean)
- [x] 1.10 Validation: `npm run build` green
- [ ] 1.11 Validation: `npm test` — **32/2515 failing** (expected per proposal Phase 5); deferred to Phase 5 re-derivation
- [ ] 1.12 Validation: three lint-style tests — `no-direct-child-process` + `no-direct-platform-branch` failing (new files need allowlist update); Phase 5

## Phase 2. Windows fixes on top of #1 (bucket #2) — 6 commits

- [x] 2.1 ~~1239201 cmd.exe flash~~ **SKIPPED as superseded** by 059dfe0 (execFileAsync calls replaced with platform/runner which bakes in windowsHide:true)
- [x] 2.2 ~~bb05398 PATHEXT via execSync loop~~ **SKIPPED as superseded** by 5ab7956 (already picked) which does PATHEXT resolution via single spawnSync call
- [x] 2.3 ~~4bfb77b PATHEXT + shell:true~~ **SKIPPED as superseded** by 5ab7956 buildSafeArgv + 059dfe0 runner refactor
- [x] 2.4 `git cherry-pick 26e033e` — detach:false for pi-session spawn (clean)
- [x] 2.5 `git cherry-pick 39acb1e` — platform/process tree-kill (conflicts: server.ts dropped redundant cleanupStaleZrok call; tunnel.ts merged killPidWithGroup + SIGKILL escalation + releaseShare)
- [x] 2.6 `git cherry-pick 304a82b` — terminal X button taskkill (conflict: terminal-manager.ts kept platform/shell.js import path, added killProcess from platform/process.js)
- [ ] 2.7 Validation: `npm test` — deferred to Phase 5 (build green)
- [ ] 2.8 Manual Windows smoke — deferred (operator gate)

## Phase 3. Electron migration (bucket #3) — 3 commits

- [x] 3.1 ~~a97514e ToolResolver migration~~ **SKIPPED as superseded** by ca978d4 ToolRegistry (already picked)
- [x] 3.2 ~~455ced4 doctor/detector ToolResolver + isDashboardRunning~~ **SKIPPED** — depends on `isKnownBadNode` from `platform/node-version-check.js` which doesn't exist on our branch (post-merge v2-local work); node-guard.ts already covers version checking
- [x] 3.3 `git cherry-pick 8402565` — Electron server spawn via buildServerSpawnOptions (clean)
- [ ] 3.4 Validation: `npm run build` green
- [ ] 3.5 Manual Electron smoke — deferred (operator gate)

## Phase 4. Bridge extension (bucket #4) — 6 commits

- [x] 4.1 `git cherry-pick 00e2e9b` — wait indefinitely for server readiness (clean)
- [x] 4.2 `git cherry-pick 9a9f2da` — onLaunchStart/onLaunchEnd callbacks (clean)
- [x] 4.3 `git cherry-pick bc6cb5d` — braille spinner (clean)
- [x] 4.4 `git cherry-pick 7239129` — pi-tui Loader widget (clean)
- [x] 4.5 `git cherry-pick e2357fd` — spawn_error browser message (clean)
- [x] 4.6 `git cherry-pick 050d5dd` — WSL-tmux probe cache (clean)
- [ ] 4.7 Validation: `npm test` — deferred to Phase 5
- [ ] 4.8 Manual bridge smoke — deferred (operator gate)

## Phase 5. Test infra (bucket #6) — 3 commits + re-derivation

**v2's `31f5c68` is explicitly NOT picked** (re-conflict risk per design.md).

- [ ] 5.1 `git cherry-pick ce1576d` — test: fix cross-platform assumptions in test fixtures (Windows parity)
- [ ] 5.2 `git cherry-pick b4f712a` — test: add process.kill-ban lint and platform-routing kill-path tests
- [ ] 5.3 Run `npm test` across all workspaces; capture failure list
- [ ] 5.4 Triage failures package-by-package; for each failure, consult `git show 31f5c68:<path>` on v2 for reference fix; adapt to fresh merge state
- [ ] 5.5 Commit test fixes as single `fix(tests): restore green baseline after platform/ + electron + bridge integration`
- [ ] 5.6 Validation: 2519/2519 (or current baseline) green across all workspaces

## Phase 6. Drift features (bucket #8) — 6 commits, each separate

Per user direction: keep as separate commits on the same branch; do not bundle or spin out to separate branches.

- [ ] 6.1 `git cherry-pick 1ee114c` — harden ask_user argument validation
- [ ] 6.2 `git cherry-pick 9446e43` — feat: add pi core version checker and update UI
- [ ] 6.3 `git cherry-pick 6b39c3c` — fix(pi-core): broadcast pi_core_update_complete so the header badge refetches
- [ ] 6.4 `git cherry-pick 302c1c7` — feat(path-picker): server-side filter, smarter Enter, new-folder creation
- [ ] 6.5 `git cherry-pick b80121f` — fix(tunnel): eliminate zrok reservation leaks + shrink client bundle + compress responses _(triple-feature commit; kept as-is per design.md)_
- [ ] 6.6 `git cherry-pick 850abe9` — fix(lint): add ban:child_process-ok markers to pi-core-{checker,updater}.ts
- [ ] 6.7 Validation: `npm test` green, `npm run build` green, smoke each feature individually:
  - pi-core: open Settings → Packages → Pi Core Versions, confirm versions render + Check Now works
  - path-picker: open "Pin a folder", type, confirm server-side filtering
  - zrok: start tunnel, confirm no reservation leak on restart

## Phase 7. OpenSpec docs + archives (bucket #7) — ~8 commits

Pick in one batch at the end; validate `openspec list` + `openspec validate` after each.

- [ ] 7.1 `git cherry-pick 170434e` — docs: document cross-platform server launch, restart, and log hygiene
- [ ] 7.2 `git cherry-pick cf84058` — docs: archive fix-windows-server-parity change and sync main specs
- [ ] 7.3 `git cherry-pick d0adac2` — docs: add consolidate-platform-handlers openspec proposal (active proposal for the deferred 18→13 consolidation)
- [ ] 7.4 `git cherry-pick 2257b08` — docs: refine fix-fork-entryid-timing proposal (see design.md open question #1; if content already archived on develop, fold refinements into archived artifact or skip)
- [ ] 7.5 `git cherry-pick a4f9860` — docs: document platform-routed kill paths in AGENTS and architecture
- [ ] 7.6 `git cherry-pick 0be288f` — docs: archive route-kill-paths-through-platform change and sync main specs
- [ ] 7.7 `git cherry-pick de695e1` — docs(readme): bump required Node to 22.18.0 (nodejs/node#58515)
- [ ] 7.8 `git cherry-pick 821cd63` — chore(openspec): sync and archive 4 completed changes (2026-04-20) _(cherry-pick may become partial/empty if archives already on develop; `--allow-empty` if needed)_
- [ ] 7.9 Add THIS proposal's own artifacts to its superseded-by pointer: update `openspec/changes/adapt-windows-integration-pr9/.openspec.yaml` with `status: superseded` and `superseded-by: merge-windows-integration-linear` (or equivalent field per OpenSpec schema). Commit as `chore(openspec): mark adapt-windows-integration-pr9 superseded`
- [ ] 7.10 Validation: `openspec list` shows no phantom active changes; `openspec validate` green
- [ ] 7.11 Validation: `npm test` green (archive moves can affect spec-coherence tests if any)

## Phase 8. Pre-PR gates

- [ ] 8.1 CI green on Windows, macOS, Linux matrix (full `npm test`)
- [ ] 8.2 CI green on Electron make matrix (DMG / AppImage / NSIS / ZIP)
- [ ] 8.3 Manual Windows smoke per Phase 2.8 + Phase 3.5 + Phase 4.8
- [ ] 8.4 Manual macOS + Linux smoke: landing page, session spawn, terminal, editor, zrok QR
- [ ] 8.5 Three lint-style tests green: `no-direct-child-process`, `no-direct-process-kill`, `no-direct-platform-branch`
- [ ] 8.6 CHANGELOG `[Unreleased]` populated with user-visible changes (Windows parity, ToolRegistry, platform/ module, drift features)
- [ ] 8.7 Diff review against `adapt-windows-integration-pr9` durable-requirements spec (specs/cross-platform-merge-baseline/) — confirm all four durable requirements preserved

## Phase 9. PR and release

- [ ] 9.1 Open PR `windows-integration-v3 → develop`; link this proposal, link PR #9 as superseded source
- [ ] 9.2 After merge, run `release-cut` skill to cut `v0.4.0`
- [ ] 9.3 After v0.4.0 ships and smoke-tests green for 24h, open follow-up PR for `platform/` 18→13 consolidation (commits `a73178d`, `2aa1d50`, `21d7dc4`, `ab017d8`, `01ac562` from v2) — tracked by `consolidate-platform-handlers` proposal

## Rollback

Any phase can roll back to `pre-windows-v3-merge` tag:

```bash
git reset --hard pre-windows-v3-merge
git push --force-with-lease origin windows-integration-v3
```

If post-merge on develop regresses, `v0.3.0` remains on npm + GitHub Releases. Deprecate v0.4.0 via `release-revoke` skill; do not unpublish.
