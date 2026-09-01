# Test Plan — fix-autostart-discovery-precedence

Stage: design   Generated: 2026-08-29

All Triple slots resolved from the spec deltas + design decisions; no
clarification gate fired. `autoStartServer` exposes `AutoStartDeps` seams
(`discoverDashboard`, `isDashboardRunning`, `launchServer`, `notify`, `log`) so
every L1 scenario below is drivable with fakes — no real network or spawn.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Resolved port status before discovery | state-transition | L1 | automated | `isDashboardRunning(resolvedPort)→{running:true}`, `discoverDashboard→[local@8588]` | pre-launch autoStart | returns `{port:resolvedPort}`; `discoverDashboard` NOT called (or its result ignored); `notify` not called |
| E2 | Resolved port serves — no record | state-transition | L1 | automated | resolved port serves, a stray advertises | pre-launch autoStart | no `appendAutoStartLog` mismatch line, no `notify` at any level |
| E3 | Silent + verified candidate adopted | state-transition | L1 | automated | `isDashboardRunning(resolvedPort)→{running:false}`, candidate@8588 health-ok | pre-launch autoStart | returns `{port:8588}`; `notify("warning")` names 8000 and 8588 |
| E4 | Candidate verified before adoption | decision-table | L1 | automated | resolved silent, candidate@8588 `/api/health`→not-ok | pre-launch autoStart | candidate rejected; proceeds to launch step (`launchServer` called) |
| E5 | Candidate health times out | fault-injection (delay) | L1 | automated | resolved silent, candidate probe never resolves within timeout | pre-launch autoStart | candidate rejected; rejection logged with candidate endpoint + reason |
| E6 | portConflict falls through to discovery | decision-table | L1 | automated | `isDashboardRunning(resolvedPort)→{portConflict:true}`, candidate@8588 health-ok | pre-launch autoStart | returns `{port:8588}`; port-occupied refusal NOT logged |
| E7 | portConflict, no candidate → refuse | decision-table | L1 | automated | `{portConflict:true}`, `discoverDashboard→[]` | pre-launch autoStart | "port occupied by another service" logged; returns `{}` (no launch) |
| E8 | Deterministic: resolved-port match wins | BVA | L1 | automated | `discoverDashboard→[local@8588, local@8000]`, resolved=8000, both health-ok | selection | selects 8000 |
| E9 | Deterministic: lowest port, order-independent | BVA | L1 | automated | `[local@8611, local@8588]` then reversed `[8588,8611]`, none match resolved | selection ×2 | both orderings select 8588 |
| E10 | Deterministic: same-port host tiebreak | decision-table | L1 | automated | two locals same lowest port, hosts `hostA`/`hostB`, both arrival orders | selection ×2 | both orderings select same host by string order |
| E11 | Bootstrap-aware probe retries on timeout | BVA | L1 | automated | resolved-port probe: attempt 1 `AbortError`, attempt 2 `{running:true}` | pre-launch autoStart | resolved port treated as serving; returned; no candidate displaces it |
| E12 | Cold start (ECONNREFUSED) does not pay retries | BVA | L1 | automated | resolved-port probe throws ECONNREFUSED (not AbortError) | pre-launch autoStart | falls through without retry-delay sleeps (assert `_sleep` seam not invoked); reaches launch |

### Frontend-quirk

_(none — this change has no rendered-UI surface; the client is untouched.)_

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Post-launch: no stray displaces our server | state-transition | L1 | automated | `launchServer→success`, resolved port health-ok, `discoverDashboard→[local@8588]` | spawnAndAttach | returns `{port:resolvedPort}`; 8588 not returned |
| X2 | Post-launch: no silent warning on transient miss | fault-injection (delay) | L1 | automated | `launchServer→success`, resolved-port probe misses once then answers | spawnAndAttach | no `notify` "resolved port silent"; resolved port returned after retry |
| X3 | Connect path unchanged (regression guard) | invariant | L1 | automated | existing endpoint-resolution + decideRetarget test suite | run unchanged suites | all pass; no edits to `endpoint-resolution.ts` (assert via git/no-import) |
| X4 | Ephemeral exits on ESRCH via graceful stop | state-transition | L1 | automated | ephemeral on; boot-parent liveness helper → parent absent (ESRCH) | liveness tick | `server.stop` called (not `process.exit`); exit intent recorded = ephemeral |
| X5 | Standalone unaffected by dead parent | state-transition | L1 | automated | ephemeral OFF; liveness → parent absent | liveness tick | `server.stop` NOT called; server keeps running |
| X6 | EPERM treated as alive | decision-table | L1 | automated | ephemeral on; liveness probe throws EPERM | liveness tick | parent treated alive; `server.stop` NOT called |
| X7 | POSIX PID reuse defers exit | state-transition | L1 | automated | ephemeral on POSIX; Tier-1 signal-0 on recycled PID → alive | liveness tick | server keeps running |
| X8 | Windows reuse-immune tier authoritative | decision-table | L1 | automated | ephemeral on Windows; Tier-2 → original exited, Tier-1 → recycled alive | liveness tick | Tier-2 wins; `server.stop` called |
| X9 | Ephemeral not inferred from env/HOME/bind | decision-table | L1 | automated | `PI_DASHBOARD_EPHEMERAL=1` set, flag NOT passed, temp HOME, loopback bind | server init | server is NOT ephemeral; dead parent does not stop it |
| X10 | Ephemeral state visible in health | state-transition | L1 | automated | ephemeral flag passed | `GET /api/health` | response indicates ephemeral=true |

### Performance

_(none — the proposal states no latency/throughput budget applies. Exit latency
is bounded by the liveness interval, asserted structurally in X4, not measured.)_

---

## Coverage summary

- Requirements covered: 8/8 (4 bridge-auto-start-lifecycle + 1 modified logging + 1 boot-parent, decomposed into 22 scenarios)
- Scenarios by class: edge 12 · perf 0 · frontend 0 · error 10
- Scenarios by level: L1 22 · L2 0 · L3 0
- Scenarios by disposition: automated 22 · manual-only 0

L2/L3 intentionally empty: every observable here is a decision in
`autoStartServer` / the ephemeral liveness consumer, exercisable in-process via
the `AutoStartDeps` fakes and a faked liveness probe. The manual smoke steps in
tasks.md §6 (real second dashboard, real parent kill) are operator confidence
checks, not automatable observables → they stay manual, not folded.

## New infra needed

- none — extends existing `packages/extension/src/__tests__/server-auto-start*.test.ts`
  (L1 vitest) and adds an ephemeral-liveness unit test in `packages/server`.
