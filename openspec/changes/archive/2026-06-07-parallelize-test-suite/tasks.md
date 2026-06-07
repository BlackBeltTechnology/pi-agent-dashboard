# Tasks

## 0. Baseline

- [x] 0.1 Capture current full-run wall time → baseline `/tmp/pi-test-baseline.log`: Duration 506.52s (wall 8m27s), 7317 passed. 18 pre-existing failures out of scope: 16 `pi-image-fit` (`Jimp is not a constructor` dep issue), `browse-endpoint`. Default reporter → no per-file timing; aggregate recorded.
- [x] 0.2 Confirm CPU topology on the run host (`node -e 'console.log(require("os").cpus().length)'`) to sanity-check `"50%"`. Host = 16 logical cores → `"50%"` ≈ 8 workers.

## 1. Phase 1 — pure/plugin projects (free win)

- [x] 1.1 Changed `maxWorkers: 1` → `"50%"` in all 11 Phase 1 vitest configs (shared, extension, client-utils, dashboard-plugin-runtime, flows-plugin, flows-anthropic-bridge-plugin, jj-plugin, honcho-plugin, roles-plugin, subagents-plugin, scripts).
- [x] 1.2 Ran 11 projects 3× → green + no flakes (2605 passed each, EXIT=0). Duration ~18.8s/run.

## 2. Phase 2 — client

- [x] 2.1 CONFIRMED via probe: jsdom `localStorage === window.localStorage` (`isJsdomGlobal: true`, ctor `Storage`); writing it leaves Node `--localstorage-file` untouched (`fileContainsMarker: false`). jsdom localStorage = per-jsdom-instance in-memory, isolated per fork/file under `pool:forks`+`isolate:true`. Global `--localstorage-file` NOT shared by client tests.
- [x] 2.2 SKIPPED (not needed). 2.1 shows fork isolation; `maxWorkers` only affects cross-file parallelism, which jsdom isolates. Intra-file ordering unchanged by worker count. Per simplicity-first, no guards added; 3× green run confirms.
- [x] 2.3 `packages/client/vitest.config.ts`: `maxWorkers: 1` → `"50%"`. Ran 3× → green + no flakes (2318 passed each, EXIT=0, ~44s/run).

## 3. Phase 3a — server per-file HOME hook

- [x] 3.1 Added `packages/shared/src/test-support/setup-home-perfile.ts`: per-file `process.env.HOME = mkdtempSync(os.tmpdir()/pi-test-)`, pre-creates `.pi/agent/sessions` + `.pi/dashboard`. NO per-file localStorage path — verified no node-env test writes Node `--localstorage-file` (only client jsdom uses localStorage, isolated in-memory per fork), so Decision 3a localStorage part is unnecessary.
- [x] 3.2 Wired via `setupFiles` in `packages/server/vitest.config.ts` (globalSetup tripwire kept). Used config-relative `path.resolve(__dirname, "../shared/src/...")` so worktree-local source wins over hoisted node_modules symlink (mirrors client config alias rationale).
- [x] 3.3 Server suite at `maxWorkers:1` → green: 230 passed | 2 skipped, 0 failures. Per-file HOME hook does not regress.

## 4. Phase 3b — server port migration

- [x] 4.1 Migrated 6 collision files to `port:0` + `httpPort()`/`piPort()` getters: last-activity-broadcast, auto-attach-slug-defense, session-api (19200); worktree-base-spawn-flow, event-wiring-resume-clear, event-wiring-process-classify (19700). 6 files → 35 tests pass.
- [x] 4.2 Migrated real fixed-port files: event-wiring-queue-state, unread-trigger-wiring, event-wiring-providers-list, auto-attach (×2 describe blocks), spa-fallback, headless-shutdown-fallback, shutdown-endpoint, auto-shutdown, event-wiring-source-stamp (dropped basePort param), oauth-callback-server (per-fork `freePort()` probe). NO-OP (audit false positives — no real fixed bind): recovery-server (`port:8000` = `buildRecoveryHtml` data; live server uses probe), editor-keeper/keeper-manager (hardcoded ports inert; liveness fails on dead pid/socket before TCP probe).
- [x] 4.3 Added parallelism guard to `test-server-canary.test.ts`: brace-aware scan of every `createServer({...})` block asserts `port`/`piPort` literals are `0`. Avoids false-positives on non-boot `port:` data. Passes (0 offenders).
- [x] 4.4 Server suite at `maxWorkers:1` post-migration → green: 230 passed | 2 skipped, 0 failures.

## 5. Phase 3c — server parallel

- [x] 5.1 `packages/server/vitest.config.ts`: `maxWorkers: 1` → `"50%"`.
- [x] 5.2 Server suite 3× at `"50%"` → green + no flakes, no EADDRINUSE (2341 passed each). Duration 159s→28s (~5.7× faster). Port + HOME isolation confirmed under parallelism.
- [x] 5.3 No genuinely serial-only file found (all green 3×); no isolation needed.

## 6. Verify + document

- [x] 6.1 Full `npm test` 3× → green + no flakes (0 in-scope failures all 3 runs). 17 remaining = pre-existing `pi-image-fit` Jimp dep issue (out of scope, on baseline). Wall time 8m27s → ~1m31s (~5.6×). Fixed 2 parallelism flakes found in first full run: extension role-manager/model-resolve (added per-file HOME hook to shared/extension/subagents-plugin); recovery-server probe-rebind TOCTOU (startRecoveryServer now binds port:0 + returns bound port).
- [x] 6.2 No change needed. localStorage handling did NOT move out of `NODE_OPTIONS` — no node-env test writes Node's `--localstorage-file` (only client jsdom, isolated in-memory per fork). Root `npm test` HOME + localStorage flags stay (harmless; globalSetup tripwire still uses per-run HOME, per-file hook overrides per file).
- [x] 6.3 Docs updated (delegated to subagent, caveman style): added `setup-home-perfile.ts` row to `docs/file-index-shared.md` (path-alpha); added `## Test execution & isolation` section to `docs/architecture.md` (forks/maxWorkers, per-file HOME, port:0 + canary guard, startRecoveryServer port:0, jsdom localStorage, wall-time 8m27s→1m31s).
