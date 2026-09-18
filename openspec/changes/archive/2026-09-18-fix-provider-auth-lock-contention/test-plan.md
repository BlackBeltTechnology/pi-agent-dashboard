# Test Plan — fix-provider-auth-lock-contention

Stage: proposal   Generated: 2026-09-18

Gate answered before writing (no open clarifications): lock-exhaustion bodies pass the underlying lock error's own message through (assert `/lock/i`, never `Internal Server Error`); responsiveness is measured as `GET /api/health` p95 < 200 ms while a contended write waits.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | atomic write with locking — held lock resolves in window | state-transition | L1 | automated | `auth.json` holding `lock-contention-test`; a worker thread acquires the lock and signals `locked`, releasing at 300 ms | `await removeCredential("lock-contention-test")` issued only after the `locked` handshake | promise resolves; key absent from `auth.json`; elapsed ≥ 300 ms (proves a retry actually ran, not a first-attempt win) |
| E2 | atomic write with locking — uncontended nominal | EP (valid partition) | L1 | automated | `auth.json` present, no lock held | `await writeCredential("e2-provider", {type:"api_key",key:"sk-test-000000000"})` | resolves in < 50 ms; credential readable via `readAuthJson()`; no backoff delay observed |
| E3 | atomic write with locking — just inside the bound | BVA (below max) | L1 | automated | worker holds the lock, releases at 1.5 s | `await removeCredential(...)` during the hold | resolves successfully; `auth.json` no longer contains the key |
| E4 | atomic write with locking — bound exhausted | BVA (above max) | L1 | automated | worker holds the lock for 3 s (> 2 s window) | `await removeCredential(...)` during the hold | promise rejects with an `ELOCKED`-derived error; `auth.json` bytes identical to before (sha256 unchanged) |
| E5 | non-contention lock errors are not retried | fault-injection (permission) | L1 | automated | auth dir chmod `0500` so lock creation fails `EACCES`/`EPERM` | `await writeCredential(...)` | rejects in < 100 ms (no retry window consumed); error code is not `ELOCKED` |
| E6 | lock options preserved across the sync→async switch | decision-table | L1 | automated | `AUTH_PATH` reached through a symlinked home dir | two acquisitions spelled via the symlinked and the resolved path | the second is refused (same lockfile, `realpath:false` preserved) — mutual exclusion holds |
| E7 | mode invariants survive the migration | BVA (regression) | L1 | automated | `auth.json` absent, so the lock helper pre-creates the placeholder | `await writeCredential(...)` | placeholder and resulting `auth.json` are mode `0600`; group/world bits clear |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | waiting for the lock leaves the server responsive | tail-latency | L1 | automated | worker holds the lock 1.5 s while one `DELETE /api/provider-auth/:provider` waits; 20 sequential `GET /api/health` issued during the wait | health p95 < 200 ms, all 200 OK, answered before the DELETE resolves | duration of the contended write |
| P2 | bounded wait does not serialize into a stall | soak (concurrency) | L1 | automated | 5 concurrent credential writes while the lock is held 500 ms | all 5 resolve; total wall < 2 s; health p95 < 200 ms throughout | 5-write burst |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | removal reports a refusal to the client | state-transition | L1 | automated | `ProviderAuthSection` rendered; DELETE mocked to return 500 `{error:"Lock file is already being held"}` | user clicks Sign Out for Anthropic | the lock message is rendered to the user; the row stays in its signed-in state; the generic fallback string is not shown |
| F2 | end-to-end Sign Out against a real contending pi session | exploratory | — | manual-only | live dashboard + a running pi session refreshing its Anthropic token | operator clicks Sign Out repeatedly during refresh churn | [judgment: sign-out succeeds or shows a comprehensible lock message; no hang, no generic 500] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | lock-contention exhaustion surfaces a reason | fault-injection (hold) | L1 | automated | lock held past the window by another process | `DELETE /api/provider-auth/anthropic` via fastify inject | 500; `body.error` matches `/lock/i`; body is not the generic `Internal Server Error`; body contains no credential material |
| X2 | refused delete surfaces a reason (regression) | fault-injection (corrupt) | L1 | automated | `auth.json` corrupt and quarantine copy fails | `DELETE /api/provider-auth/anthropic` | 500 with an `error` string naming the backup failure; `auth.json` untouched; no credential material in the body |
| X3 | async release failure does not crash the process | fault-injection (abort) | L1 | automated | lock directory removed underneath the holder so `release()` rejects (`ENOTACQUIRED`) | a credential write completes and releases | the write's result stands; no unhandled rejection is raised; process survives the tick |
| X4 | async ripple — OAuth refresh persists under contention | state-transition | L1 | automated | expiring OAuth credential; lock held 300 ms by another holder | `ensureFreshOAuth` refreshes and awaits `writeCredential` | refreshed token is present in `auth.json` before the caller receives headers (no fire-and-forget write) |
| X5 | async ripple — device-code completion persists | state-transition | L1 | automated | device-code flow completing while the lock is briefly held | poller awaits `writeCredential` | credential persisted and flow status becomes `complete` only after the write resolves |

---

## Coverage summary

- Requirements covered: 2/2 (both MODIFIED requirements, all 9 restated scenarios exercised)
- Scenarios by class: edge 7 · perf 2 · frontend 2 · error 5
- Scenarios by level: L1 15 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 15 · manual-only 1

## New infra needed

- none — every automated row lands in the existing vitest tier (`packages/server/src/__tests__/`, `packages/client/src/__tests__/`). No L2/L3 harness is implicated: the behavior is server-internal and the client assertion is a mocked-fetch render, not a rendered-UI flow through the docker harness.
