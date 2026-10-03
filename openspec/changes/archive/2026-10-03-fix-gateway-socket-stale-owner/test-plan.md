# Test Plan — fix-gateway-socket-stale-owner

Stage: design   Generated: 2026-10-01

Hard gate: one gap (health shape with two listeners) resolved with the user →
`gateway.listeners` array (design D7). No open clarifications.

Conventions: "stale socket" = a real unix socket file left by a SIGKILLed child
listener (as in `spikes/01`), not a regular file. "unrelated younger pid" = a
live `sleep` child spawned AFTER the pidfile was written. Probe verdicts may be
injected via the existing `probe` seam; `processStartedAt` and platform via new
seams.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | transport: stale endpoint — "A restart after a reboot reclaims the socket" | state-transition | L1 | automated | stale socket; pidfile `"<pid of unrelated younger live process> <startMs that process did not have>"` | `bindGatewaySocket` with probe `refused` | resolves listening; path is a socket; pidfile now `"<process.pid> <n>"` |
| E2 | transport: "An unprovable abandoned socket fails closed" (D1.2 slack) | BVA | L1 | automated | stale socket; pidfile `"<live pid> <its real start + 1500>"` (inside 2 s) | bind, probe `refused` | rejects `GatewaySocketConflictError`; socket file unchanged (same inode) |
| E3 | transport: "A restart after a reboot reclaims the socket" (D1.2 slack) | BVA | L1 | automated | stale socket; pidfile `"<live pid> <its real start + 2500>"` (just over 2 s) | bind, probe `refused` | resolves listening; pidfile rewritten |
| E4 | transport: legacy bare-pid (D1.3) | decision-table | L1 | automated | stale socket; bare `"<pid>\n"`; case a: live pid started > mtime+2 s; case b: live pid started before mtime | bind, probe `refused` | a: reclaimed, listening; b: `GatewaySocketConflictError`, file intact |
| E5 | transport: "…including the restarting dashboard itself" (D1.4) | decision-table | L1 | automated | stale socket; pidfile = `process.pid`; case a: registry has no listener for the path; case b: this process already serves that path | bind, probe `refused` | a: reclaimed; b: `GatewaySocketConflictError`, live listener still accepts a connection |
| E6 | transport: "An unprovable abandoned socket fails closed" (fail-closed inputs) | decision-table | L1 | automated | stale socket; pidfile one of: missing, empty, `"abc"`, `"123 abc"` with pid 123 alive, start probe → `null` | bind, probe `refused` | every case rejects `GatewaySocketConflictError`; file intact |
| E7 | transport: "A non-socket file is never removed" | EP | L1 | automated | at path: regular file; symlink to a stale socket; dangling symlink — each with a dead pid in the pidfile | bind (real probe) | rejects conflict; path still exists with the same `lstat` type; existing test "reclaims a regular file on refused + dead pid" (`gateway-socket-bind.test.ts:243`) flipped to this expectation |
| E8 | transport: owner record format (D1) | EP | L1 | automated | clean dir; case a: start probe returns a number; case b: returns `null` | bind | a: pidfile matches `^<process.pid> \d+\n$`, mode `0600`; b: `^<process.pid>\n$` |
| E9 | (D3) `processStartedAt` | EP | L1 | automated | `/proc/<pid>/stat` fixture whose comm is `(a) b)` with spaces; `/proc/stat` `btime 1700000000`; field 22 = 12345; unreadable file; `ps` output `Thu Oct  1 00:49:08 2026` | parse | `1700000000*1000 + 123450`; unreadable → `null`; `ps` line → `Date.parse` value; live `process.pid` within 5 s of `Date.now() - process.uptime()*1000` |
| E10 | transport: "Endpoint selection is observable" — health | decision-table | L1 | automated | gateway states: socket only; socket + TCP opt-in; fallback (occupied); fallback (unsupported); unrepresentable path | `GET /api/health` | `gateway.listeners` = `["unix"]` / `["unix","tcp"]` / `["loopback-fallback"]`+`fallbackReason:"occupied"` / `["loopback-fallback"]`+`"unsupported"` / `["loopback"]`; body contains neither the socket path nor any pid |
| E11 | transport: "Sessions spawned after a fallback reach their spawner" — spawn env | decision-table | L1 | automated | served transport: unix at path; loopback-fallback; getter unset; each with inherited `PI_DASHBOARD_SOCKET=/other.sock` | `buildSpawnEnv` | unix: `PI_DASHBOARD_SOCKET=<path>`; fallback: no `PI_DASHBOARD_SOCKET`, `PI_DASHBOARD_URL=ws://127.0.0.1:<piPort>`; unset: no socket pin; inherited value never survives |
| E12 | transport: spawned sessions reach spawner "whichever launcher" — tmux | EP | L1 | automated | tmux session exists / not; pinned unix vs fallback | build tmux argv | argv contains `-e PI_DASHBOARD_URL=<url>` and `-e PI_DASHBOARD_SOCKET=<path>` (unix) or `-e PI_DASHBOARD_SOCKET=` (fallback), alongside the spawn-token `-e` |

### Performance

None — the change states no latency/throughput requirement. (`processStartedAt`
runs only on the `refused` path, once per start.)

### Frontend-quirk

None — no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | transport: "A live socket is never unlinked" + "Refused socket bind binds a loopback fallback only" | fault-injection (abort) | L1 | automated | incumbent `net` server listening on the socket path; TCP opt-in off | start the gateway listeners | startup resolves; a ws client to `127.0.0.1:<piPort>` with the local token completes upgrade; incumbent still accepts a connection on the socket; nothing listens on a non-loopback address; log line contains the path, verdict `live` and the recorded pid |
| X2 | transport: "A restart after a reboot reclaims the socket" (#744 end-to-end, spike 3 B) | fault-injection (abort) | L1 | automated | stale socket from a SIGKILLed child; pidfile = `process.pid` | start the gateway listeners (TCP opt-in off) | `transport()` = `{transport:"unix"}`; no TCP listener on `<piPort>`; a ws+unix client connects |
| X3 | transport: "Fallback listener port unavailable aborts startup" | fault-injection (abort) | L1 | automated | live incumbent on the socket AND another process holding `127.0.0.1:<piPort>` | start the gateway listeners | rejects with a message containing both the socket path and `<piPort>`; no listener left bound by the gateway |
| X4 | transport: "A socket bind failure other than an occupied or unsupported path aborts startup" | fault-injection (abort) | L1 | automated | case a: socket dir chmod `0500` (EACCES); case b: bind lock held by another process past retries (ELOCKED); TCP opt-in off | start the gateway listeners | rejects naming the path and the cause (`EACCES` / lock file); no loopback listener on `<piPort>` |
| X5 | transport: unsupported filesystem → fallback | fault-injection (abort) | L1 | automated | `listen()` fails with `EOPNOTSUPP` (injected via `createServer` seam) | start the gateway listeners | resolves on the loopback fallback; health `fallbackReason:"unsupported"` |
| X6 | transport: "With the explicit TCP listener a socket failure keeps TCP serving" | fault-injection (abort) | L1 | automated | TCP opt-in on; socket bind fails (live incumbent, then EACCES) | start the gateway listeners | resolves; a client to the TCP port completes upgrade; the shared `wss` was not torn down; failure logged with path + cause |
| X7 | (D5) `transport()` after a failed socket bind | state-transition | L1 | automated | `startOnSocket` rejected | call `transport()` / `address()` | neither throws |
| X8 | auth: "POSIX fallback listener requires the local token" / "presents the local token" | decision-table | L1 | automated | gateway serving loopback-fallback | upgrade with: no credential; wrong token; valid `X-Pi-Local-Token`; valid bridge ticket | no credential / wrong → refused before upgrade, no session id registered; token / ticket → registers |
| X9 | auth: fallback no-grace is per-listener | decision-table | L1 | automated | gateway with TCP opt-in listener (D10b grace on) vs a gateway on loopback-fallback | tokenless loopback upgrade to each | opt-in listener: accepted (unchanged); fallback: refused |
| X10 | transport: "A stopping dashboard never removes its successor's socket" | state-transition | L1 | automated | A bound path P; A's listener closed (libuv unlinked P); B binds P and writes its pidfile | A's `unbindGatewaySocket` completes | B's socket still accepts a connection; pidfile names B; `<P>.lock` still exists |
| X11 | transport: same-process rebind (`/api/restart`) | state-transition | L1 | automated | bind P, unbind P, in one process | bind P again (real probe) | resolves on unix; no conflict |
| X12 | (D1) pidfile write failure is logged | fault-injection (abort) | L1 | automated | `<P>.pid` pre-created as a directory | bind | resolves listening; a warning containing `<P>.pid` is logged |
| X13 | transport: "An unprovable abandoned socket fails closed" — saturated live owner on an ambiguous platform | fault-injection (delay) | L1 | automated | live listener on P (its own pid + real start recorded); probe injected `refused` (macOS saturated-backlog behaviour) | bind | rejects conflict; incumbent still accepts a connection |
| X14 | transport: "Sessions spawned after a fallback reach their spawner" — registration | state-transition | L1 | automated | live incumbent gateway on P; second gateway in fallback; env from `buildSpawnEnv` for the second | a bridge client dials the env-resolved endpoint with the local token and sends `session_register` | the session appears in the fallback gateway's session manager, not the incumbent's |
| X15 | transport: "A restart after a reboot reclaims the socket" — real host/container reboot (issue CP-08) | fault-injection (abort) | — | manual-only | docker harness with persistent `~/.pi`, pidfile naming the server's own post-restart pid | `docker restart` of the container (host-level lifecycle) | dashboard starts; `/api/health` `gateway.listeners` = `["unix"]`; no manual socket deletion needed |

---

## Coverage summary

- Requirements covered: 5/5 modified requirements (transport: stale endpoint, non-loopback opt-in, platform-appropriate transport, endpoint observability; auth: local authorisation).
- Scenarios by class: edge 12 · perf 0 · frontend 0 · error 15
- Scenarios by level: L1 26 · L2 0 · L3 0
- Scenarios by disposition: automated 26 · manual-only 1

## New infra needed

- Seams, not harnesses: `processStartedAt` + platform injection into
  `bindGatewaySocket`; the gateway-listener startup sequence from `server.ts`
  (~L2648-2663) extracted into a testable function so X1–X6 run without
  booting the whole server.
