## Why

`fix-provider-auth-lock-contention` made the dashboard's `auth.json` lock async and bounded, and it explicitly deferred two issues. Checking them against pi 0.86.1 (`dist/core/auth-storage.js`) and proper-lockfile 4.1.2 turned up a third, more serious one. The dashboard and pi share one `auth.json`, but they still disagree about how the lock and OAuth refresh work:

1. **Lock theft (stale mismatch).** The dashboard locks with `stale: 10_000`. pi's async `withLockAsync` locks with `stale: 30_000` and holds the lock for the whole OAuth network refresh, so proper-lockfile refreshes that lock's mtime only every `stale/2` = 15 s. proper-lockfile decides a lock is stale using the *acquirer's* `stale` compared with the lockfile's mtime (`isLockStale`). So any dashboard acquisition that lands while a pi refresh has been in progress for 10–15 s removes pi's live lock and takes it. Mutual exclusion silently breaks exactly when a refresh is slow.
2. **Crash on compromise (deferred item).** `onCompromised` is not configured. proper-lockfile's default handler is `(err) => { throw err; }`, and it runs inside the lock's update timer. A compromised lock therefore raises an uncaught exception and takes the server down, instead of failing one write.
3. **OAuth refresh race (deferred item).** `InternalAuthStorage` refreshes from a snapshot of `auth.json` that it caches until the next registry refresh, and it persists the result without checking what is on disk now. pi re-reads under the lock before it refreshes. With rotating refresh tokens, the dashboard can spend a token pi has already rotated out (`invalid_grant` → a proxy request fails even though a valid token is sitting on disk). It can also write its result over a newer token that pi just stored.

## What Changes

- **Align `stale` with pi's refresh lock:** `LOCK_OPTIONS.stale` goes from `10_000` to `30_000`, which equals pi 0.86.1's async lock. `LOCK_OPTIONS` is exported so tests share it instead of hand-copying it. The dashboard will no longer treat as stale a lock pi legitimately holds during a network refresh. `realpath: false` stays as it is.
- **Contain lock compromise:** pass an `onCompromised` handler that records the failure and logs only its code, never throwing. A locked operation that observes the compromise before it writes fails with `ECOMPROMISED` and leaves `auth.json` untouched. The process never crashes because of a compromised lock. `withLock`'s callback narrows to synchronous, so "the lock is held only across a synchronous read-modify-write" is enforced by its type.
- **Longer, still non-blocking lock wait for the refresh path only:** the locked snapshot read and the CAS persist wait up to 20 s, which is longer than pi's 15 s refresh hold and shorter than `stale`. That way a proxy request waits out a concurrent pi refresh and adopts its result. Interactive writes keep the 2 s window.
- **Coordinated OAuth refresh (compare-and-swap, no lock during network I/O)** in `InternalAuthStorage`:
  - When a cached OAuth credential needs a refresh, first read `auth.json` **under the lock**. pi writes in place, so an unlocked read can be torn. If the on-disk credential for that provider is already fresh, adopt it and skip the refresh.
  - Otherwise refresh using the on-disk credential, so the latest refresh token is the one spent.
  - Persist with a new compare-and-swap writer in `provider-auth-storage.ts`. Under the lock it re-reads and writes only if the stored credential is **equal in every field** to the snapshot. If another writer changed it, a fresh stored credential wins and is used. A changed-but-expired, removed, replaced (non-OAuth) or unreadable credential fails the request with a distinct message, and nothing is written or resurrected.
  - If a refresh fails, take one more locked read. If another writer stored a fresh credential in the meantime, adopt it instead of failing the request.
- **Accepted residual:** because the lock is not held during network I/O, the dashboard and pi can still both spend the same refresh token at the same moment. CAS keeps the file consistent (disk wins). Whichever side's token the provider invalidated recovers by re-reading on its next failure.

## Capabilities

### New Capabilities

### Modified Capabilities

- `provider-auth-server`: "auth.json atomic write with locking" gains a staleness threshold aligned with pi's refresh lock, plus a no-crash, fail-the-write rule for lock compromise.
- `model-proxy-credential-routing`: a new requirement makes the internal OAuth refresh coordinate with other `auth.json` writers (locked re-read before refresh, compare-and-swap persist, no resurrection, adopt-on-failure). "OAuth token refresh SHALL propagate a concrete abort signal" is MODIFIED so its "failure is surfaced" rule carves out the adopt-on-failure case.

## Impact

- Affected code: `packages/server/src/auth/provider-auth-storage.ts` (`LOCK_OPTIONS`, `acquireAuthLock`/`withLock` compromise handling, new CAS writer export), `packages/server/src/model-proxy/internal-auth-storage.ts` (`ensureFreshOAuth` / `refreshOAuth`), their tests under `packages/server/src/__tests__/` and `packages/server/src/model-proxy/__tests__/`, and the per-file `AGENTS.md` rows.
- No protocol, config, route, or on-disk format change. `auth.json` and `auth.json.lock` keep their layout.
- Compatibility: pi's sync `lockSync` path still uses its default `stale: 10_000`. That is pi's own inconsistency, and it only matters if pi's sync path meets a dashboard lock held for more than 10 s. The dashboard holds the lock only for a synchronous read-modify-write lasting milliseconds, so this cannot happen.
- Rollback: straight revert. Mixed versions stay safe because the lockfile contract (path, `realpath: false`) does not change. Only the staleness threshold and the refresh sequencing change.
- Trade-off: a lock orphaned by a crashed holder now blocks dashboard credential writes for up to ~30 s instead of ~10 s. Each blocked write fails with the lock-contention message from `fix-provider-auth-lock-contention` rather than hanging. pi already lives with the same 30 s.

## Discipline Skills

- `security-hardening`: the change touches credential storage and rotation. Adopted or refused credentials must never be logged, and error strings must stay free of token material.
- `doubt-driven-review`: the CAS winner rule (disk wins) and the stale re-alignment are hard to undo once a user's refresh token has been rotated. Both are reviewed before they stand.
- `systematic-debugging`: the lock-theft finding comes from reading proper-lockfile's `isLockStale`/`updateLock` and pi's `acquireLockAsync`, not from a reproduction. The tests must reproduce the mechanism before the fix is trusted.
