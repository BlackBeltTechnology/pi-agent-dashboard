## 1. Implementation

- [x] 1.1 Revert the working tree's spike in `packages/server/src/auth/provider-auth-storage.ts` (sync `Atomics.wait` retry loop, `sleepSync`) and in `packages/server/src/routes/provider-auth-routes.ts` (the `notifyBridges()` relocation — `origin/develop` already ships the DELETE try/catch) — verify: `git diff` on both files is empty before the async work starts
- [x] 1.2 Convert `withLock` to async: acquire via `proper-lockfile`'s async `lock()` inside our own retry loop that retries ONLY `err.code === "ELOCKED"`, with awaited backoff summing under the 2 s bound; do NOT use the library's `retries` option (its driver retries every truthy error) — verify: E4 + E5 pass
- [x] 1.3 Carry the existing lock options verbatim into the async call — `stale: 10_000` and `realpath: false` (async `lock()` defaults `realpath: true`) — verify: E6 passes
- [x] 1.4 Await the async `release()` in the `finally`, swallowing only its rejection, so a failed unlock cannot raise an unhandled rejection — verify: X3 passes
- [x] 1.5 Make `writeCredential` / `removeCredential` async and await them at every call site: `provider-auth-routes.ts:161,233,251,272` and `model-proxy/internal-auth-storage.ts:198` — verify: `rg` shows no unawaited call; X4 + X5 pass
- [x] 1.6 Replace the dangling `See fix: provider-logout-500` code comment with `See change: fix-provider-auth-lock-contention` — verify: `rg "provider-logout-500"` returns nothing
- [x] 1.7 Update the per-file rows in `packages/server/src/auth/AGENTS.md` and `packages/server/src/routes/AGENTS.md` (async writers, bounded ELOCKED retry, preserved lock options) — verify: rows name the async signature change

## 2. Tests

- [x] 2.1 E1 held-lock-resolves test — add an acquired handshake (worker posts `locked` before the main thread calls) to the contention test; see `packages/server/src/__tests__/provider-auth-storage.test.ts` and `packages/server/src/model-proxy/__tests__/auth-json-contention.test.ts` for the worker/lock harness glue. Triple: worker holds lock, signals `locked`, releases at 300 ms · `await removeCredential("lock-contention-test")` after the handshake · resolves, key absent, elapsed ≥ 300 ms (test-plan #E1)
- [x] 2.2 E2 uncontended nominal write — see `provider-auth-storage.test.ts` roundtrip test. Triple: no lock held · `await writeCredential("e2-provider", api_key)` · resolves < 50 ms, credential readable (test-plan #E2)
- [x] 2.3 E3 just-inside-the-bound release — see the E1 harness. Triple: lock held, released at 1.5 s · `await removeCredential(...)` · resolves, key absent (test-plan #E3)
- [x] 2.4 E4 bound-exhausted rejection — see the E1 harness. Triple: lock held 3 s · `await removeCredential(...)` · rejects with `ELOCKED`-derived error, `auth.json` sha256 unchanged (test-plan #E4)
- [x] 2.5 E5 non-contention error is not retried — see `provider-auth-storage.test.ts` for the HOME-isolated fixture setup. Triple: auth dir chmod `0500` · `await writeCredential(...)` · rejects < 100 ms, error code is not `ELOCKED` (test-plan #E5)
- [x] 2.6 E6 `realpath:false` preserved — see `auth-json-contention.test.ts`. Triple: `AUTH_PATH` via a symlinked home · acquire via symlinked and resolved spellings · second acquisition refused (test-plan #E6)
- [x] 2.7 E7 mode invariants regression — see the existing `0600` placeholder assertions in `provider-auth-storage.test.ts`. Triple: `auth.json` absent · `await writeCredential(...)` · placeholder and file are `0600`, group/world bits clear (test-plan #E7)
- [x] 2.8 P1 health responsiveness under a contended write — see `packages/server/src/__tests__/provider-auth-routes.test.ts` for the fastify-inject server harness. Triple: lock held 1.5 s with a DELETE waiting · 20 sequential `GET /api/health` · p95 < 200 ms, all 200, answered before the DELETE resolves (test-plan #P1)
- [x] 2.9 P2 concurrent writes do not serialize into a stall — see the P1 harness. Triple: lock held 500 ms · 5 concurrent credential writes · all resolve, total wall < 2 s, health p95 < 200 ms (test-plan #P2)
- [x] 2.10 F1 Settings renders the lock reason — see `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx` for the render + mocked-fetch glue. Triple: DELETE mocked 500 `{error:"Lock file is already being held"}` · click Sign Out for Anthropic · lock message rendered, row stays signed-in, generic fallback absent (test-plan #F1)
- [x] 2.11 X1 lock exhaustion surfaces a reason — see `provider-auth-routes.test.ts`. Triple: lock held past the window · `DELETE /api/provider-auth/anthropic` via inject · 500, `body.error` matches `/lock/i`, not the generic body, no credential material (test-plan #X1)
- [x] 2.12 X2 corrupt-refusal delete regression — see the existing corrupt-content tests in `provider-auth-storage.test.ts` plus `provider-auth-routes.test.ts`. Triple: corrupt `auth.json`, quarantine copy fails · DELETE anthropic · 500 with a reason, file untouched, no credential material (test-plan #X2)
- [x] 2.13 X3 async release rejection is contained — see `provider-auth-storage.test.ts`. Triple: lock dir removed under the holder · a write completes and releases · result stands, no unhandled rejection, process survives (test-plan #X3)
- [x] 2.14 X4 OAuth refresh awaits the write — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-refresh.test.ts`. Triple: expiring OAuth credential, lock held 300 ms · `ensureFreshOAuth` refresh · token persisted before headers are returned (test-plan #X4)
- [x] 2.15 X5 device-code completion awaits the write — see `provider-auth-routes.test.ts` device-code coverage. Triple: device-code completes while the lock is briefly held · poller awaits `writeCredential` · credential persisted and status becomes `complete` only after the write resolves (test-plan #X5)

## 3. Validate

- [x] 3.1 Manual end-to-end Sign Out against a real contending pi session — click Sign Out during Anthropic token-refresh churn; expect success or a comprehensible lock message, no hang and no generic 500 (test-plan: manual-only, #F2)
- [x] 3.2 Confirm no surfaced `error` string can carry credential material on either failure path — verify: X1 + X2 assertions cover the body, and the log line is inspected once by hand
- [x] 3.3 `npm test` green (pre-existing failures unchanged: knip/lint-harness on a dirty tree, docker-dependent port derivation, `resolveRemoteBase`, faux-session integration, the `expires in 2d` time-of-day flake) and `npm run quality:changed` clean
- [x] 3.4 `openspec validate fix-provider-auth-lock-contention --strict` passes
