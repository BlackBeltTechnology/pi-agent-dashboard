# Test Plan — electron-runtime-overlay-updates

Stage: design   Generated: 2026-09-27

Hard gate resolved (answered): the checker only notifies (staging and activation are explicit); old-PID exit deadline 60 s; late-session reload convergence is asserted as an eventual invariant with a 90 s test timeout.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Effective source (D2) | decision-table | L1 | automated | `localPath` set/unset × binding `{epoch,seq}` equal / seq-differs / epoch-differs / binding absent × `request.json` valid / missing / corrupt / legacy-no-epoch | `deriveEffectiveSource(request, state)` | Returns `local` in exactly 1 row (localPath set + binding deep-equal + valid uuid + seq ≥ 1); every other row returns `request.source` (or `bundled` when the request is invalid) |
| E2 | Effective source — seq boundary | BVA | L1 | automated | binding `{epoch:E, seq:1}`; request `sourceSeq` ∈ {0, 1, 2}, `sourceEpoch` ∈ {E, E'} | derive | `local` only for `{E,1}`; `seq:0` is invalid → not local; `{E,2}` → not local |
| E3 | Local pick refused on unreadable request | state-transition (illegal edge) | L1 | automated | `request.json` missing or containing `{not json` | app-menu pick of a valid checkout | Pick returns error `request_unreadable`; `state.json` has no `localPath` / `localBinding` written |
| E4 | Launch precedence (D4) | decision-table | L1 | automated | {server answering health yes/no} × {unpackaged+monorepo cwd yes/no} × effective source {bundled, npm, github, local} × candidate gate ok/fail | `selectLaunchSource()` and `selectLaunchSource({skipAttach:true})` | Order `attach → devMonorepo → localLink → overlay → bundled`; `skipAttach` never returns `attach`; a gate failure falls through and sets `lastFailure`; devMonorepo wins whatever the source |
| E5 | Compatibility gate (D6) | BVA | L1 | automated | shell version 0.9.0; manifest `minShellVersion` ∈ {0.8.9, 0.9.0, 0.9.1}; bundled Node 22.12.0 vs `nodeEngines` ∈ {`>=22.11`, `>=22.12`, `>=22.13`, `^20`} | `evaluateRuntimeCandidate()` | ok for 0.8.9 / 0.9.0 and `>=22.11` / `>=22.12`; refusal reason `requires_app >=0.9.1` / `node_engines ^20` / `>=22.13` for the others |
| E6 | Preflight files | EP | L1 | automated | overlay tree each missing one of: server `cli.ts`, web `dist/index.html`, extension entry, `resources/plugins/`; local checkout each missing `packages/client/dist/index.html` or `node_modules` | preflight | Refusal naming the exact missing path; for a missing local client build the message contains `npm run build` |
| E7 | Lockstep check (Runtime release unit) | EP | L1 | automated | staged tree, all `@blackbelt-technology/*` at 0.9.0 except one plugin at 0.8.0 | post-install lockstep check | Staging fails with a reason naming `<plugin>@0.8.0`; `versions/0.9.0.partial` removed; `request.pending` unchanged |
| E8 | Deterministic lock (same release, same tree) | invariant | L1 | automated | fixture `runtime-lock.json` for X | the npm stager builds the synthetic `package.json` + lock twice | Both synthetic roots are byte-identical, and the command is `npm ci --omit=dev` (never `npm install`) |
| E9 | Channel resolution (Selectable source + channel) | decision-table | L1 | automated | mocked dist-tags `{latest:0.9.0, beta:0.10.0-beta.2}` and GitHub releases (0.9.0 stable, 0.10.0-beta.2 prerelease) × channel {stable, beta, pin 0.8.5} | `resolveTarget()` for npm and github | stable→0.9.0, beta→0.10.0-beta.2, pin→0.8.5 on both sources |
| E10 | Checker notifies only | state-transition | L1 | automated | active 0.9.0; channel has 0.9.1 | scheduled check | Status `available: 0.9.1`; no `versions/0.9.1*` dir created; `request.pending` unset |
| E11 | Handled pending / attempts (D2) | state-transition | L1 | automated | `request.pending=X`, `state.current=X` (committed) | cold launch | X runs as current; `attempts[X]` unchanged; no activation flow entered |
| E12 | Retry-once after crash before commit | state-transition | L1 | automated | `request.pending=X`, `attempts[X]=0` then 1, X never commits (health times out) | two consecutive launches | 1st launch attempts X (attempts=1); 2nd launch attempts X, fails → `bad[X]` set, falls back; a 3rd launch does not attempt X |
| E13 | Clearing bad on explicit action | state-transition | L1 | automated | `bad["local:/r/co"]` set | (a) cold launch, (b) app-menu re-select of /r/co | (a) not attempted; (b) `bad` entry and `attempts` cleared, activation attempted |
| E14 | Local identity key | EP | L1 | automated | same realpath, commits A then B, dirty toggled; symlinked path to the same folder | derive id | id is `local:<realpath>` in all cases; the snapshot shows the SHA/dirty change |
| E15 | Bridge extension single entry (D8) | EP | L1 | automated | `settings.json#packages[]` containing the bundled extension, or a local extension path, or an unrelated package | register the extension for overlay X / local / bundled | Exactly one dashboard-extension entry, pointing at the target runtime's path; unrelated entries preserved |
| E16 | Mutation routes Electron-only (D10) | decision-table | L1 | automated | `DASHBOARD_STARTER` ∈ {electron, standalone, bridge} | POST `/api/runtime/{source,update,activate,rollback}` | 403 for standalone/bridge with `request.json` untouched; accepted for electron |
| E17 | No HTTP path enables local (D7) | EP | L1 | automated | POST `/api/runtime/source` bodies `{source:"local"}`, `{localPath:"/x"}`, `{source:"npm", localPath:"/x"}` from 127.0.0.1 with Electron starter | request | 400/403; `state.json` never written by the server; `localPath` ignored in the mixed body |
| E18 | HTTP may turn local off | state-transition | L1 | automated | local active (binding `{E,3}`) | POST `/api/runtime/source {source:"bundled"}` | `request.sourceSeq=4`; derived source `bundled` |
| E19 | Preserve unknown keys | invariant | L1 | automated | `request.json` / `state.json` containing `futureKey:{a:1}` | server / Electron write | `futureKey` preserved byte-equal after the write |
| E20 | `/api/health.runtime` shape | decision-table | L1 | automated | starter × origin {bundled, overlay, local, devMonorepo, npmGlobal} × lastFailure present/absent | GET `/api/health` | `runtime.updatable` true only for electron with origin ≠ devMonorepo; all pre-existing health fields unchanged (snapshot) |
| E21 | pi-core gates unchanged | regression | L1 | automated | Electron starter, `runtime.updatable=true` | render `UnifiedPackagesSection` + `App` header | Core group and `PiUpdateBadge` still hidden (same as today) |
| E22 | Single plugin list source of truth | invariant | L1 | automated | `packages/server/package.json#piDashboard.bundledPlugins` | `bundle-server.mjs` plugin list + the runtime materialize helper | Both derive exactly that list; removing an id from the field removes it from both |
| E23 | Deadline mapping | EP | L1 | automated | source kinds devMonorepo, localLink, overlay, bundled | `getServerReadyDeadlineMs` | 60 000, 60 000, 15 000, 15 000 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Activation watcher (D3) | latency | L1 | automated | fake timers; `activateNonce` written | time from write to `switchRuntime` invocation ≤ 2 s poll interval + 100 ms | single event |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Updates section — local read-only | EP | L1 | automated | `runtime.source=local`, path `/r/co`, SHA abc123 dirty | render the Settings Updates section | Path + SHA + dirty shown; no editable path input; text "Set from the app menu" present |
| F2 | Updates section — notify → stage → activate | state-transition | L1 | automated | status `available 0.9.1` | click Update, progress events, click Activate | Buttons move Update → progress → Activate; Activate is disabled until `pending=0.9.1` |
| F3 | Requires app update | EP | L1 | automated | newest release refused with `requires_app >=0.10.0` | render | Shows "Requires app update ≥0.10.0" and a link that calls the whole-app update check |
| F4 | Last failure surfaced | EP | L1 | automated | `runtime.lastFailure {version:0.9.1, reason:"health timeout"}` | render | The failure line with version and reason is visible; Roll back / Use bundled enabled |
| F5 | Late-reconnect reload convergence (D8) | async convergence | L3 | automated | 2 sessions; one bridge's reconnect delayed past the first reload | activate a runtime whose extension identity differs | Eventually (≤ 90 s test timeout) both sessions report the active extension identity; each session got exactly 1 `/reload` |
| F6 | Reload guard (no loop) | state-transition | L1 | automated | bridge re-registers with a non-matching identity after its reload | server register handler | No 2nd `/reload` for the same runtime id; diagnostic `extension_mismatch` recorded |
| F7 | Visual polish of the Updates section | visual/subjective | — | manual-only | Settings → Updates on all 4 themes | human review | [judgment: consistent with the theme tokens and readable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Integrity (GitHub) | fault-injection (abort) | L1 | automated | asset bytes ≠ `.sha512` | stage github X | Fails `checksum_mismatch`; no `versions/X` or `.partial`; current unchanged |
| X2 | Interrupted staging | fault-injection (abort) | L1 | automated | fetch/`npm ci` killed mid-way | stage, then stage again | `X.partial` never selectable; second run starts clean and succeeds |
| X3 | Registry/GitHub unreachable | fault-injection (delay + abort) | L1 | automated | network error / 30 s stall on check | check | Status `check_failed` with reason; the active runtime is untouched; the cached result is kept for 24 h |
| X4 | Unhealthy candidate rollback | fault-injection (abort) | L1 | automated | candidate never answers health within 15 s | `switchRuntime(X)` | `bad[X]`, `lastFailure` set; extension re-pointed to previous before the previous is spawned; previous committed |
| X5 | Old server slow to exit — boundary | BVA (fake clock) | L1 | automated | old PID exits at 59 s / 61 s | `switchRuntime(X)` | 59 s: the candidate spawns; 61 s: the switch aborts `old_server_alive`, old runtime current, X not in `bad` |
| X6 | No false commit | fault-injection | L1 | automated | old server still answers health with pid P_old, version W | the candidate health gate | The gate rejects (pid ≠ spawned or version ≠ X); never commits |
| X7 | Port-in-use environmental | fault-injection | L1 | automated | candidate spawn exits EADDRINUSE | `switchRuntime(X)` | Aborted; X not marked bad; old runtime remains current |
| X8 | Watchdog ownership | state-transition | L1 | automated | (a) planned stop of the old PID; (b) candidate exits before commit; (c) committed runtime exits later; (d) abort then the surviving runtime crashes | `makeServerWatchdog` onExit | (a) graceful, no recovery page; (b) handled by rollback only, watchdog silent; (c) and (d) the watchdog `onCrash` fires |
| X9 | Stale state cannot enable local after rollback | fault-injection | L1 | automated | local bound `{E,2}`; `request.json` rewritten by an "older server" without `sourceEpoch` | derive + launch | Source not local; the resolver never returns `localLink` |
| X10 | Crash detection preserved end-to-end | fault-injection | electron | automated | packaged app on overlay X; kill the server PID | observe the app | Loading/recovery page appears (existing crash handling), same as the bundled runtime |
| X11 | Full npm update cycle | end-to-end | electron | automated | packaged app 0.9.0 bundled; local verdaccio serving 0.9.1 with `runtime-lock.json` | Check → Update → Activate | `/api/health.runtime {origin:overlay, version:0.9.1}`; `settings.json` extension path under `versions/0.9.1`; first-party plugins listed in `/api/health.plugins[]` same as bundled |
| X12 | Broken overlay falls back to bundle | end-to-end | electron | automated | overlay 0.9.1 whose server exits at boot; no previous | Activate | `runtime.origin=bundled`; `lastFailure.version=0.9.1`; bundled extension re-registered |
| X13 | Local link loop | end-to-end | electron | automated | packaged app; app menu picks the repo checkout (built) | pick, edit a server log string, POST `/api/restart` | health `origin:local`, `gitSha` = HEAD; after restart the new log string appears in server.log |
| X14 | Remote client cannot enable local | end-to-end | L3 | automated | dashboard reached via the harness port as a remote client | UI + direct POST attempts | No path input rendered; POST rejected; `/api/health.runtime.source` unchanged |
| X15 | Cross-OS activation (Windows file locks, AppImage paths) | multi-OS runtime | — | manual-only | Windows 11 + Linux AppImage installs | Update → Activate → Roll back | [judgment: needs real OS installs; no CI harness for native Windows/AppImage overlay] |
| X17 | Unpublished bundled plugin blocks the release | workflow assertion | ci | automated | a release X where one `bundledPlugins` package is absent from the registry at X | release gate step (task 2.7) | The release fails naming the missing package; no `runtime-lock.json`/runtime asset is published for X |
| X16 | GitHub asset + beta dist-tag published | workflow assertion | ci | automated | release workflow on a prerelease tag | publish job | The asset + `.sha512` are attached; `npm dist-tag ls` shows `beta` = tag version; the manifest version equals the tag |

---

## Coverage summary

- Requirements covered: 12/12 (overlay capability 9, launch-source 1, starter-identity 2), plus design invariants D2/D3/D8/D10
- Scenarios by class: edge 23 · perf 1 · frontend 7 · error 16
- Scenarios by level: L1 38 · L3 2 · electron 4 · ci 1 · — 2
- Scenarios by disposition: automated 45 · manual-only 2

## New infra needed

- **Local npm registry fixture for X11** (verdaccio or similar) inside the electron E2E job, to serve a fake 0.9.1 with `runtime-lock.json`. There is no registry fixture today.
- **Two-bridge delayed-reconnect control in the docker harness for F5**. Check `tests/e2e/headless-reload-dispatch.spec.ts` for reusable reconnect hooks first.
