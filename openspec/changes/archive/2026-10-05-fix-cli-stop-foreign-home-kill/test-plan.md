# Test Plan — fix-cli-stop-foreign-home-kill

Stage: design   Generated: 2026-10-05

No clarifications are open. The hard gate passed: every Triple below is concrete from the delta spec and design D1–D8.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Stop subcommand: ports resolve like `start` | decision-table (HOME under tmpdir × `--port` given × value) | L1 | automated | `HOME=<os.tmpdir()>/x`; flags `{}`, `{port:8000}`, `{port:18555}` | `buildConfig(flags, noop)` | port resolves to `0`, `0`, `18555`; the no-op `warn` is called and `console.warn` is never called |
| E2 | Stop subcommand: no isolation warning | state | L1 | automated | temp HOME under tmpdir, `console.warn` spied | `main(["stop"])` with injected stop deps | no `[isolation]` line on `console.warn`; the injected `cmdStop` receives `config.port === 0` |
| E3 | Stop subcommand: port `0` never swept | BVA (port `0` / `1` / `65535`) | L1 | automated | `config.port` = `0`, `config.piPort` = `9999`; fake `findPortHolders` records calls | `cmdStop(config, {}, deps)` | `findPortHolders` is never called with `0`; it is called with `9999` |
| E4 | Stop honors explicit ports | EP | L1 | automated | `config {port:18555, piPort:18556}` | `cmdStop` | `findPortHolders` is called with exactly `[18555, 18556]`, never `8000` or `9999` |
| E5 | Sweep scoped: lock proof, decision table | decision-table (meta present × pid match × httpPort match) | L1 | automated | sidecar `{pid:P, httpPort:H}` over the 8 combinations; holder pid P on `config.port` | `collectOwnedPids` | `P` is in the set **only** when meta is present AND pid matches AND `H === config.port` |
| E6 | Sweep scoped: health proof, decision table | decision-table (instanceId match × health.pid === holder) | L1 | automated | health `{pid, instanceId}`; local `instances/<config.piPort>.id` | `collectOwnedPids` + `partitionHolders` | owned only when both match. A matching id with a different pid gives a foreign holder |
| E7 | Health key is `config.piPort` | EP (socket-path vs numeric `piGatewayPort`) | L1 | automated | health `piGatewayPort: "/home/u/.pi/dashboard/gateway-9999.sock"`, `instanceId: I`; `instances/9999.id = I`; `config.piPort 9999` | `collectOwnedPids` | the health pid is in the set; `peekInstanceId` is called with `9999`, never with the socket path |
| E8 | Port `0` skips ownership gathering | BVA | L1 | automated | `config.port 0`; spies on `readLockMeta` and `fetchHealth` | `collectOwnedPids` | returns an empty set; zero calls to both spies |
| E9 | Health host mapping | EP | L1 | automated | `config.host` ∈ {`""`, `0.0.0.0`, `::`, `[::]`, `localhost`, `127.0.0.1`, `192.168.1.5`} | health URL built | the first six give `127.0.0.1`; `192.168.1.5` passes through unchanged |
| E10 | PID file is not a proof | state-transition (PID-file kill ok / fail) | L1 | automated | `readPid → P`, alive; `P` holds `config.port`; no meta or health proof | `cmdStop` with `killProcess(P)` → ok, then (second case) → fail | ok: `P` is not swept again and no skip line. fail: one skip line for `P` naming the port |
| E11 | One holder on both ports | EP | L1 | automated | the same pid `Q` holds `18555` and `18556`; foreign | `cmdStop` | exactly one skip line, containing both `18555` and `18556`; `killProcess` is never called for `Q` |
| E12 | Owned holders are killed without warning | decision-table (force × owned) | L1 | automated | holder owned via lock proof; `force` false, then true | `cmdStop` | `killProcess` is called once in both cases; no `NOT owned` text in output |
| E13 | Forced stop override | decision-table | L1 | automated | foreign holder `F` on `config.port`; `force: true` | `cmdStop` | `killProcess(F)` is called; the output contains `--force: killing pid F` and `NOT owned by this HOME (<configDir>)` |
| E14 | Base scenarios kept | state | L1 | automated | (a) PID file alive and owned; (b) no PID file, no holders; (c) PID file with a dead pid | `cmdStop` | (a) output contains `Dashboard server stopped`; (b) and (c) output starts with `Dashboard server is not running`, exit is not affected, and (c) calls `removePid` |
| E15 | Ownership check writes nothing | state | L1 | automated | empty temp HOME (no `instances/`, no sidecar) | `peekInstanceId(env, 9999)` and `collectOwnedPids` | return `null` and an empty set; afterwards `<HOME>/.pi/dashboard/instances` does not exist and no `*.id` / `server.lock*` / `server.pid` was created |
| E16 | Lock read location pinned | EP | L1 | automated | `HOME=<tempdir>` (and `os.homedir` stubbed to it) | `getMetaPath(getLockPath())` | the path starts with `<tempdir>/.pi/dashboard/` and does not start with the real `os.userInfo().homedir` |
| E17 | `--force` parse | EP | L1 | automated | argv `["stop","--force"]`, `["stop"]`, `["restart","--force"]` | `parseArgs` | `flags.force` is `true`, `undefined`, `true`; `restart` still runs without forwarding it (E18) |
| E18 | Restart fallback passes the config, never force | state | L1 | automated | `isDashboardRunning → {running:false}`; injected `cmdStopImpl` spy; config `C` | `cmdRestart(C, deps)` | `cmdStopImpl` is called with exactly `C` (the same object), and no `force` reaches it |
| E19 | Caller fix (D): teardown argv | EP | L1 | automated | `assert-bundled-server-plugin-load.mjs` source | read the teardown argv construction | the `stop` argv carries `--port`/`--pi-port` from the booted port, guarded by `Number.isInteger(port)` (source-shape check if `main` stays unexported) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failure means not owned | fault-injection (abort) | L1 | automated | `fetchHealth` rejects with ECONNREFUSED / AbortError; returns 500; returns non-JSON; returns JSON without `instanceId` | `collectOwnedPids` | the health proof contributes nothing in all four cases; no throw escapes |
| X2 | Failure means not owned | fault-injection (delay) | L1 | automated | `fetchHealth` never resolves | `collectOwnedPids` with fake timers | settles after 2000 ms with the health proof absent; there is exactly one fetch attempt |
| X3 | Failure means not owned | fault-injection (corrupt) | L1 | automated | the sidecar is truncated JSON / unreadable (EACCES); the `instances/9999.id` file is empty | `collectOwnedPids` | an empty set (no throw); nothing on disk is modified |
| X4 | Foreign HOME does not kill a live listener (real processes) | fault-injection (foreign holder) | L1 | automated | a real `node:http` server on a free port `P` answering `/api/health` with `{ok:true,pid,instanceId:"other"}`; `HOME` = a fresh dir **outside** `os.tmpdir()` (repo-local `.tmp-*`) | spawn `bin/pi-dashboard.mjs stop --port P --pi-port P+1` | exit code 0; stdout contains `held by pid <serverPid>` and `--force`; the listener still answers `/api/health` afterwards |
| X5 | Forced stop kills a foreign listener (real processes) | fault-injection | L1 | automated | same as X4 | spawn `bin/pi-dashboard.mjs stop --port P --pi-port P+1 --force` | the listener process exits within 6 s; stdout contains `NOT owned by this HOME` |
| X6 | Temp HOME stops its own dashboard (real processes) | state-transition | L1 | automated | a real dashboard started under temp `HOME=B` on `--port P --pi-port P+1 --no-tunnel` | spawn `stop --port P --pi-port P+1` with `HOME=B` | `/api/health` on `P` is refused within 6 s; no skip line in stdout |
| X7 | Restart fallback does not kill a foreign service | fault-injection | L1 | automated | `isDashboardRunning → {running:false, portConflict:true}`; foreign holder on `config.port`; real `cmdStop` with injected deps | `cmdRestart` fallback | `killProcess` is never called for the foreign pid; `cmdStartImpl` is called afterwards (start, not stop, reports the conflict) |
| X8 | Live-host safety smoke | fault-injection | — | manual-only | live dashboard on `:8000`; `HOME=$(mktemp -d)` and `HOME=$(mktemp -d -p "$PWD")` | `pi-dashboard.mjs stop` (and `--port 8000` under the tmp HOME) | [judgment on the developer's real host: `/api/health` pid on 8000 is unchanged, `boot-state.json` gets no new `signal`; it needs the live production dashboard, which no harness provides] |
| X9 | Docs state the `--force` danger | — | — | manual-only | README / faq / skills after the edit | a reader | [judgment: the wording conveys the danger plus the orphan-only scope; the grep in tasks 5.1/5.2 only catches stale phrases] |

---

## Coverage summary

- Requirements covered: 3/3. Stop subcommand (MODIFIED) is covered by E1–E4, E14, E17, E18. "Sweep scoped to current HOME" by E5–E11, E15, E16, X1–X4, X6, X7. "Forced stop override" by E12, E13, X5, plus the docs in X9 and tasks 2.5 / 5.x.
- Scenarios by class: edge 19 · perf 0 · frontend 0 · error 9
- Scenarios by level: L1 26 · L2 0 · L3 0 · manual 2
- Scenarios by disposition: automated 26 · manual-only 2

## New infra needed

None. The real-process rows (X4–X6) reuse the spawn-the-real-wrapper pattern of `packages/server/src/__tests__/cli-signal-forwarding.test.ts`.
