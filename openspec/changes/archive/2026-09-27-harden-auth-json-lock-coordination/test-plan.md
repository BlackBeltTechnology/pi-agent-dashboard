# Test Plan — harden-auth-json-lock-coordination

Stage: design   Generated: 2026-09-27

Hard gate passed with no open clarifications. Every threshold is concrete in the spec/design:
- `stale` 30 s
- interactive lock window 2 s
- refresh-path lock window `REFRESH_LOCK_BUDGET_MS` 20 s
- refresh buffer 30 s
- responsiveness p95 < 200 ms (inherited from the existing lock requirement)

Tests of the 20 s window shorten it through a test override so that wall-clock time stays small. The override is an implementation seam, not a spec value.

pi-side lock holders are simulated in-process or in a worker with proper-lockfile and pi's literal options `{ stale: 30_000, realpath: false }`. Ageing a lockfile means `fs.utimesSync` on `auth.json.lock`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | provider-auth-server: stale threshold defined once, pinned | decision-table | L1 | automated | exported `LOCK_OPTIONS` | read the constant | `LOCK_OPTIONS.stale >= 30_000` and `LOCK_OPTIONS.realpath === false` |
| E2 | provider-auth-server: lock with young mtime not stolen | BVA (inside old theft band) | L1 | automated | holder owns `auth.json.lock`, mtime aged to 12 s | `await writeCredential("e2", api_key)` | rejects `ELOCKED` after ≈2 s; `auth.json.lock` still exists with the holder's mtime; `auth.json` sha256 unchanged |
| E3 | provider-auth-server: lock just below stale not stolen | BVA (max−1) | L1 | automated | holder lockfile mtime aged to 29 s | `await writeCredential("e3", api_key)` | rejects `ELOCKED`; lockfile untouched |
| E4 | provider-auth-server: orphaned lock reclaimed | BVA (max+1) | L1 | automated | orphan `auth.json.lock` (no live holder), mtime aged to 31 s | `await writeCredential("e4", api_key)` | resolves; credential readable via `readAuthJson()` |
| E5 | provider-auth-server: interactive window unchanged at 2 s | BVA (regression) | L1 | automated | live holder keeps lock for 5 s | `await removeCredential(...)` | rejects after 1.9–2.5 s (not ~20 s); `auth.json` sha256 unchanged |
| E6 | provider-auth-server: lock helper type rejects async callbacks | decision-table (compile-time) | L1 | automated | type-test file calling `withLock(async () => 1)` under `// @ts-expect-error`, and `withLock(() => 1)` without it | `tsc --noEmit` over the type-test | typecheck passes (the expect-error is consumed = async rejected; sync accepted) |
| E7 | model-proxy: fresher on-disk credential adopted | state-transition | L1 | automated | in-memory cred `expires = now+10 s`; disk cred for same provider `expires = now+1 h`, different access | `getApiKeyAndHeaders(model)` | returns the disk access token; provider `refreshToken` mock called 0 times |
| E8 | model-proxy: waiting out a concurrent pi refresh | state-transition | L1 | automated | holder takes lock, after 3 s writes a fresh cred for the provider and releases (> 2 s interactive window, < refresh window) | `getApiKeyAndHeaders(model)` issued after holder signals `locked` | resolves with holder's access token; elapsed ≥ 3 s; `refreshToken` called 0 times |
| E9 | model-proxy: refresh spends on-disk refresh token | EP | L1 | automated | in-memory cred refresh `r-old`; disk cred refresh `r-new`, expired | `getApiKeyAndHeaders(model)` | `refreshToken` invoked with credentials whose refresh is `r-new` |
| E10 | model-proxy: CAS writes when unchanged | decision-table (outcome=written) | L1 | automated | disk cred equal to snapshot throughout; refresh returns access `a2` | refresh completes | `auth.json` holds access `a2`; request uses `a2` |
| E11 | model-proxy: changed fresh credential not overwritten | decision-table (outcome=changed, fresh) | L1 | automated | during a pending refresh, test writes a different oauth cred (access `pi-a`, `expires = now+1 h`) | resolve the refresh with access `dash-a` | `auth.json` sha256 equals the post-test-write hash; request uses `pi-a`; `dash-a` absent from file |
| E12 | model-proxy: non-token field change not overwritten | decision-table (deep equality) | L1 | automated | during pending refresh, only `enterpriseUrl` changes on disk (tokens identical) | resolve the refresh | stored `enterpriseUrl` is the changed value; refreshed access NOT written |
| E13 | model-proxy: changed but expired fails diagnosably | decision-table (outcome=changed, stale) | L1 | automated | during pending refresh, disk cred replaced with different oauth cred `expires = now+5 s` | resolve the refresh | rejects with message matching `/changed during refresh/`; file byte-identical to the replaced state |
| E14 | model-proxy: removed during refresh not resurrected | decision-table (outcome=removed) | L1 | automated | during pending refresh, `removeCredential(provider)` completes | resolve the refresh | `readAuthJson()[provider]` undefined; rejects `/removed/` |
| E15 | model-proxy: replaced by api key | decision-table (outcome=replaced) | L1 | automated | during pending refresh, provider key becomes `{type:"api_key",key:"sk-x"}` | resolve the refresh | stored api_key unchanged; rejects `/replaced/`; returned apiKey never equals `sk-x` |
| E16 | model-proxy: absent auth.json not created | EP (absent partition) | L1 | automated | `auth.json` deleted; in-memory cred expired | `getApiKeyAndHeaders(model)` | rejects `/removed/`; `fs.existsSync(auth.json) === false` afterwards; no `auth.json.lock` left behind |
| E17 | model-proxy: file removed mid-refresh not recreated by CAS | state-transition | L1 | automated | during pending refresh, `auth.json` unlinked | resolve the refresh | `auth.json` still absent; rejects `/removed/` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | provider-auth-server + model-proxy: refresh-path lock wait is non-blocking | tail-latency | L1 | automated | holder keeps lock 3 s while `getApiKeyAndHeaders` waits on the locked snapshot; 20 `setTimeout(0)` probes spaced 100 ms | probe scheduling delay p95 < 200 ms; all probes fire before the request resolves | duration of the 3 s wait |
| P2 | model-proxy: network refresh does not hold the lock | tail-latency | L1 | automated | refresh mock left pending (never resolved during the test) | `await writeCredential("other", api_key)` completes in < 100 ms while refresh is in flight | single write during pending refresh |
| P3 | model-proxy: concurrent requests share one coordinated refresh | soak (concurrency) | L1 | automated | 5 concurrent `getApiKeyAndHeaders` for one expired provider | `refreshToken` called exactly once; all 5 resolve with the same access token | 5-request burst |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | model-proxy: live coordination with a real pi session | exploratory | — | manual-only | running dashboard proxy + an active pi session on Anthropic OAuth, token near expiry | drive proxy requests across pi's refresh | [judgment: no `invalid_grant`, pi session keeps working, no forced re-login on either side; `server.log` shows adopt/written outcomes and no ECOMPROMISED crash] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | provider-auth-server: compromise before write fails the write | fault-injection (abort) | L1 | automated | `vi.spyOn(lockfile, "lock")` wrapper invokes captured `onCompromised(ECOMPROMISED)` before resolving | `await writeCredential("x1", api_key)` | rejects with `code === "ECOMPROMISED"`; `auth.json` sha256 unchanged; one log line containing `ECOMPROMISED` and no credential string |
| X2 | provider-auth-server: compromise after release does not crash | fault-injection (timer) | L1 | automated | spy invokes captured `onCompromised` from a `setTimeout` after the write released | write completes, then timer fires | no `uncaughtException` / `unhandledRejection` sentinel hit; written credential stays in `auth.json` |
| X3 | model-proxy: corrupt at snapshot declines the refresh | fault-injection (corrupt) | L1 | automated | `auth.json` = `{"trunc` ; in-memory cred expired | `getApiKeyAndHeaders(model)` | rejects with corrupt-content error (not `/removed/`); `refreshToken` 0 calls; a quarantine copy exists; `auth.json` bytes not rewritten by the refresh |
| X4 | model-proxy: corrupt at persist not written over | fault-injection (corrupt) | L1 | automated | during pending refresh, `auth.json` overwritten with `{"trunc` | resolve the refresh | rejects with corrupt-content error; file content is still `{"trunc` (or its quarantine copy exists) — refreshed cred absent |
| X5 | model-proxy: persist blocked past the refresh window | fault-injection (hold) | L1 | automated | refresh window shortened to 500 ms via test override; holder takes lock after refresh starts and keeps it 2 s | resolve the refresh | rejects with lock-contention (`ELOCKED`-derived) error; `auth.json` unchanged; minted access token not returned |
| X6 | model-proxy: failed refresh recovers from a concurrently stored cred | fault-injection (abort) + state | L1 | automated | `refreshToken` rejects `invalid_grant`; before rejection test writes a fresh oauth cred | refresh rejects | request resolves with the stored access token |
| X7 | model-proxy (MODIFIED): failed refresh with unchanged disk surfaces | fault-injection (abort) | L1 | automated | `refreshToken` rejects `invalid_grant`; disk unchanged | refresh rejects | rejects with the original refresh error; `auth.json` sha256 unchanged |
| X8 | model-proxy: failed refresh explained by concurrent removal | fault-injection (abort) + state | L1 | automated | `refreshToken` rejects; before rejection `removeCredential(provider)` completes | refresh rejects | rejects `/removed/` (not the provider error); provider absent from `auth.json` |
| X9 | model-proxy: no credential material in coordination errors | decision-table (all outcomes) | L1 | automated | outcomes changed-expired, removed, replaced, corrupt, lock-contention with sentinel tokens `SENTINEL-ACCESS` / `SENTINEL-REFRESH` / `sk-SENTINEL` | trigger each outcome | no error message or captured log line contains any sentinel string |
| X10 | model-proxy (MODIFIED): aborted refresh still persists nothing | fault-injection (abort, regression) | L1 | automated | refresh ignores signal; `refreshTimeoutMs` 50 ms | abort fires | rejects `/aborted/`; `writeRefreshedOAuth` not called; `auth.json` unchanged |

---

## Coverage summary

- Requirements covered: 3/3. provider-auth-server "auth.json atomic write with locking" (MODIFIED); model-proxy-credential-routing "OAuth token refresh SHALL propagate a concrete abort signal" (MODIFIED); "OAuth refresh SHALL coordinate with other auth.json writers" (ADDED). All new scenarios are exercised. Pre-existing scenarios stay covered by the existing suites (`provider-auth-lock-contention`, `provider-auth-storage`, `internal-auth-storage-refresh`).
- Scenarios by class: edge 17 · perf 3 · frontend 1 · error 10
- Scenarios by level: L1 30 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 30 · manual-only 1

## New infra needed

- none. Every automated row lands in the existing vitest tier (`packages/server/src/__tests__/`, `packages/server/src/model-proxy/__tests__/`), reusing the worker/lock holder glue. E6 needs a type-test file compiled by the existing `tsc --noEmit` typecheck. That is a new file, not a new harness.
