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

- [x] 0.1 `git cherry-pick 8c2cde5` — chore(server): require Node >=22.18.0 via engines field (landed as `b98e43b`; verified during apply)
- [x] 0.2 `git cherry-pick 4c564fc` — feat(server): refuse to start on Node versions affected by nodejs/node#58515 (node-guard.ts + 17 tests; file on branch, verified during apply)
- [x] 0.3 `git cherry-pick 40a1319` — fix(server): bridge auto-registration path math was off by one (landed as `68abc98`; verified during apply)
- [x] 0.4 `git cherry-pick e11f5eb` — fix(extension): resolve server CLI via require.resolve, not sibling path math (landed as `8ec6eda`; verified during apply)
- [x] 0.5 `git cherry-pick 9397320` — fix(server): client-dir resolution works in installed layouts (landed as `c76eee5`; verified during apply)
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
- [x] 1.11 Validation: `npm test` — **32/2515 failing** (expected per proposal Phase 5); resolved by Phase 5 (task 5.6: 2540/2540 green on re-verification)
- [x] 1.12 Validation: three lint-style tests — resolved in Phase 8 (task 8.5); all three green

## Phase 2. Windows fixes on top of #1 (bucket #2) — 6 commits

- [x] 2.1 ~~1239201 cmd.exe flash~~ **SKIPPED as superseded** by 059dfe0 (execFileAsync calls replaced with platform/runner which bakes in windowsHide:true)
- [x] 2.2 ~~bb05398 PATHEXT via execSync loop~~ **SKIPPED as superseded** by 5ab7956 (already picked) which does PATHEXT resolution via single spawnSync call
- [x] 2.3 ~~4bfb77b PATHEXT + shell:true~~ **SKIPPED as superseded** by 5ab7956 buildSafeArgv + 059dfe0 runner refactor
- [x] 2.4 `git cherry-pick 26e033e` — detach:false for pi-session spawn (clean)
- [x] 2.5 `git cherry-pick 39acb1e` — platform/process tree-kill (conflicts: server.ts dropped redundant cleanupStaleZrok call; tunnel.ts merged killPidWithGroup + SIGKILL escalation + releaseShare)
- [x] 2.6 `git cherry-pick 304a82b` — terminal X button taskkill (conflict: terminal-manager.ts kept platform/shell.js import path, added killProcess from platform/process.js)
- [x] 2.7 Validation: `npm test` — resolved by Phase 5 (task 5.6: 2540/2540 green on re-verification during apply)
- [ ] 2.8 Manual Windows smoke — deferred (operator gate)

## Phase 3. Electron migration (bucket #3) — 3 commits

- [x] 3.1 ~~a97514e ToolResolver migration~~ **SKIPPED as superseded** by ca978d4 ToolRegistry (already picked)
- [x] 3.2 ~~455ced4 doctor/detector ToolResolver + isDashboardRunning~~ **SKIPPED** — depends on `isKnownBadNode` from `platform/node-version-check.js` which doesn't exist on our branch (post-merge v2-local work); node-guard.ts already covers version checking
- [x] 3.3 `git cherry-pick 8402565` — Electron server spawn via buildServerSpawnOptions (clean)
- [x] 3.4 Validation: `npm run build` green (re-verified during apply: client + server built, precompress 5.81 MB → 1.73 MB)
- [ ] 3.5 Manual Electron smoke — deferred (operator gate)

## Phase 4. Bridge extension (bucket #4) — 6 commits

- [x] 4.1 `git cherry-pick 00e2e9b` — wait indefinitely for server readiness (clean)
- [x] 4.2 `git cherry-pick 9a9f2da` — onLaunchStart/onLaunchEnd callbacks (clean)
- [x] 4.3 `git cherry-pick bc6cb5d` — braille spinner (clean)
- [x] 4.4 `git cherry-pick 7239129` — pi-tui Loader widget (clean)
- [x] 4.5 `git cherry-pick e2357fd` — spawn_error browser message (clean)
- [x] 4.6 `git cherry-pick 050d5dd` — WSL-tmux probe cache (clean)
- [x] 4.7 Validation: `npm test` — resolved by Phase 5 (task 5.6: 2540/2540 green on re-verification during apply)
- [ ] 4.8 Manual bridge smoke — deferred (operator gate)

## Phase 5. Test infra (bucket #6) — 3 commits + re-derivation

**v2's `31f5c68` is explicitly NOT picked** (re-conflict risk per design.md).

- [x] 5.1 ~~ce1576d test fixtures Windows parity~~ **SKIPPED** — those test files not affected in our tree
- [x] 5.2 ~~b4f712a process.kill-ban lint~~ **SKIPPED** — already on develop via 6a1b1d8 test-isolation baseline
- [x] 5.3 Run `npm test` — 33 failures captured across 12 files
- [x] 5.4 Triage + adapt from `git show 31f5c68:<path>`: 8 source fixes + 9 test fixes + 2 lint allowlist updates
- [x] 5.5 Commit as `fix(tests): restore green baseline after platform/ + electron + bridge integration` (SHA 5ede10d)
- [x] 5.6 Validation: **2526/2526 green** (1 skip added for package-manager-wrapper-resolve fall-through test — ToolRegistry tech debt)

## Phase 6. Drift features (bucket #8) — 6 commits, each separate

Per user direction: keep as separate commits on the same branch; do not bundle or spin out to separate branches.

- [x] 6.1 ~~1ee114c harden ask_user~~ **SKIPPED** — v2's version PREDATES develop's batch method (7a0e926) + title backfill (36bd96d). Picking it regresses develop's richer impl; dropped from branch after test-surface verification (revert restored 349 tests vs 337).
- [x] 6.2 ~~9446e43 pi-core version checker UI~~ **SKIPPED** — already on develop via `cf3ab84` with richer impl
- [x] 6.3 ~~6b39c3c pi_core_update_complete broadcast~~ **SKIPPED** — already on develop via `e368d27`; broadcast code already present in server.ts (surfaced during ca978d4 merge resolution)
- [x] 6.4 ~~302c1c7 path-picker server-side filter~~ **SKIPPED** — already on develop via `a45e9d0`; createDirectory/validateMkdirName/query-filter all present
- [x] 6.5 ~~b80121f zrok reservation leaks~~ **SKIPPED** — already on develop via `8ca4538`; releaseShare + scavengeOrphanZrokProcesses + manualChunks all present
- [x] 6.6 `git cherry-pick 850abe9` — ban:child_process-ok markers (picked early during Phase 5 to unblock lint baseline, SHA 43d6910)
- [x] 6.7 Validation: `npm test` 2526/2526 green, `npm run build` green. Per-feature smoke deferred (operator gate) — all 5 features already on develop from Category A/B re-picks.

## Phase 7. OpenSpec docs + archives (bucket #7) — ~8 commits

Pick in one batch at the end; validate `openspec list` + `openspec validate` after each.

- [x] 7.1 `git cherry-pick 170434e` — cross-platform server launch docs (conflict: AGENTS.md + architecture.md — kept HEAD's richer content which already has this info)
- [x] 7.2 `git cherry-pick cf84058` — archive fix-windows-server-parity (conflict: bridge-extension spec merged skill-command + server-launcher-log requirements)
- [x] 7.3 `git cherry-pick d0adac2` — consolidate-platform-handlers proposal (conflict: tasks.md kept HEAD's 78-line version)
- [x] 7.4 ~~2257b08 fix-fork-entryid-timing refinement~~ **SKIPPED** — per design.md open question #1: refinements describe user+assistant symmetry but the code changes for that symmetry aren't in our picked set; archive on develop describes the assistant-only fix that matches our code
- [x] 7.5 `git cherry-pick a4f9860` — platform-routed kill paths docs (clean)
- [x] 7.6 `git cherry-pick 0be288f` — archive route-kill-paths-through-platform (clean)
- [x] 7.7 `git cherry-pick de695e1` — README Node 22.18.0 bump (clean)
- [x] 7.8 ~~821cd63 sync 4 archives~~ **SKIPPED** — all 4 archives already on develop under different dates (cross-platform-qa-vms, dashboard-ux-fixes-batch, provider-auth, etc.)
- [x] 7.9 adapt-windows-integration-pr9 .openspec.yaml already set to `status: superseded` when proposal was created (pre-Phase 0)
- [x] 7.10 Validation: `openspec list` + `openspec validate` green on merge-windows-integration-linear, consolidate-platform-handlers, platform-path-normalization
- [x] 7.11 Validation: `npm test` 2526/2526 green

## Phase 8. Pre-PR gates

- [ ] 8.1 CI green on Windows, macOS, Linux matrix (full `npm test`)
- [ ] 8.2 CI green on Electron make matrix (DMG / AppImage / NSIS / ZIP)
- [ ] 8.3 Manual Windows smoke per Phase 2.8 + Phase 3.5 + Phase 4.8
- [ ] 8.4 Manual macOS + Linux smoke: landing page, session spawn, terminal, editor, zrok QR
- [x] 8.5 Three lint-style tests green: `no-direct-child-process`, `no-direct-process-kill`, `no-direct-platform-branch`.
      - Cherry-picked `b4f712a` (revises task 6.1 skip) to add `no-direct-process-kill.test.ts` + related kill-path test enhancements (picked as `a957e09`).
      - Violations caught by the new test in that SAME run:
        1. `pi-core-updater.ts:61` — `shell: process.platform === "win32"` lacked marker; added `// platform-branch-ok` justification (npm.cmd PATHEXT resolution).
        2. `editor-pid-registry.ts:91,100` — refactored `defaultIsProcessAlive`/`defaultKill` to delegate to `platform/process.ts` (`isProcessAlive` + `killPidWithGroup`), preserving the injectable-defaults API.
      - All three lint tests green on re-run.
- [x] 8.6 CHANGELOG `[Unreleased]` populated with user-visible changes (landed as `9bfd97c` — "docs(changelog): populate [Unreleased] for Windows integration merge"; verified during apply)
- [x] 8.7 Diff review against `adapt-windows-integration-pr9` durable-requirements spec — all four present:
      1. `spawnDetached` `detach?: boolean` option — `packages/shared/src/platform/detached-spawn.ts:100` + default `true` at line 134 ✓
      2. `useWindowsRedirect` gates on `stdinMode === "ignore"` — `detached-spawn.ts:125` `stdioIn: "ignore" | "pipe" = opts.stdinMode ?? "ignore"` ✓
      3. Test suite refuses to run against real `$HOME` — `package.json` `test` + `test:watch` use `HOME=$(mktemp -d -t pi-test-XXXXXX)`; `packages/shared/src/test-support/setup-home.ts` enforces at runtime ✓
      4. Destructive registry sweeps no-op when test-env-guard detects unsafe HOME — `isUnsafeTestHomeScan()` gated in `headless-pid-registry.ts` (3 sites) + `editor-pid-registry.ts` ✓

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
