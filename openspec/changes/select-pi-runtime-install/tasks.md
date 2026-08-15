## 1. Promote pi-resolution helpers into shared

- [ ] 1.1 Create `packages/shared/src/pi-installs/` and move `enumeratePiInstalls`, `piVersionDivergence`, `readPiFloor` + the `PiInstall` interface verbatim from `packages/extension/.pi/skills/doctor/_lib/checks.ts`
- [ ] 1.2 Move `parseVersion`, `compareVersions`, `isBelow` from `packages/server/src/pi/pi-version-skew.ts` into the same shared module; re-export from `pi-version-skew.ts` so its public surface is unchanged
- [ ] 1.3 Move the existing helper tests to `packages/shared/src/pi-installs/__tests__/` and confirm they pass unchanged (behaviour-preserving move — no logic edits)
- [ ] 1.4 Re-export the promoted helpers from the doctor skill's `_lib/checks.ts`; assert via `rg` that no duplicate implementation remains
- [ ] 1.5 Define the single floor reader's missing-file behaviour explicitly and route both the picker and `/api/health` through it, removing the `0.6.7`-vs-null split
- [ ] 1.6 Run the doctor skill's tests (`packages/extension/src/__tests__/doctor/`) to prove the doctor is behaviourally unchanged

## 2. Candidate enumeration

- [ ] 2.1 Implement `enumeratePiCandidates()` in `packages/shared/src/pi-installs/`, deriving locations from the bare-import anchor, `<MANAGED_DIR>/node_modules/<pkg>`, npm-global prefix, and repo-root `node_modules`, probing both package aliases upstream-first
- [ ] 2.2 Have each candidate carry `pkgDir`, `spawnEntry`, `moduleEntry`, `version`, `meetsFloor` — entries are files, never directories
- [ ] 2.3 Add the enumeration cache and wire its invalidation into the existing `rescan()`
- [ ] 2.4 Author L1 test: fixture tree with all four locations populated → `enumeratePiCandidates()` runs → one entry per location each carrying pkgDir + spawnEntry + moduleEntry + version (test-plan #E1) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 2.5 Author L1 test: fixture where managed `node_modules` is absent → enumeration runs → managed entry present with null path and null version, not omitted (test-plan #E2) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 2.6 Author L1 test: managed pi under `<MANAGED_DIR>/node_modules/@earendil-works/pi-coding-agent` with nothing at `<MANAGED_DIR>/package.json` → enumeration runs → managed candidate reports the real version, not null (test-plan #E3) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 2.7 Author L1 test: any populated candidate → inspect entries → `statSync(entry).isDirectory()` is false for every candidate's spawnEntry and moduleEntry (test-plan #E4) — see `packages/shared/src/tool-registry/__tests__/node-script-argv-matrix.test.ts`
- [ ] 2.8 Author L1 non-vacuous drift test: each enumerated candidate → set spawnEntry as `pi` override and moduleEntry as `pi-coding-agent` override → `resolveExecutor` yields argv whose script is a real `.js`/executable AND `resolveModule` imports successfully; a directory value must FAIL this assertion (test-plan #E5) — see `packages/shared/src/tool-registry/__tests__/node-script-argv-matrix.test.ts`
- [ ] 2.9 Author L1 test: candidates at 0.77.9 / 0.78.0 / 0.78.1 against floor 0.78.0 → floor evaluation → only 0.77.9 flagged below floor (test-plan #E6) — see `packages/server/src/__tests__/health-compatibility.test.ts`
- [ ] 2.10 Author L1 test: executable on PATH with no adjacent package.json → enumeration → unknown version, not flagged below floor, still selectable (test-plan #E7) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 2.11 Author L1 test: chain resolves pi from a path matching no enumerated candidate → enumeration → extra read-only "current" candidate returned carrying its own version (test-plan #E8) — see `packages/shared/src/tool-registry/__tests__/bare-import-exports-map.test.ts`
- [ ] 2.12 Author L1 test: injectable spawn counter wrapping subprocess creation → enumerate twice in one cache generation → zero `pi --version` spawns ever and zero subprocess spawns on the second call (test-plan #E9) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 2.13 Author L1 test: enumeration cached then a candidate's on-disk version changes → `rescan()` then enumerate → second enumeration reflects the new version (test-plan #E10) — see `packages/server/src/__tests__/tool-routes.test.ts`

## 3. Override validation

- [ ] 3.1 Implement `validatePiOverridePath()` in `packages/shared/src/pi-installs/`: accepts a resolvable pi package directory **or** an executable file, resolves symlinks, rejects directories for the two pi consumers, returns a typed result naming the failed check
- [ ] 3.2 Wire the validator into `PUT /api/tools/:name` for `pi` and `pi-coding-agent` only; return 400 with the failed-check reason
- [ ] 3.3 Author L1 test: `/nonexistent/pi` → `PUT /api/tools/pi` → 400 naming the failed check, previously active override unchanged (test-plan #E11) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 3.4 Author L1 test: a real package directory path → `PUT /api/tools/pi` → 400 naming the failed check, no override persisted (test-plan #E12) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 3.5 Author L1 test: executable file with no adjacent package.json → `PUT /api/tools/pi` → accepted, resolution reports unknown version (test-plan #E13) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 3.6 Confirm existing `tool-routes.test.ts` cases for other tools still pass unchanged
- [ ] 3.7 Invoke the `security-hardening` discipline skill on the validator, the route diff and the tmux argv conversion together — the accepted path becomes an executed binary and is interpolated into a tmux pane command

## 4. tmux argv conversion and injection fix

- [ ] 4.1 Convert `buildTmuxCommand` to return an argv array, drop the redundant `cd <cwd> &&` prefix (tmux `-c` already sets the pane cwd), and take the pi invocation as a parameter
- [ ] 4.2 Retain `shellEscape` for values interpolated into the pane-command element — tmux runs that element through its own shell; only the dashboard-side shell is removed
- [ ] 4.3 Update `spawnTmux` to invoke the argv without a shell, passing the registry-resolved pi argv
- [ ] 4.4 Update `spawnWslTmux` to pass bare `pi` so resolution happens inside the WSL namespace; no host-resolved path is embedded
- [ ] 4.5 Update the existing `buildTmuxCommand` assertions in `packages/server/src/__tests__/process-manager.test.ts`, which currently assert on a returned string
- [ ] 4.6 Author L1 test: flag value containing `$(…)`, backticks and quotes → build the tmux invocation → value reaches pi as one literal argument (test-plan #X4) — see `packages/server/src/__tests__/process-manager.test.ts`
- [ ] 4.7 Author L1 test: any tmux spawn → build the invocation → builder returns an argv array, no `cd <cwd> &&` prefix, cwd travels as a literal `-c` element (test-plan #X5) — see `packages/server/src/__tests__/process-manager.test.ts`
- [ ] 4.8 Author L1 test: resolution yielding `[node, cli.js]` → build the tmux invocation → both elements carried, spawn does not depend on the script shebang (test-plan #X7) — see `packages/shared/src/tool-registry/__tests__/node-script-argv-matrix.test.ts`
- [ ] 4.9 Author L1 test: wsl-tmux mechanism selected → build the invocation → bare `pi` embedded, no host-resolved path leaks in (test-plan #X8) — see `packages/server/src/__tests__/process-manager.test.ts`
- [ ] 4.10 Author L1 regression test: headless and wt mechanisms → build each invocation → both still resolve through the tool registry exactly as before (test-plan #X9) — see `packages/server/src/__tests__/process-manager-keeper-spawn.test.ts`
- [ ] 4.11 Create the L2 tmux spawn harness (new infra — no existing qa test spawns tmux); model its structure on `qa/tests/04-terminal.sh`
- [ ] 4.12 Author L2 test: directory named with an embedded `$(…)` writing a sentinel → spawn a tmux session into it → session created for the literal name AND sentinel file does not exist (test-plan #X1) — see `qa/tests/04-terminal.sh`
- [ ] 4.13 Author L2 test: directory named with an embedded backtick substitution writing a sentinel → spawn a tmux session into it → sentinel absent, pane cwd is the literal directory (test-plan #X2) — see `qa/tests/04-terminal.sh`
- [ ] 4.14 Author L2 test: directory name containing `"`, `'`, `;` and spaces → spawn a tmux session into it → passed as a single argument, no extra command runs, session created (test-plan #X3) — see `qa/tests/04-terminal.sh`
- [ ] 4.15 Author L2 test: spawn override pinned to a known install → spawn a tmux session → pane command references the resolved install, not a bare `pi` off PATH (test-plan #X6) — see `qa/tests/04-terminal.sh`

## 5. Atomic runtime selection endpoint

- [ ] 5.1 Add `setMany(changes)` to `OverridesStore`: apply every key to a copy, persist once, swap the cache only on success
- [ ] 5.2 Implement `POST /api/pi/runtime` accepting both consumer selections, validating each, persisting via `setMany`, then rescanning `pi` and `pi-coding-agent` in the same request
- [ ] 5.3 Guard both new routes with the same `networkGuard` used by the existing tool routes
- [ ] 5.4 Author L1 test: spawn=A, import=A → `POST /api/pi/runtime` → both overrides present after one persist (test-plan #E14) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 5.5 Author L1 test: injected `persist()` throwing → `POST /api/pi/runtime` with both consumers changing → neither override changed on disk AND neither changed in the in-memory cache (test-plan #E15) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 5.6 Author L1 test: both overrides set, then spawn=Automatic + import=A → `POST /api/pi/runtime` → `pi` override removed and `pi-coding-agent` set in one persist (test-plan #E16) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 5.7 Author L1 test: override written via the runtime endpoint → resolve each consumer immediately → returns the newly selected install, not a stale cached resolution (test-plan #E17) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 5.8 Author L1 test: request the guard rejects → call discovery and selection endpoints → both rejected by the same guard as existing tool routes (test-plan #E22) — see `packages/server/src/__tests__/tool-routes.test.ts`

## 6. Discovery endpoint and shared types

- [ ] 6.1 Implement `GET /api/pi/installs` returning key, label, pkgDir, spawnEntry, moduleEntry, version, meetsFloor and per-consumer `usedBy`
- [ ] 6.2 Implement the resolved-entry → candidate mapping (realpath both sides, compare package directory), reusing the walk `readCurrentPiVersion` performs
- [ ] 6.3 Add the response type to `packages/shared/src/rest-api.ts` and a client fetch helper alongside `packages/client/src/lib/api/tools-api.ts`

## 7. Divergence and observability

- [ ] 7.1 Implement consumer divergence as realpath'd package-directory inequality — the same axis the sync checkbox uses — with the message naming both versions
- [ ] 7.2 Report consumer divergence and install-set divergence under distinct labels in `/api/health` and the doctor `pi-resolution` module; update its `.knowledge.hash` sidecar
- [ ] 7.3 Author L1 test: spawn=`<dir>/dist/cli.js`, import=`<dir>/dist/index.js` → derive sync → reported in sync, package dirs equal after realpath (test-plan #E18) — see `packages/shared/src/tool-registry/__tests__/node-script-argv-matrix.test.ts`
- [ ] 7.4 Author L1 test: two installs both at 0.84.1, one per consumer → derive sync + divergence → NOT in sync AND diverged, both surfaces agreeing (test-plan #E19) — see `packages/server/src/__tests__/health-compatibility.test.ts`
- [ ] 7.5 Author L1 test: spawn via symlink, import via real path, same install → derive sync → reported in sync (test-plan #E20) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 7.6 Author L1 test: both consumers at 0.84.1 plus an unused third install at 0.71.0 → compute both predicates → consumer divergence false, install-set divergence true, reported under distinct labels (test-plan #E21) — see `packages/server/src/__tests__/health-compatibility.test.ts`
- [ ] 7.7 Invoke the `observability-instrumentation` discipline skill on the new endpoints and health fields

## 8. Settings UI — Pi runtime section

- [ ] 8.1 Build the section shell with two consumer lanes (Sessions spawn / Server imports) showing version, source pill and path
- [ ] 8.2 Build the candidate matrix — one row per candidate, two selection columns, per-column version; blue encodes spawn, purple encodes import across lane border, column header, radio accent and selected-row ring
- [ ] 8.3 Derive the "Keep both in sync" state from realpath'd package-directory equality; persist nothing
- [ ] 8.4 Implement the `Automatic` row showing the current resolution; selecting it clears that consumer's override in the atomic write
- [ ] 8.5 Implement the responsive collapse below 680px per `mockup.html`
- [ ] 8.6 Mount the section immediately above `<ToolsSection />` in the General tab of `SettingsPanel.tsx`
- [ ] 8.7 Add the Advanced disclosure with separate spawn and import custom-path inputs routed through the validated write, labelled with the file it writes
- [ ] 8.8 State in the UI that WSL sessions resolve pi inside WSL and are not covered by the selection
- [ ] 8.9 Add i18n entries for every new string (en + hu, matching `i18n-hu.ts`)
- [ ] 8.10 Author L3 test: no overrides, both chains resolve to one install → open Settings → General → sync checked, both lanes show the same version (test-plan #F1) — see `tests/e2e/settings-field-descriptions.spec.ts`
- [ ] 8.11 Author L3 test: no overrides, chains resolve to different installs → open the section → sync unchecked AND divergence surfaced (test-plan #F2) — see `tests/e2e/settings-field-descriptions.spec.ts`
- [ ] 8.12 Author L3 test: `pi` override set, `pi-coding-agent` unset, versions differ → open the section → sync unchecked, banner naming both versions, existing pin not overwritten (test-plan #F3) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.13 Author L3 test: sync checked → select a candidate row → both lanes converge to that candidate's version (test-plan #F4) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.14 Author L3 test: sync checked → attempt any selection in either column → no reachable UI action produces differing lanes (test-plan #F5) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.15 Author L3 test: sync unchecked → select candidate A in spawn only → spawn lane changes, import lane unchanged, divergence banner appears (test-plan #F6) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.16 Author L3 test: candidate with unreadable version present → render the list → row shows "version unknown — not floor-checked" warning and remains selectable (test-plan #F7) — see `tests/e2e/apple-tools-activation.spec.ts`
- [ ] 8.17 Author L3 test: candidate below the floor → click its selection cell in either column → row disabled, reason names the required minimum, neither consumer changes (test-plan #F8) — see `tests/e2e/apple-tools-activation.spec.ts`
- [ ] 8.18 Author L3 test: 2 sessions with known previous version running → apply a spawn change → strip reports exactly 2 still on the previous version (test-plan #F9) — see `tests/e2e/bridge-contention-health.spec.ts`
- [ ] 8.19 Author L3 test: 1 session with undefined `piVersion` running → apply a spawn change → not counted as previous-version, reported separately as unknown runtime (test-plan #F10) — see `tests/e2e/bridge-contention-health.spec.ts`
- [ ] 8.20 Author L3 test: pending selection that diverges → click Apply → confirmation states the resulting mismatch before the write (test-plan #F11) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.21 Author L3 test: pending selection where both lanes match → click Apply → confirmation does not claim a mismatch (test-plan #F12) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.22 Author L3 test: import changed vs spawn-only changed → apply each → restart offered only when import changed (test-plan #F13) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.23 Author L3 test: Electron host, select a candidate outside the bundle → warning shown about leaving the bundle, selection permitted (test-plan #F14) — see `tests/e2e/apple-tools-activation.spec.ts`
- [ ] 8.24 Author L3 test: no override set → render the Automatic row → shows the version and location the chain resolves to, never blank (test-plan #F15) — see `tests/e2e/settings-field-descriptions.spec.ts`
- [ ] 8.25 Author L3 test: override file edited directly to create a mismatch → reopen after rescan → divergence surfaced, UI does not claim agreement (test-plan #F16) — see `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 8.26 Author L3 test: viewport 375px → render the section → metadata full-width above two labelled cells, each hit area ≥44px, no horizontal overflow (test-plan #F17) — see `tests/e2e/settings-field-descriptions.spec.ts`

## 9. Error handling and degradation

- [ ] 9.1 Author L1 test: candidate dir present but `package.json` unreadable → enumeration → null version for that entry, other candidates still returned, no throw (test-plan #X10) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 9.2 Author L1 test: `npm root -g` exits non-zero → enumeration → npm-global candidate absent, remaining candidates still returned (test-plan #X11) — see `packages/shared/src/tool-registry/__tests__/managed-runtime-strategy.test.ts`
- [ ] 9.3 Author L1 test: corrupt `tool-overrides.json` → open the runtime section → treated as no overrides, Automatic rendered, no throw (test-plan #X12) — see `packages/server/src/__tests__/tool-routes.test.ts`
- [ ] 9.4 Author L3 test: `GET /api/pi/installs` returns 500 → open Settings → General → section shows an error state, rest of Settings still renders (test-plan #X13) — see `tests/e2e/bind-reachability-advisory.spec.ts`

## 10. Manual verification

- [ ] 10.1 Visually review the runtime section in each theme for spacing, colour encoding and density reading as native to Settings (test-plan: manual-only)

## 11. Review and land

- [ ] 11.1 Resolve the design's Open Questions, recording each answer in `design.md`
- [ ] 11.2 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures
- [ ] 11.3 Run `npm run quality:changed` and clear new Biome findings
- [ ] 11.4 Invoke `review-code` on the complete diff
- [ ] 11.5 Update directory `AGENTS.md` rows for every new file (shared `pi-installs/`, server routes, client section, qa harness) per the Documentation Update Protocol
- [ ] 11.6 Add release-note entries for the two disclosed behavioural changes: tmux sessions now use the registry-resolved binary, and pre-existing single-consumer overrides surface as divergence
- [ ] 11.7 Manual QA: verify default-inert behaviour (no override → both consumers Automatic, chain unchanged), then pin, diverge, and revert
