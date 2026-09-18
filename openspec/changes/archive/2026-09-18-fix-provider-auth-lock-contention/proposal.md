## Why

Sign Out in Settings → Provider auth returned Fastify's generic `{"error":"Internal Server Error"}`. On the shipped baseline (`origin/develop` = `HEAD`), `removeCredential` → `withLock` → `proper-lockfile.lockSync` is called with **no retry**, so a lock freshly held by a running pi session (OAuth token refresh writes the same `~/.pi/agent/auth.json`) throws `LockError` (`ELOCKED`) on first collision. The capability requires the opposite — "auth.json atomic write with locking" mandates lockfile **retry logic**, and its "Concurrent write protection" scenario says the loser retries and completes — but no shipped implementation ever provided it.

An uncommitted working-tree spike already added a synchronous retry loop (`Atomics.wait` backoff, ≤~1.55 s). It satisfies the retry contract but blocks the Fastify event loop for the whole wait, serialized across queued writes — unacceptable on a shared server path. This change supersedes that spike with a non-blocking wait.

## What Changes

- Move the `auth.json` lock helper from `proper-lockfile`'s **sync** API to its **async** `lock()`, retried by our own `ELOCKED`-filtered loop with awaited (non-blocking) backoff. The library's built-in `retries` option is deliberately NOT used: its retry driver re-runs on *any* truthy error, so an `EACCES`/`EPERM` would silently consume the window, violating the "non-contention errors are not retried" requirement. Async acquisition is what removes the event-loop block. All existing write call sites (`provider-auth-routes.ts:161,233,251,272`, `model-proxy/internal-auth-storage.ts:198`) are already async, so `writeCredential` / `removeCredential` become async and their awaits ripple only into async functions. **BREAKING** for any future sync consumer of those two exports.
- Bound the retry window (worst case ≤ 2 s) and retry only lock-held (`ELOCKED`) failures; every other lock or I/O error propagates immediately and unretried.
- Make lock-contention exhaustion visible: `DELETE /api/provider-auth/:provider` (and `PUT .../api-key`) report it through the existing `{ error }` body instead of the framework's generic fallback. The existing removal-refusal requirement is broadened from "write refusal" to any write failure, lock contention included.
- Preserve the existing lock options verbatim when switching APIs — `stale: 10_000` and especially `realpath: false`. Async `lock()` defaults `realpath: true`; resolving symlinks would have the dashboard and pi lock *different* lockfiles on symlinked homes (docker volumes, network mounts), silently breaking mutual exclusion.
- Handle the async release: `release()` returns a promise, so the existing `finally { try { release(); } catch {} }` cannot catch an `unlock` failure (`ENOTACQUIRED`, `EACCES`) — an unhandled rejection would crash the process.
- Read paths are unaffected: `readAuthJson` takes no lock, so `registry-singleton.ts:76`, `internal-auth-storage.ts:106` and `server.ts:2721` stay synchronous.
- Revert the working tree's redundant edit to `provider-auth-routes.ts`: `origin/develop` already ships the DELETE try/catch (change `fix-corrupt-auth-json-500`); the local diff only relocates `notifyBridges()` inside the `try`, which is unrelated churn.

## Capabilities

### New Capabilities

### Modified Capabilities

- `provider-auth-server`: two existing requirements change. "auth.json atomic write with locking" gains a bounded, non-blocking retry contract with defined exhaustion behavior. "Credential removal reports a refusal to the client" broadens from corrupt-content refusals to any write failure, including lock-contention exhaustion.

## Impact

- Affected specs: `provider-auth-server` (2 MODIFIED requirements)
- Affected code: `packages/server/src/auth/provider-auth-storage.ts` (`withLock`, `writeCredential`, `removeCredential` → async), `packages/server/src/routes/provider-auth-routes.ts` (await the writers; revert local churn), `packages/server/src/model-proxy/internal-auth-storage.ts` (await `writeCredential` in `ensureFreshOAuth`), `packages/server/src/__tests__/provider-auth-storage.test.ts`
- Compatibility / rollback: no protocol, config, or on-disk format change — `auth.json`, its lockfile and the quarantine behavior are untouched. Rollback is a straight revert; a mixed-version state is safe because the lock file contract is unchanged.
- Accepted trade-off: the retry window (≤ 2 s) is shorter than `proper-lockfile`'s `stale: 10_000` threshold. Reclamation is lazy — the next acquisition older than `stale` takes the lock over — so a lock orphaned by a crashed holder keeps failing writes for up to ~10 s, after which a subsequent attempt takes it over cleanly. Widening the window to cover staleness would make a live stuck holder hang every credential request instead, which is worse; the failure now at least names its reason.
- Out of scope (pre-existing, not regressed by this change): `onCompromised` is unconfigured, so proper-lockfile's default handler throws inside a timer if the lock is compromised. It is the same on the sync path today; fixing it is a separate change rather than a silent rider on this one.
- Also out of scope: async acquisition slightly widens the existing read→merge window in `ensureFreshOAuth` (`internal-auth-storage.ts:106` → `:198`). The pattern and its clobber risk pre-date this change; it is recorded here so the next reader sees it was considered, not missed.

## Discipline Skills

- `security-hardening`: the change widens what reaches the client on the credential-storage path; error strings must stay free of credential material.
- `performance-optimization`: the current implementation blocks the event loop; this change's whole point is a latency/blocking budget on a shared server path, and the async migration must be verified to not reintroduce it.
- `systematic-debugging`: the root cause was established from the running instance (log + live probes + red test) rather than guessed; the same evidence path applies if contention resurfaces.
