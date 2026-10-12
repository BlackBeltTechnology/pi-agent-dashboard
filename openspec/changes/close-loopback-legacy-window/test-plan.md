# Test Plan — close-loopback-legacy-window

Stage: design   Generated: 2026-10-14

Hard gate resolved:
- P1 budget = p99 added latency < 1 ms per verify.
- CLI lock timeout = exit 1 + `local token lock busy (~/.pi/dashboard/local/token.lock) — another dashboard is writing the token; retry`.

Lock bounds (30 s stale / 35 s wait) are injectable (D4). L1 lock rows use shrunk values (stale 300 ms, wait 350 ms).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | local-ipc: First mint | EP | L1 | automated | temp HOME, no `local/` dir | `ensureLocalToken(dir, {allowRotate:true})` | returns 43-char base64url; `token` = value; `token-epoch` = `1`; both files `0600`, dir `0700` (POSIX) |
| E2 | local-ipc: Pre-rotation token replaced once / Reuse | decision-table | L1 | automated | token `T0` + epoch file ∈ {absent, `""`, `x`, `-1`, `0`, `1`, `1\n`, `2`, `1234567890`} × allowRotate ∈ {true,false} | `ensureLocalToken` | rotates (new ≠ `T0`, epoch `1`) iff epoch ∈ {absent, `""`, `x`, `-1`, `0`, `1234567890`} AND allowRotate; otherwise returns `T0` byte-identical and the epoch file is unchanged |
| E3 | local-ipc: Interrupted rotation completes | state-transition | L1 | automated | token `T1` written, no epoch file | `ensureLocalToken(dir,{allowRotate:true})` | token ≠ `T1`; epoch `1`; a second call returns the same value |
| E4 | local-ipc: Local tooling never rotates (default) | EP | L1 | automated | pre-epoch token `T0` | `ensureLocalToken(dir)` (no options) | returns `T0`; `token-epoch` absent; no lock file created |
| E5 | local-ipc: Local tooling never rotates (CLI) | EP | L1 | automated | temp HOME, pre-epoch token `T0` | `pi-dashboard open` code path (`cmdOpen`) | token file still `T0`; no `token-epoch` |
| E6 | design D3 tmp cleanup | EP | L1 | automated | `token.tmp-99-ab`, `token-epoch.tmp-99-cd`, `notes.tmp-1` in `local/`; no token | locked mint | the two `token*.tmp-*` files are gone; `notes.tmp-1` remains |
| E7 | local-ipc: Valid token presented (raw) | EP | L1 | automated | verifier, window closed; raw `X-Pi-Local-Token` = real token; no proof | `stamp()` | verdict `absent`; `verifyLocalToken` spy called 0 times |
| E8 | local-ipc: Mismatched token presented | EP | L1 | automated | raw header = `"wrong"` vs real token | `stamp()` on each | both verdicts `absent`; identical log output except rate-limit state |
| E9 | pi-gateway-auth: Legacy token acceptance is recorded | BVA | L1 | automated | raw header values `""`, `"   "`, `"x"`, `["x","y"]` from separate caller kinds | `stamp()` | retired-header line emitted only for `"x"` and `["x","y"]`; no line contains `x` as a value |
| E10 | pi-gateway-auth: rate limit | BVA | L1 | automated | 3 raw-header `http` requests at t=0, 1 s, 2 s; one more at t=61 s (fake clock) | `stamp()` | 1 line at t=0; the line at t=61 s carries suppressed count `2` |
| E11 | pi-gateway-auth: Header alongside a valid proof | EP | L1 | automated | valid proof + raw header | `stamp()` | verdict `proof`; no retired-header line |
| E12 | pi-gateway-auth: bridge admission matrix (production wiring) | decision-table | L1 | automated | loopback TCP upgrade with {none, raw-only, invalid proof, valid proof, valid ticket} | upgrade against `server.ts`-wired gateway | refused `local-token-missing` / refused `local-token-missing` + retired line / refused `local-proof-invalid` / 101 + `X-Pi-Local-Proof-Server` / 101 without counter-proof |
| E13 | pi-gateway-auth: Tokenless loopback bridge is refused | state-transition | L1 | automated | existing case `bridge-local-token-upgrade.test.ts:105` | tokenless loopback upgrade, production options | refused; the old "still admits … deprecation window" assertion is replaced |
| E14 | Raw token retired: HTTP equivalence | EP | L1 | automated | raw-only vs no-credential requests to `POST /api/paired-devices` (non-loopback), `POST /api/pair/approve`, local-code mint, strict-mode `operate` route | inject | identical status and body per pair (401 / 401 + device still pending / no code / denied) |
| E15 | design D8 seams fail closed | decision-table | L1 | automated | `decideBridgeUpgrade` with `requireTicketOnLoopback` omitted; `legacy` verdict without `allowLegacyVerdict`; verifier with `acceptLegacyToken` omitted + raw header | call | refused / refused / verdict `absent` |
| E16 | Raw token retired: Harvested pre-rotation token | EP | L1 | automated | proof minted with `T0`; verifier on rotated `T1` | verify | rejected `bad-mac` |
| E17 | trust: rotated token invalidates issued cookies | state-transition | L1 | automated | strict mode; `pi_dash_local` cookie issued under `T0`; token rotated to `T1` | `operate` route request with the cookie, then a fresh code→cookie bootstrap | first denied; after bootstrap admitted |
| E18 | cross-site-request-gate: Header-less / Origin precedence | decision-table | L1 | automated | loopback upgrade {no Origin + no credential, `Origin: http://localhost:8000` + raw header} | upgrade | refused `local-token-missing` / refused browser-origin with no retired-header line |
| E19 | local-ipc: Shipped local tooling never sends the raw token | EP | L1 | automated | repo source minus tests and `resources/server` | static scan in an existing tooling test | 0 raw-header send sites; `LOCAL_TOKEN_HEADER` imported only under `packages/server/src/auth/` |
| E20 | Raw token retired (e2e) | EP | L3 | automated | docker harness | host-side `POST /api/pair/approve` with raw token; in-container `operatorCall` with proof | 401 / 200 |
| E21 | D7 harness path | state-transition | L3 | automated | docker harness, fresh pairing code | `bridge-credential` flow: redeem → `operatorCall` approve → bearer → ticket → bridge dial | bridge registers its session id |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D5 stat-per-verify | tail-latency | L1 | automated | 10 000 valid-proof verifications, unchanged token file; source-backed vs string-backed verifier | p99 (source − string) < 1 ms; `readFileSync` count after warm-up = 0 | one run |

### Frontend-quirk (state convergence)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | design D5 source | state-transition | L1 | automated | source on token `T0` | `writeAtomic(token, T1)` then `current()` ×2 | `T1`; `generation` +1 exactly once; the second call does no `readFileSync` |
| F2 | local-ipc: Unreadable token file keeps the last good key | fault-injection | L1 | automated | source on `T0`; file then emptied / deleted / mode `000` (POSIX) | `current()` | returns `T0` each time; one log line per fault kind |
| F3 | local-ipc: A live server follows a rotation (unit) | state-transition | L1 | automated | verifier + trust context built on a source over `T0` | file rotated to `T1`; verify a `T1` proof, a `T0` proof, a `T1` cookie | admitted / `bad-mac` / admitted, with no rebuild |
| F4 | local-ipc: A live server follows a rotation (two servers) | state-transition | L1 | automated | temp HOME; server A started on epoch-1 token `T0`; token epoch then removed | server B `createServer` + start on the same HOME (rotates) | A admits a `T1` proof bridge upgrade and refuses a `T0` one, without a restart |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | local-ipc: Concurrent starters agree (fresh) | fault-injection (race) | L1 | automated | 2 child processes, fresh temp HOME | both `ensureLocalToken` at once | both print the same value = the file |
| X2 | local-ipc: Concurrent starters agree (rotation) | fault-injection (race) | L1 | automated | 2 child processes, pre-epoch `T0` | both `ensureLocalToken({allowRotate:true})` | same value ≠ `T0` = the file; epoch `1` |
| X3 | D4 dead-pid lock | fault-injection (abort) | L1 | automated | `token.lock` naming a dead pid, fresh `at` | rotation | lock broken; rotation completes |
| X4 | D4 aged lock (PID reuse) | BVA | L1 | automated | lock naming a live pid, `at` = now − 301 ms (stale 300 ms) vs now − 299 ms | rotation | 301 ms: broken; 299 ms: waits |
| X5 | D4 single break | fault-injection (race) | L1 | automated | stale lock; 2 child breakers | both break at once | exactly one `token.lock.breaking.*` link succeeds; the other gets `EEXIST`; one rotation |
| X6 | D4 fresh lock survives a break | fault-injection (race) | L1 | automated | breaker paused (hook) after reading stale content C; another process claims a fresh lock | breaker resumes | fresh lock still present; breaker waits |
| X7 | D4 release fencing | state-transition | L1 | automated | holder H's lock broken and re-claimed by K | H releases | K's lock still present |
| X8 | D4 wait timeout (server) | fault-injection (delay) | L1 | automated | lock held by the live test pid, `at` refreshed; wait 350 ms | `ensureLocalTokenAsync` | rejects `LocalTokenLockTimeoutError` after ≥ 350 ms; token unchanged |
| X9 | D4 wait timeout (CLI) | fault-injection (delay) | L1 | automated | same held lock, fresh HOME (mint path) | CLI `open` | exit `1`; stderr = `local token lock busy (~/.pi/dashboard/local/token.lock) — another dashboard is writing the token; retry` |
| X10 | D3 Windows rename retry | fault-injection (abort) | L1 | automated | injected `renameSync` throwing `EPERM` 3× then OK; separately 21× | rotation | first: token rotated; second: throws, tmp removed, token unchanged |
| X11 | design D3 on real Windows | fault-injection (race) | L2 | automated | `qa/tests/28-gateway-windows.ps1`: background loop reading `token` every 5 ms; pre-epoch token | start the server | rotation succeeds; no read returned empty; epoch `1` |
| X12 | pi-gateway-auth: Legacy token acceptance is recorded (CLI smoke) | EP | L2 | automated | `qa/tests/39-cli-open.sh` running server | `login --local`, `token create`, `service list`; then `curl -H 'X-Pi-Local-Token: x'` | retired-header line count +0 after the CLI verbs, +1 after the curl |
| X13 | local-ipc: Pre-rotation token replaced once (smoke) | state-transition | L2 | automated | `qa/tests/39-cli-open.sh`: delete `token-epoch` before start | start, restart | token changes on the first start and is unchanged after the restart; epoch `1` |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | D6 Electron window across upgrade | state-transition | — | manual-only | Electron window open on 0.9.x, strict mode | server upgraded to 1.0.0 | window loses local proof until reloaded; works after a reload |
| M2 | Raw token retired: Old bridge is refused | EP | — | manual-only | real 0.9.0-era pi bridge (pre-proof) | connect to a 1.0.0 server | refused; server log shows the retired-header line; `npm run reload` with the current extension reconnects |
| M3 | Migration: rollback | state-transition | — | manual-only | 1.0.0 → 0.9.x → delete `token-epoch` → 1.0.0 | each start | 0.9.x starts on the rotated token; re-upgrade rotates again |

---

## Coverage summary

- Requirements covered: 15/15 delta requirements (pi-gateway-auth 6 incl. ADDED; local-ipc 3; trust 1; bearer 3; qr 1; cross-site 1) — bearer/qr covered by E14.
- Scenarios by class: edge 21 · perf 1 · frontend 4 · error 13 · manual 3
- Scenarios by level: L1 34 · L2 3 · L3 2 · — 3
- Scenarios by disposition: automated 39 · manual-only 3

## New infra needed

- A child-process race harness for `local-token.test.ts` (X1, X2, X5, X6): a small fixture script run via `node --import tsx`. The repo has no such fixture for this module yet. Exemplar for the spawn pattern: `packages/server/src/__tests__/cli-stop-real.test.ts`.
- An in-container `operatorCall` helper for e2e (E20, E21, D7).
