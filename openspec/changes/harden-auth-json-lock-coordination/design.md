## Context

- `provider-auth-storage.ts` is the dashboard's only `auth.json` writer. `withLock` → `acquireAuthLock` → `proper-lockfile.lock(AUTH_PATH, { stale: 10_000, realpath: false })` with a 2 s retry loop that retries only `ELOCKED` (from change `fix-provider-auth-lock-contention`). Every current locked callback is a synchronous read-modify-write, so the dashboard holds the lock for milliseconds. `withLock`'s type (`fn: () => T | Promise<T>`) does not enforce this.
- pi 0.86.1 (`@earendil-works/pi-ai/dist/auth/resolve.js` `resolveStoredOAuth`) → `credentials.modify` → `auth-storage.js` `withLockAsync` → `lockfile.lock(path, { realpath: false, retries: 0, stale: 30_000, onCompromised })`.
  - It **awaits the provider refresh while holding the lock**. The refresh gets a 15 s abort *signal* (`DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15_000`) but no race, so a provider that ignores the signal keeps pi's lock (with a fresh mtime) for longer. 15 s is pi's well-behaved hold, not a hard bound.
  - It re-checks expiry under the lock with `DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 5 min`, and it re-checks compromise before and after its write.
  - pi writes `auth.json` **in place** (`writeFileSync(this.authPath, …)`), not tmp+rename. A reader that does not take the lock can see a torn file.
- proper-lockfile 4.1.2:
  - `isLockStale` compares the **acquirer's** `stale` with the lockfile mtime.
  - The holder's mtime refresh interval is `update = max(min(update ?? stale/2, stale/2), 1000)`, so pi refreshes mtime every 15 s.
  - The default `onCompromised` is `(err) => { throw err; }`, called from the `updateLock` `setTimeout`/fs callbacks.
  - Compromise is detected only asynchronously by that timer. A millisecond-long synchronous hold never observes it.
- `InternalAuthStorage` holds `cachedAuth` until `reload()` (called only by `InternalRegistry.refresh()`) or until its own successful refresh. `ensureFreshOAuth` refreshes when `expires <= now + REFRESH_BUFFER_MS` (30 s), dedupes per provider in process (`refreshLocks`), then runs `refreshOAuth(provider, cachedCred)` followed by `await writeCredential(...)`.
- Test harnesses mirror the lock options by hand: `__tests__/provider-auth-lock-contention.test.ts` `HOLD_OPTIONS = { stale: 10_000, realpath: false }`. `model-proxy/__tests__/internal-auth-storage-refresh.test.ts` mocks `provider-auth-storage.js` as `{ readAuthJson, writeCredential }` only.

## Goals / Non-Goals

**Goals:**
- The dashboard never treats as stale a lock whose holder is still refreshing its mtime within pi's threshold.
- A compromised lock never crashes the server. A locked operation that observes the compromise fails without touching `auth.json`.
- The internal OAuth refresh:
  - reads its starting point consistently, under the lock;
  - defers to a fresher credential that pi or another writer stored;
  - never overwrites a credential that changed in any field after the snapshot;
  - never resurrects a removed credential, and never turns a type change into a usable OAuth token.

**Non-Goals:**
- Holding the `auth.json` lock across the dashboard's own network refresh. The operator rejected this explicitly (D3).
- Making the general `getAuth()` cache track disk for api-key reads.
- Changing pi's own sync-path `stale` default, or pi's non-atomic write.
- Cross-process dedupe that stops the dashboard and pi from both calling the provider at the same instant (accepted residual).

## Decisions

### D1 — `stale: 30_000`, exported as the single source
A staleness threshold has to be at least the longest legitimate interval between mtime refreshes by *any* process sharing the lock. pi refreshes every 15 s while it holds the lock across a refresh of up to 15 s. Any dashboard threshold at or below 15 s can steal the lock. Matching pi's 30 s gives one shared rule and a 2× margin.
- `LOCK_OPTIONS` becomes an exported constant, with a comment naming pi's `acquireLockAsync` as the coupling. A dedicated test pins `LOCK_OPTIONS.stale >= 30_000` directly.
- The contention test's hostile holder stays **independent**. It simulates pi, so it uses pi's literal options (`{ stale: 30_000, realpath: false }`) and does not import `LOCK_OPTIONS`. If it imported the value under test, a regression would move the holder and the writer together and nothing would catch it.
- Limitation, stated in the spec: liveness is judged only from the mtime. If a holder's event loop stalls for more than 30 s, its lock can still be taken over. The same is true for pi.
- *Alternative:* 16–20 s. Rejected: it adds a second, divergent constant that silently breaks if pi retunes.

### D2 — Compromise is contained, never thrown from a timer
- `withLock`'s callback type narrows to **synchronous**. A plain `fn: () => T` is not enough, because TypeScript would infer `T = Promise<X>` from an async callback. The signature therefore rejects promise results explicitly: `withLock<T>(fn: () => T & NotPromise<T>)`, where `type NotPromise<T> = T extends PromiseLike<unknown> ? never : unknown`. A `// @ts-expect-error` type test proves that `withLock(async () => …)` fails to compile. This makes "the lock is held only across a synchronous read-modify-write" a compile-time invariant instead of a comment. Every current callback already meets it.
- Each acquisition gets its own `{ compromised?: Error }` cell. `onCompromised` records the error and logs one line that carries only `err.code`. It never throws.
- `withLock` checks the cell after acquiring, before running `fn`. If it is set, it throws the recorded error (`code: "ECOMPROMISED"`) and does not call `fn`. After `fn`, a second check (mirroring pi) is purely diagnostic.
- Honest scope: because compromise is detected only by the 15 s update timer, a millisecond synchronous hold essentially never observes it. **The load-bearing guarantee is "no crash"**, meaning a compromise reported during or after the hold no longer throws inside a timer. The pre-write check is defense in depth for a compromise reported between acquisition and `fn`.
- **Test seam:** `_lockfile` is the CommonJS `proper-lockfile` module object from `createRequire`, and the tests' `require("proper-lockfile")` returns the same object. A `vi.spyOn(lockfile, "lock")` wrapper calls the real `lock`, captures `options.onCompromised`, and invokes it:
  - (a) before resolving, which covers the pre-write case;
  - (b) from a `setTimeout` after release, which covers the post-release, no-crash case, asserted with a `process.on("uncaughtException"/"unhandledRejection")` sentinel.
- `release()` after a compromise rejects `ERELEASED`. The existing `try { await release() } catch {}` absorbs that.

### D3 — Compare-and-swap refresh; the dashboard never holds the lock across its own network I/O
The operator chose CAS over pi's hold-the-lock model. Holding the lock across a refresh would make every concurrent dashboard credential write (Sign Out, api-key save) run out of its 2 s budget.

Sequence in `refreshOAuth` (in-process `refreshLocks` dedupe is unchanged). `fresh(c)` means `c.type === "oauth" && c.expires > now + REFRESH_BUFFER_MS`. This is the same predicate that decides a refresh is needed, so the adopt and refresh decisions cannot disagree.
1. **Locked snapshot.** `snapshot = await readCredentialLocked(provider)` is a new export: the lock held for milliseconds around `readAuthJsonChecked()`. Reading under the lock avoids pi's torn in-place writes. It returns a discriminated outcome and **never throws on content**. The read-tolerance rule of "auth.json corrupt-content recovery" stays intact: corrupt bytes are quarantined exactly as today, and it is the *refresh* that declines to proceed.
   - `auth.json` absent (checked **inside** the lock) → `removed`. The refresh fails with "credential removed".
   - corrupt (unparseable) content → `corrupt`. The refresh fails with the corrupt-content error, a distinct message, and nothing is refreshed. I/O failures such as `EACCES` keep propagating as they do today, as their own errors.
   - provider key missing → `removed`. Not `oauth` → `replaced`, and the refresh fails with "credential replaced by a non-OAuth credential".
   - `fresh(snapshot)` → adopt: set `cachedAuth = null` and return it. No network call.
2. Refresh using `snapshot`, not the cached cred. The existing abort/deadline/no-access-token guards are unchanged. The lock is **not** held.
3. **CAS persist.** `writeRefreshedOAuth(provider, next, snapshot)` is a new export. Under `withLock(…, { budgetMs: REFRESH_LOCK_BUDGET_MS, createIfMissing: false })` it runs `readAuthJsonChecked()`, then:
   - `auth.json` absent → no write; `{ outcome: "removed" }`. There is no placeholder create.
   - corrupt (unparseable) → throw the corrupt-content error. It never writes over corrupt content, including quarantined content.
   - stored is missing → no write; return `{ outcome: "removed" }`.
   - stored `type !== "oauth"` → no write; return `{ outcome: "replaced" }`. A type change is never adopted as an OAuth token and never raised as `CredentialTypeConflictError`. It is a coordination outcome, not a caller mistake.
   - `canonicalEqual(stored, snapshot)` (deep equality over **every** field, including opaque fields such as `enterpriseUrl` and `expires`) → write `next`; return `{ outcome: "written", credential: next }`.
   - otherwise → no write; return `{ outcome: "changed", credential: stored }`.
4. Caller mapping:
   - `written` → use `next`.
   - `changed` → use `stored` if `fresh(stored)`. Otherwise fail with "credential changed during refresh"; the next request refreshes from the new disk state.
   - `removed` / `replaced` → fail with the matching message.
5. **Refresh rejects** → take one more locked snapshot.
   - It differs from the step-1 snapshot and is `fresh` → adopt it.
   - It throws removed / replaced / corrupt → surface **that** outcome error. It is more actionable than the provider's rejection, which it explains.
   - Otherwise (unchanged, or changed but not fresh) → rethrow the original refresh error, leaving `auth.json` intact.
   - Lock-budget exhaustion on this re-read → rethrow the original refresh error. The re-read is best-effort recovery.
6. `cachedAuth = null` on every exit path that adopted or wrote a credential.
7. **Lock-budget exhaustion** at step 1 or step 3 fails the request with the existing lock-contention error and writes nothing. If step 3 exhausts after a successful network refresh, the minted credential is discarded, not used unpersisted. If the provider rotates tokens, the refresh token on disk is already dead either way, so discarding does not protect pi. The reason for discarding is different: a hold past 20 s exceeds pi's 15 s refresh timeout signal, so the holder is orphaned, or wedged on a provider that ignores its abort signal. Surfacing the lock error makes that state visible. Silently serving from a credential that exists only in memory would hide it until a restart loses the credential. Stale reclamation (30 s) clears an orphan, and the next request re-reads disk.
- All error messages name the provider and the outcome only, never token material.
- **Lock acquisition without the placeholder.** `withLock` gains an options bag, `withLock(fn, { budgetMs = 2_000, createIfMissing = true })`. Interactive writers keep today's defaults. `readCredentialLocked` and `writeRefreshedOAuth` pass `{ budgetMs: REFRESH_LOCK_BUDGET_MS, createIfMissing: false }`, so the refresh path never creates `auth.json` at step 1, step 3, or step 5. With `realpath: false`, proper-lockfile only `mkdir`s `auth.json.lock` and does not need the target to exist. Absence is decided inside the lock, after acquisition.
- *Alternative:* keep `writeCredential` and diff afterwards. Rejected: the check and the write must happen under the same lock.
- *Winner rule:* disk wins. pi keeps its in-memory state in sync with what it wrote, so converging on disk keeps both processes agreeing.

### D4 — The refresh path waits longer for the lock than interactive writes do
pi holds the lock for about 15 s at most while it refreshes, when the provider honours the abort signal. With the 2 s budget, both the step-1 snapshot and the step-3 CAS would fail during every overlapping pi refresh, which is the exact moment coordination matters. `withLock` / `acquireAuthLock` take an optional budget:
- Interactive routes (`writeCredential`, `removeCredential`) keep **2 s**. The provider-auth-server requirement is reworded so its 2 s window explicitly governs interactive writes and removals, and it defers the refresh path to the model-proxy requirement. Without that carve-out the two requirements contradict each other.
- `readCredentialLocked` / `writeRefreshedOAuth` use **`REFRESH_LOCK_BUDGET_MS = 20_000`**: pi's 15 s refresh timeout signal plus margin, and below `stale` (30 s). A pi refresh against a provider that ignores the signal can hold longer, with a live mtime. The dashboard then correctly fails with the lock-contention error after 20 s rather than wait for a wedged holder. The wait is non-blocking (awaited timers), so the event loop stays free.
- This makes the coordination work. If the dashboard waits in step 1 while pi refreshes, it then finds pi's fresh credential and adopts it (D3 step 1) without spending a refresh token.

### D5 — Refresh buffer stays at 30 s (deliberately below pi's 5 min)
pi refreshes when less than 5 min remain. The dashboard refreshes when less than 30 s remain. When a pi session is active, pi therefore usually refreshes first, and the dashboard finds and adopts the result instead of competing. A disk credential with, for example, 60 s left is adopted. That is acceptable, because a proxy request authenticates at start.

## Risks / Trade-offs

- [Double spend remains possible] → The dashboard's refresh (lock not held) can overlap a pi refresh that started from the same token. CAS keeps the file consistent (disk wins). The dashboard recovers through step 5, and pi through its own re-check. D4 and D5 make the overlap rare.
- [Orphan recovery 10 s → 30 s] → A crashed holder blocks interactive dashboard writes for up to 30 s. Each one fails fast with the lock-contention message. A proxy request that needs a refresh can wait up to 20 s and then fail with the same message. pi already accepts the 30 s window.
- [Proxy latency during a pi refresh] → The common case is one pi hold (≤ 15 s) at step 1, followed by adoption. There is no network refresh of our own.
- [Composed worst case] → The pathological upper bound for one request is step 1 (≤ 20 s) + our network refresh (≤ `REFRESH_TIMEOUT_MS` 30 s) + step 3 (≤ 20 s), plus the step-5 re-read (≤ 20 s) on failure, ≈ 90 s. Reaching it requires pi to hold the lock almost continuously *and* a provider that hangs. Each wait is non-blocking, so the event loop is not blocked. However, `refreshLocks` shares one in-flight refresh per provider, so **every concurrent proxy request for that provider** waits on it, not just one. Requests for other providers and api-key providers are unaffected. The existing refresh ceiling already allowed 30 s. This change is accepted without a request-scoped deadline; a global request deadline is a separate concern.
- [Narrowing `withLock` to sync callbacks] → Internal API only, and every current caller is already sync. A future async need must go through a design change rather than silently reopening the compromise window.
- [Test harness drift] → The hostile holder keeps pi's literal options (D1). The refresh test's module mock gains `readCredentialLocked` / `writeRefreshedOAuth`, and its `writeCredential` assertions move to the CAS writer.
- [Rollback] → Revert-only. No persisted-state migration, and the lockfile path and `realpath: false` are unchanged, so dashboard↔dashboard mutual exclusion holds across versions. A reverted (or older) dashboard beside pi 0.86.1 regains the stale-mismatch lock theft that this change removes. Rollback restores the old risk; it does not add a new one.
