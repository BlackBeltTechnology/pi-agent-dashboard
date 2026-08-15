# Test Plan — fix-keeper-session-identity-and-reattach

Stage: design   Generated: 2026-08-15

Clarifications resolved at the HARD gate:

- **C1 — diagnostics observable**: a stable-prefixed log line (`[keeper-identity] …`)
  written to `server.log`, matching the existing `[event-wiring]` / `[gateway]` prefix
  convention. Every observability row asserts that line.
- **C2 — cold-start cost**: no time budget. The performance class is deliberately **empty**;
  scan cost is not tested.

Requirement refs used below:

- **HS-1** headless-spawn · *Pi PID capture SHALL follow an identity-bearing resolution only*
- **HS-2** headless-spawn · *The keeper's pi-PID sidecar SHALL fill an absent `piPid`*
- **HS-3** headless-spawn · *A recorded pi PID SHALL be liveness-checked before it is trusted*
- **HS-4** headless-spawn · *Positional resolution of a keeper session SHALL be reported*
- **KS-1** rpc-keeper-sidecar · *Keeper SHALL record pi's PID in a sidecar after spawning pi*
- **KS-2** rpc-keeper-sidecar · *Server reconnect to existing keepers on startup* (MODIFIED)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | HS-1 | decision-table | L1 | automated | keeper-mode entry `{pid:K, keeperPid:K, spawnToken:T, piPid:unset}` | `session_register {spawnToken:T, pid:P}` resolves via the token tier | `entry.piPid === P`; the persisted pid file for that entry contains `piPid: P` |
| E2 | HS-1 | decision-table | L1 | automated | keeper-mode entry with `piPid:P` already set | a re-register carrying `pid:P` resolves via the pid tier (Tier 2b matches *on* `piPid`) | `entry.piPid` still `P`; no write occurs — confirms there is no reachable new-capture path on this tier for keeper entries |
| E3 | HS-1 | decision-table | L1 | automated | exactly **one** unlinked keeper-mode entry for cwd `C` | `session_register {cwd:C, pid:P}` with no token and no pid match, resolving via cwd-FIFO | `entry.piPid` remains `undefined`; entry is still linked to the session |
| E4 | HS-1 | decision-table | L1 | automated | **two** unlinked keeper-mode entries for cwd `C` | `session_register {cwd:C, pid:P}` resolving via cwd-FIFO | `piPid` remains `undefined` on whichever entry was selected |
| E5 | HS-1 | equivalence-partitioning | L1 | automated | keeper-mode entry, `piPid:unset` | `session_register` carrying **no** `pid` field | entry links as before; `entry.piPid === undefined` |
| E6 | HS-1 | decision-table | L1 | automated | non-keeper entry (`keeperPid: undefined`), `pid:N` | any tier resolves it | `entry.piPid === undefined`; `getPid(sessionId) === N` |
| E7 | HS-2 | decision-table | L1 | automated | entry `{keeperPid:K, piPid:unset}`; sidecar for `K` contains live PID `Y` | startup keeper discovery runs | `entry.piPid === Y`, persisted |
| E8 | HS-2 | decision-table | L1 | automated | entry `{keeperPid:K, piPid:X}`; sidecar contains `Y` (`Y !== X`) | startup keeper discovery runs | `entry.piPid` still `X` — the sidecar fills, it does not arbitrate |
| E9 | HS-2 | EP + BVA | L1 | automated | sidecar contents across partitions: absent file, empty string, `"abc"`, `"0"`, `"-1"`, `"  4242  "` (padded), value > `pid_max` | startup keeper discovery runs | only the padded valid integer is accepted; every other partition leaves `piPid` exactly as it was, and none throws |
| E10 | KS-2 | state-transition | L1 | automated | entry with `piPid:P` persisted to the pid file | server restart → `cleanupOrphans` reclaim rebuilds entries | reclaimed entry still carries `piPid === P` and `keeperPid` |
| E11 | KS-2 | state-transition | L1 | automated | a **reclaimed** entry that already carries `keeperPid:K` and has `piPid:unset`; readable sidecar naming live `Y` | startup discovery runs after reclaim | `entry.piPid === Y` — regression guard for the `keeperPid === undefined` guard that today skips every reclaimed entry |
| E12 | KS-1 | EP over filenames | L1 | automated | filenames `<sid>.rpc.sock.pi-pid` and `pi-rpc-<sid>.pi-pid` | matched against the Unix `^(.+)\.rpc\.sock\.pid$` and Windows `^pi-rpc-(.+)\.pid$` scan patterns | neither matches; no discovered-keeper record is produced from a pi-PID filename, and no session id of the form `<sid>.pi` is ever emitted |
| E13 | KS-1 | state-transition | L2 | automated | a keeper spawned on the current build | inspect its own `.pid` sidecar | file contains exactly the keeper PID as a bare integer, byte-identical to the pre-change format; the startup orphan-cleanup reader still parses it |
| E14 | HS-3 | decision-table | L1 | automated | sidecar naming a **live** PID `P`, live keeper | startup discovery runs | `entry.piPid === P`; a `[keeper-identity]` line records the recorded state |
| E15 | HS-4 | state-transition | L1 | automated | one or more unlinked keeper-mode entries for cwd `C` | `session_register {cwd:C}` resolves one via cwd-FIFO | exactly one `[keeper-identity]` line naming the cwd and the resolved entry |
| E16 | HS-4 | state-transition | L1 | automated | a cwd with **no** keeper-mode entry | `session_register` for that cwd falls through cwd-FIFO and matches nothing | **no** `[keeper-identity]` line is emitted for that register |
| E17 | KS-1 | state-transition | L2 | automated | a running keeper with pi alive and both sidecars present | send SIGTERM to the keeper | keeper exits; socket, own `.pid`, and `.pi-pid` sidecars are all unlinked |
| E18 | KS-1 | state-transition | L2 | automated | a keeper starting normally | read `keeper-<sessionId>.log` after startup | the `.pi-pid` file exists **before** the `keeper ready` line is written (ordering assertion) |
| E19 | HS-1 | decision-table | L1 | automated | two unlinked keeper-mode entries for cwd `C`, registers arriving in a fixed order | cwd-FIFO resolves both registers | the entry each session links to is identical to the pre-change behaviour — guards the "does not change which entry cwd-FIFO links" non-goal |
| E20 | KS-2 | decision-table | L1 | automated | three discovered keepers: one with `piPid` absent + readable sidecar, one with `piPid` already set, one with no sidecar | startup discovery runs | one `[keeper-identity]` line per keeper, carrying `recorded`, `unchanged`, and `unavailable` respectively |

### Performance

Deliberately empty per clarification **C2** — no cold-start time budget is defined, and a
threshold-free timing assertion would be a flaky test rather than a real scenario.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | KS-2 | state-transition | L3 | automated | a dashboard-spawned (keeper-backed) session running against the docker harness | restart the dashboard server, then dispatch a command to that session | the session converges back to dispatchable — the command reaches **that** session's pi and no other; harness port read from `.pi-test-harness.json` (`dashboardPort`), never hardcoded |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | KS-1 | fault-injection (write failure) | L2 | automated | sessions directory made unwritable for the pi-PID write only | keeper spawns pi successfully, then attempts the sidecar write | keeper logs the failure and **keeps running**; pi remains alive; no `.pi-pid` file exists; the keeper's own `.pid` sidecar is unaffected |
| X2 | HS-3 | fault-injection (missing dependency) | L1 | automated | live keeper, **no** pi-PID sidecar (write failed or predates the change) | the liveness probe is evaluated for that session | probe returns **alive** — absence maps to alive, never to dead |
| X3 | HS-3 · KS-2 | fault-injection (missing dependency) | L2 | automated | a healthy keeper + live pi with **no** pi-PID sidecar | a full server startup scan runs | keeper receives no SIGTERM; socket and `.pid` sidecar are **not** unlinked; the session remains dispatchable — guards against the absent-file-reads-as-dead regression |
| X4 | HS-3 | fault-injection (stale data) | L1 | automated | sidecar naming a PID that is **not** alive | startup discovery runs | that PID is **not** recorded; `entry.piPid` unchanged; a `[keeper-identity]` line records the unavailable/dead state |
| X5 | KS-2 | fault-injection (abrupt kill) | L2 | automated | keeper SIGKILLed, leaving socket + both sidecars behind | server startup scan runs | all stale files unlinked; no discovered-keeper record is emitted for that session; no phantom session id appears |
| X6 | KS-1 | fault-injection (spawn failure) | L2 | automated | keeper configured so the pi spawn fails (unresolvable binary) | keeper starts | no `.pi-pid` sidecar is created; keeper exits non-zero per existing behaviour |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | HS-3 | residual-risk review | — | manual-only | the PID-reuse window between pi's death and the keeper unlinking its sidecar | reviewer reasons about the window during code review | [judgment: the residual window is acceptable and no caller can act destructively inside it — exercising real OS PID reuse is not reproducible on demand, so there is no automatable signal] |

---

## Coverage summary

- Requirements covered: 6/6 (HS-1, HS-2, HS-3, HS-4, KS-1, KS-2)
- Scenarios by class: edge 20 · perf 0 · frontend 1 · error 6 · manual 1
- Scenarios by level: L1 19 · L2 7 · L3 1 · manual-only 1
- Scenarios by disposition: automated 27 · manual-only 1

## New infra needed

None. Every automated row lands in an existing tier: vitest (`packages/*/src/**/__tests__/`),
the qa VM smoke suite (`qa/tests/*.sh` / `*.ps1`), or Playwright against the docker harness
(`tests/e2e/`). E12/E13/E17/E18 extend the existing keeper coverage rather than adding a harness.
