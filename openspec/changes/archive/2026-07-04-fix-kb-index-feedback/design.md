## Context

`add-kb-folder-slot` shipped a per-cwd KB row with a five-state model (`not-indexed | indexing | populated | stale | error`) plus a `KbJobRegistry` whose `isRunning(cwd)` / `statusFor(cwd)` are exposed through `GET /api/kb/stats`. The client hook `useKbStats` already polls `/stats` every second **while `stats.indexing === true`** and stops when the job settles. The infrastructure for a live spinner exists and is correct.

The defect is that the primary action — the `Index now` / reindex button — never lets that infrastructure engage:

```
CURRENT (blocking)                              server
  click ─▶ reindexKb(cwd) ─▶ POST /reindex ───▶ registry.start(fn)
                                                return await promise   ◀── walk 974 files (~seconds)
            (fetch pending this whole time)  ◀──────────────────────── 200 {changed,chunks}
          refetch() ─────────────────────────▶ GET /stats ── indexing:false ── "populated"
                                                └─ indexing:true was NEVER observed → no spinner
```

The `PUT /api/kb/config` path already does it right — it calls `registry.start(...).promise.catch(()=>{})` (fire-and-forget) and lets the client poll `/stats` for `indexing:true`. The fix makes the direct reindex route behave the same way.

Second, independent of timing: `FolderKbSection` never renders `useKbStats().error`, so a rejected POST (403/500/transport drop) produces zero UI. The five-state model has an `error` state, but it is only driven by the *server* `jobStatus:"error"` (a job that started then threw), never by a *client-side* reject (a POST that never registered a job — e.g. 403 `cwd not allowed`, or a network/proxy failure).

## Goals

- Make `indexing:true` observable from the primary action so the animated indicator + polled chunk count render during the walk.
- Make any reindex failure (server or transport) visible with a `Retry`, never silent.
- Zero change to the indexer, config layering, cwd validation, DB schema, or the job registry's coalescing/retention.

## Decision 1 — Non-blocking reindex route (chosen)

Change the `POST /api/kb/reindex` handler from:

```ts
const { promise } = registry.start(cwd, async () => reindexAll(cwd));
try { return await promise; }               // BLOCKS until walk done
catch (err) { reply.code(500); return { error: "reindex failed" }; }
```

to fire-and-forget, mirroring the `PUT /config` branch already in the same file:

```ts
const { jobId, promise } = registry.start(cwd, async () => reindexAll(cwd));
promise.catch((err) => req.log?.error?.(`[kb-plugin] reindex failed for ${cwd}: ${msg(err)}`));
reply.code(202);
return { status: "running" as const, jobId: registry.jobId(cwd) ?? jobId };
```

- The already-running/coalesced branch (`if (registry.isRunning(cwd)) → 202 { status:"running" }`) is unchanged; now the *fresh-start* branch returns the same shape, so the client has one code path.
- The walk still runs in-process; on completion the registry flips `isRunning`→false and records `done`/`error`, exactly as the config path relies on. A failed walk sets `jobStatus:"error"`, which `/stats` reports → the existing server-error `Retry` state renders.
- The registry already sets `running` **synchronously** inside `start()`, so the immediate follow-up `/stats` poll observes `indexing:true` with no race.

### Rejected: keep blocking, add a WebSocket progress channel
Streaming per-file progress over WS would give richer feedback but is a much larger surface (new message types, bridge plumbing) and does not fix the core bug — the spinner. The polled `/stats` count is sufficient v1 feedback; WS progress is a follow-up if wanted. Explicitly out of scope.

### Rejected: client kicks reindex without awaiting, keeps the 200 route
Firing the POST and immediately `refetch()`-ing without awaiting would *also* start the poll, but leaves the server blocking a connection for the whole walk (holds a socket, and a client that ignores the response can't distinguish a coalesced job from a fresh one). Returning `202` promptly is cleaner and makes the two branches symmetric.

## Decision 2 — Surface the client-side error WITHOUT eating the spinner (chosen)

Naive wiring of the hook's single `error` is wrong in **both** directions (surfaced by doubt review):
- `error != null && state !== "indexing"` → a poll that fails mid-walk sets `error` AND `clearPoll()`s, freezing `stats` at `indexing:true`; the guard then *hides* `Retry` and the row sticks on `indexing…` forever.
- unconditional `error != null` → a single transient poll blip (server GC pause, brief 502) during a live walk flips the row to `index failed` while the server is still walking — violates Contract 1.

Root cause: `useKbStats` today treats a *trigger* failure (the reindex POST rejected → no job ever started) and a *transient poll* failure (a `/stats` hiccup while a job runs) as the same `error`, and it **stops polling** on either. Fix the hook to separate them:

1. **Trigger error** (`reindexKb(cwd)` rejects — 403/500/transport, job never registered): expose as a distinct `reindexError`. Definitive failure → render failed + `Retry` immediately, regardless of `stats`.
2. **Poll resilience**: on a `/stats` fetch error, do NOT `clearPoll()` + `setError()` and give up. Keep the interval alive (bounded consecutive-failure counter, surface only after N≥3 straight misses) so a transient blip does not kill the spinner; once `/stats` is reachable again the client observes the true terminal state (`jobStatus:"error"` + `lastError`, or `populated`). A persistent poll outage surfaces as a distinct "stats unavailable" note, not a false "index failed".

`FolderKbSection` render rule (precedence):
```
reindexError != null                         → failed + Retry   (job never started)
stats.jobStatus === "error"                  → failed + Retry   (walk started, threw)
stats.indexing === true                      → spinner          (transient poll misses tolerated)
… else the five-state count derivation unchanged
```
`reindex()` clears `reindexError` before firing, so `Retry` resets cleanly. No new visual language — reuse the existing red `error`/`Retry` styling.

## Interaction between the two fixes

With Decision 1, a *started-then-threw* walk surfaces via `jobStatus:"error"` from `/stats`. With Decision 2, a *never-started* reject surfaces via `reindexError`; a *transient* poll miss no longer masquerades as either. All three render the same `Retry`, so the spinner survives blips and one consistent recovery affordance shows.

## Decision 3 — Accepted trade-offs (documented, not fixed)

- **Server restart mid-walk = lost job (Contract 2 edge).** `KbJobRegistry` is in-memory (no cross-process durability, by design). The old blocking route dropped the client's POST connection on server death → transport error → surfaced. Under 202, a restart mid-walk loses the in-flight job; the next `/stats` returns `indexing:false, jobStatus:"idle"` off whatever chunks committed, no error. Mitigation: reindex is **idempotent** — the row shows the (possibly partial/zero) count and a single re-click recovers. Persisting job state cross-process is out of scope. Called out so the gap is a known trade-off, not a silent surprise.
- **Sub-RTT walk shows no spinner.** A trivially small folder can finish between the 202 and the first `/stats` poll → straight to `populated`. Inherent to polling (also true of the old route); acceptable — an instant index needs no progress indicator.
- **Detached walk + hard shutdown.** The walk is no longer tied to a connection lifetime; a `SIGKILL` mid-walk could orphan the SQLite handle before `reindexAll`'s `finally { store.close() }` runs. WAL + process reclaim masks this; a graceful `fastify.onClose` awaiting background jobs is deferred hardening.

## Decision 4 — Contract & test drift the change MUST carry

The 202 shape change ripples beyond the handler body; the change is incomplete without:
- `kb-routes.ts` route JSDoc, `packages/kb-plugin/README.md`, and `KbReindexResult` in `shared/kb-plugin-types.ts` all document the `200 { changed, chunks }` POST body — update to `202 { status:"running", jobId }` as the sole POST success shape. `KbReindexResult` becomes internal to `reindexAll`/the registry `done` record, not the wire shape.
- The route's `try/catch`→`500` becomes **dead** (nothing after `rejectCwd` throws synchronously; job errors reach the `.catch`, not the response). Remove it per surgical-changes. The client `parseJson(!res.ok)` still handles any *other* 500 generically, so client handling stays.
- Server tests (`kb-routes.test.ts`): the `chunks>0` and incremental-`changed:0` assertions read the POST body synchronously — rewrite to the **poll-until-settled** pattern the PUT/config test already uses (POST → 202 → poll `/stats` until `indexing:false` → assert counts). Incremental asserts via `/stats`, not the absent body `changed`.
- Use `fastify.log` (not `req.log`) in the detached `.catch`; the request may be finalized. Attach `.catch` **synchronously** in the same statement as `registry.start()` so the rejecting tail promise is never momentarily unhandled (Contract 5).

## Decision 5 — Non-blocking walk via batched, yielding `indexSource` (chosen; found in impl)

Live verification exposed a defect neither the doubt review nor the reviewers caught: `reindexAll`/`indexSource` is **fully synchronous** (`readdirSync`, `better-sqlite3` sync inserts). Node is single-threaded, so even with the `202` the walk pins the event loop for its whole duration — a concurrent `GET /stats` cannot be *answered* until the walk finishes. Measured: a `/stats` that normally returns in ~2 ms took 230 ms during a trivial *incremental* walk; a full 974-file index blocks for seconds. So `indexing:true` exists in memory but is never observable over HTTP → **still no spinner** for the exact case being fixed. (Both reviewers assumed "runs in-process" = concurrent; it does not.)

Fix: `indexSource` becomes `async` and commits in **batches** — every `YIELD_EVERY` (100) files it `store.commit()`, `await`s a `setImmediate` (yields the event loop), then `store.begin()`s the next batch. Two effects:
1. The event loop is freed every ~100 files, so `/stats` polls are served mid-walk → `indexing:true` observed → spinner renders; the committed batches also make the chunk/file count climb live.
2. Committing per batch **releases the WAL write lock**, so a concurrent `/stats` reader (which runs `init()` DDL) isn't blocked. `PRAGMA busy_timeout=5000` covers the sub-100ms window where a poll lands mid-batch (waits for the commit instead of `SQLITE_BUSY`).

Trade-off: whole-walk atomicity is lost — a mid-walk throw leaves earlier batches committed. Acceptable because reindex is idempotent (a re-run completes it) and the end-of-walk deletion pass self-heals stale rows on the next full run.

Blast radius: `indexSource` is Layer-1, so every caller must `await` it — `reindexAll` (kb-plugin), `runIndex` (kb CLI), `reindexNow` (kb-extension, + its debounce timer via `.catch` and its `kb_search` freshness call via `await`), `verify.ts`, and the `kb`/`kb-extension` test suites. This widens scope beyond the original "no indexer change"; the user chose this (fully-smooth spinner) over yielding only between sources.

Rejected (Option 1): yield only *between sources* in `reindexAll`. Simpler and in-scope, but a single large source (e.g. `openspec`, 548 files) still blocks for its whole walk → spinner freezes. Rejected in favor of per-batch yielding.

## Test Strategy (TDD)

1. **Server route** (`kb-routes` test): `POST /api/kb/reindex` on a fresh cwd returns `202 { status:"running", jobId }` **without** waiting for the walk; poll `/stats` until `indexing:false`; assert `chunks > 0`, `jobStatus:"idle"`. Replaces the old synchronous-`200`-body assertion.
2. **Server failure**: force `reindexAll` to throw; assert the route still returns `202` (job started), then `/stats` reports `indexing:false`, `jobStatus:"error"`, `lastError` set.
3. **Client spinner** (`FolderKbSection` test): mock `/reindex`→`202` and `/stats` to return `indexing:true` then `populated`; click `Index now`; assert the animated indicator renders while indexing, then the chunk count.
4. **Client error** (`FolderKbSection` test): mock `/reindex`→reject (403); click `Index now`; assert the error/`Retry` affordance renders and a subsequent `Retry` re-fires `reindex()`.
5. **Event-loop non-blocking** (`kb-routes` test): index a >`YIELD_EVERY` folder (300 files); POST→202; poll `/stats` in a loop (yielding a macrotask between polls so the walk's `setImmediate` runs) and assert `/stats` is served `200` throughout (never `SQLITE_BUSY`/500) AND `indexing:true` is observed before it settles with `chunks>0`.

## Rollout

Server-independent + worktree-safe wiring; no schema/migration. Standard build + restart + reload after apply. The archived spec's "Running job shows progress" scenario flips from aspirational to test-covered.
