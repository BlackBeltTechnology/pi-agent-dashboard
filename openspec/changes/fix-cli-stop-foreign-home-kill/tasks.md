## 1. Ownership primitives

- [ ] 1.1 Add `peekInstanceId(env, piPort)` to `packages/server/src/lifecycle/instance-id.ts`: non-creating, not memoized, wrapping the private `readInstanceId`. Verify the tests in 6.15 pass.
- [ ] 1.2 Implement `packages/server/src/lifecycle/stop-ownership.ts` per design D2–D5:
  - `collectOwnedPids(config, deps)`: lock proof with an httpPort match; health proof keyed on `config.piPort`; a 2 s single-attempt fetch; host mapping; early return when `config.port <= 0`;
  - `partitionHolders(Map<pid, ports[]>, owned)`.

  Verify 6.5–6.9, 6.16 and 6.20–6.22 pass.

## 2. `cmdStop` wiring (A + B + C `--force`)

- [ ] 2.1 `parseArgs` accepts `--force`; widen `ParsedArgs.flags` to `Partial<ServerConfig> & { force?: boolean }`. Verify 6.17 passes and `npx tsc --noEmit -p packages/server` is clean.
- [ ] 2.2 Give `buildConfig` an optional `warn` argument (default `console.warn`). In `main()`, pass a no-op into the single pre-switch `buildConfig` when `subcommand === "stop"`. Verify 6.1 and 6.2 pass.
- [ ] 2.3 Export `cmdStop(config, opts = {}, injected?: StopDeps)` (design D1). It computes the owned set before the PID-file step; excludes the PID-file pid only if its kill succeeded; skips ports `<= 0`; and prints the D6 skip and force lines with every port held. `case "stop"` calls `cmdStop(config, { force: flags.force === true })`, and the internal `loadConfig()` is removed. Verify 6.3, 6.4 and 6.10–6.14 pass.
- [ ] 2.4 Restart fallback (design D8): type `cmdStopImpl` as `(cfg: ServerConfig) => Promise<void>`, call `stopFn(config)`, and never forward `force`. Update the zero-arg stubs in `cli-restart.test.ts` and `cli-start-call-shape.test.ts`. Verify 6.18 and 6.25 pass, along with the existing `cli-restart` and `cli-start-call-shape` suites.
- [ ] 2.5 Update the `cli.ts` usage block to `stop [--port n] [--pi-port n] [--force]`. The danger note says `--force` can kill another HOME's or user's dashboard, the Electron server, or an unrelated service; that it is meant only to recover an orphaned listener that cannot be attributed otherwise; and that `restart` ignores it. Verify by grepping for the usage block.

## 3. Caller fix (D)

- [ ] 3.1 In `packages/electron/scripts/assert-bundled-server-plugin-load.mjs`, declare `let port` in `main()`. Pass `--port <port> --pi-port <port+1>` to the `finally` `stop` call only when `Number.isInteger(port)`. Verify 6.19 passes.

## 4. Docs

- [ ] 4.1 Delegate the `docs/` edits to DocScribe (caveman style). They should describe the ownership rule plus `--force` with its dangers and orphan-recovery-only scope. Files:
  - `docs/faq.md` (~190, ~1645–1663);
  - `docs/architecture.md` (~4200);
  - `docs/installation-windows.md`, only where its prose describes port killing.

  Verify `grep -rniE "stale port holders|kills any stale|kills by port|holding the port.*lsof|stale-port lsof" docs/` returns nothing.
- [ ] 4.2 Update `README.md` (~445) and the skill references below. Verify with the same grep across `.pi/skills README.md`.
  - `.pi/skills/debug-dashboard/SKILL.md`;
  - `.pi/skills/debug-dashboard/references/known-issues.md`: EADDRINUSE recovery becomes `stop --force` with the danger note and the orphan-only scope;
  - `.pi/skills/debug-dashboard/references/log-locations.md`;
  - `.pi/skills/debug-dashboard/references/isolated-verification.md`: `stop` under a temp HOME is now safe; never copy `server.pid`, `server.lock*` or `instances/`;
  - `.pi/skills/implement/references/rebuild-matrix.md`;
  - `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md` (Pitfalls).
- [ ] 4.3 AGENTS.md closeout. Each entry carries `See change: fix-cli-stop-foreign-home-kill`. Verify with `kb_search --doc-type agents "stop-ownership"`.
  - add a `stop-ownership.ts` row to `packages/server/src/lifecycle/AGENTS.md`;
  - update the `instance-id.ts` row (`peekInstanceId`);
  - update the `cli.ts` row/sidecar (`cmdStop(config,{force},injected)`, ownership-scoped sweep, `buildConfig` warn param).

## 5. Gate

- [ ] 5.1 Run `review-code` on the diff, then `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the summary. Verify there are no new failures.

## 6. Tests (folded from test-plan.md)

- [ ] 6.1 Add an L1 test in `packages/server/src/__tests__/cli-parse.test.ts` (harness exemplar: the existing `guardTempHomePort` cases in that file). Triple: HOME under `os.tmpdir()`; flags `{}` / `{port:8000}` / `{port:18555}` · `buildConfig(flags, noop)` · ports `0` / `0` / `18555`; the no-op warn is called and `console.warn` is not (test-plan #E1).
- [ ] 6.2 Add an L1 test in `cli-stop.test.ts` (exemplar `packages/server/src/__tests__/cli-restart.test.ts`). Triple: temp HOME under tmpdir, `console.warn` spied · `main(["stop"])` with an injected stop · no `[isolation]` line, and `cmdStop` receives `port 0` (test-plan #E2).
- [ ] 6.3 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: `config {port:0, piPort:9999}`, `findPortHolders` spy · `cmdStop` · never called with `0`, called with `9999` (test-plan #E3).
- [ ] 6.4 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: `config {port:18555, piPort:18556}` · `cmdStop` · `findPortHolders` called with exactly `[18555, 18556]` (test-plan #E4).
- [ ] 6.5 Add an L1 test in `packages/server/src/__tests__/stop-ownership.test.ts` (exemplar `packages/server/src/__tests__/home-lock.test.ts`). Triple: sidecar `{pid, httpPort}` across the 8 combinations of present × pid match × port match · `collectOwnedPids` · the pid is owned only when all three hold (test-plan #E5).
- [ ] 6.6 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: health `{pid, instanceId}` × local id match × pid equal to the holder · `collectOwnedPids` + `partitionHolders` · owned only when both match; a matching id with a different pid is foreign (test-plan #E6).
- [ ] 6.7 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: health `piGatewayPort` is a socket-path string, `instances/9999.id` matches, `config.piPort 9999` · `collectOwnedPids` · the pid is owned; `peekInstanceId` is called with `9999` only (test-plan #E7).
- [ ] 6.8 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: `config.port 0` with spies on `readLockMeta` and `fetchHealth` · `collectOwnedPids` · an empty set and zero spy calls (test-plan #E8).
- [ ] 6.9 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: `config.host` ∈ {`""`, `0.0.0.0`, `::`, `[::]`, `localhost`, `127.0.0.1`, `192.168.1.5`} · build the health URL · the first six use `127.0.0.1` and the last passes through (test-plan #E9).
- [ ] 6.10 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: the PID-file pid `P` is alive and holds the port, with no other proof · `cmdStop` with `killProcess(P)` ok, then failing · ok: no re-sweep and no skip line; fail: one skip line for `P` (test-plan #E10).
- [ ] 6.11 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: foreign pid `Q` holds `18555` and `18556` · `cmdStop` · exactly one skip line naming both ports, and no kill (test-plan #E11).
- [ ] 6.12 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: a holder owned via the lock proof, `force` false and true · `cmdStop` · killed once in each case, no `NOT owned` text (test-plan #E12).
- [ ] 6.13 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: foreign holder `F`, `force: true` · `cmdStop` · `killProcess(F)` is called, and the output contains `--force: killing pid F` and `NOT owned by this HOME (<configDir>)` (test-plan #E13).
- [ ] 6.14 Add an L1 test in `cli-stop.test.ts` (exemplar `cli-restart.test.ts`). Triple: (a) a live owned PID file; (b) nothing; (c) a dead PID-file pid · `cmdStop` · (a) `Dashboard server stopped`; (b) and (c) output starts with `Dashboard server is not running`, and (c) calls `removePid` (test-plan #E14).
- [ ] 6.15 Add an L1 test in a new `packages/server/src/__tests__/instance-id.test.ts` plus `stop-ownership.test.ts` (exemplar `home-lock.test.ts` for temp-HOME setup). Triple: an empty temp HOME · `peekInstanceId(env, 9999)` and `collectOwnedPids` · `null` and an empty set; no `instances/`, `*.id`, `server.lock*` or `server.pid` created; after `ensureInstanceId`, `peekInstanceId` returns that id (test-plan #E15).
- [ ] 6.16 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: `HOME=<tempdir>` with `os.homedir` stubbed · `getMetaPath(getLockPath())` · the path is under `<tempdir>/.pi/dashboard/`, not under the real `os.userInfo().homedir` (test-plan #E16).
- [ ] 6.17 Add an L1 test in `cli-parse.test.ts` (exemplar: existing `parseArgs` cases). Triple: argv `["stop","--force"]` / `["stop"]` / `["restart","--force"]` · `parseArgs` · `force` is `true` / `undefined` / `true` (test-plan #E17).
- [ ] 6.18 Add an L1 test in `cli-restart.test.ts` (exemplar: its existing fallback case). Triple: `isDashboardRunning → {running:false}`, `cmdStopImpl` spy, config `C` · `cmdRestart(C)` · `cmdStopImpl` is called with exactly `C` and no `force` (test-plan #E18).
- [ ] 6.19 Add an L1 test in `scripts/__tests__/assert-bundled-server-plugin-load.test.mjs` (exemplar: its existing source-level cases). Triple: the script source · read the teardown `stop` argv · it carries `--port`/`--pi-port` from the booted port behind `Number.isInteger(port)` (test-plan #E19).
- [ ] 6.20 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: `fetchHealth` rejects (ECONNREFUSED, AbortError), returns 500, returns non-JSON, or returns JSON without `instanceId` · `collectOwnedPids` · no health proof and no throw (test-plan #X1).
- [ ] 6.21 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`, with vitest fake timers). Triple: `fetchHealth` never resolves · `collectOwnedPids` · settles after 2000 ms without the health proof, after exactly one attempt (test-plan #X2).
- [ ] 6.22 Add an L1 test in `stop-ownership.test.ts` (exemplar `home-lock.test.ts`). Triple: the sidecar is truncated or EACCES, and the id file is empty · `collectOwnedPids` · an empty set, no throw, and no disk mutation (test-plan #X3).
- [ ] 6.23 Add an L1 real-process test in `packages/server/src/__tests__/cli-stop-real.test.ts` (exemplar `packages/server/src/__tests__/cli-signal-forwarding.test.ts`). Triple: a real `node:http` listener on free port `P` answering `/api/health` `{ok:true,pid,instanceId:"other"}`, with HOME a fresh repo-local `.tmp-*` dir outside `os.tmpdir()` · spawn `bin/pi-dashboard.mjs stop --port P --pi-port P+1` · exit 0, stdout has `held by pid` and `--force`, and the listener still answers (test-plan #X4).
- [ ] 6.24 Add an L1 real-process test in `cli-stop-real.test.ts` (exemplar `cli-signal-forwarding.test.ts`). Triple: the same listener and HOME as 6.23 · spawn `stop --port P --pi-port P+1 --force` · the listener exits within 6 s, and stdout has `NOT owned by this HOME` (test-plan #X5).
- [ ] 6.25 Add an L1 real-process test in `cli-stop-real.test.ts` (exemplar `cli-signal-forwarding.test.ts`). Triple: a real dashboard started under temp `HOME=B` with `--port P --pi-port P+1 --no-tunnel` · spawn `stop --port P --pi-port P+1` with `HOME=B` · `/api/health` on `P` refuses within 6 s, and there is no skip line (test-plan #X6).
- [ ] 6.26 Add an L1 test in `cli-restart.test.ts` (exemplar: its existing fallback case). Triple: `isDashboardRunning → {running:false, portConflict:true}`, a foreign holder on `config.port`, the real `cmdStop` with injected deps · `cmdRestart` fallback · no `killProcess` for the foreign pid, then `cmdStartImpl` is called (test-plan #X7).
- [ ] 6.27 Manual live-host safety smoke (test-plan: manual-only, #X8). With the live dashboard on `:8000`, run `node packages/server/bin/pi-dashboard.mjs stop` under `HOME=$(mktemp -d)`, then under the same HOME with `--port 8000`, then under `HOME=$(mktemp -d -p "$PWD")`. Each time, check that the `/api/health` pid on 8000 is unchanged and `boot-state.json` gets no new `signal` intent.
- [ ] 6.28 Manual docs review (test-plan: manual-only, #X9). Read the `--force` wording in the README, `docs/faq.md` and the debug-dashboard skill; it must state the danger and the orphan-only scope.
