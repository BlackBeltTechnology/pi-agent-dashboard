# Design — offload-retained-transcript-replay

## Context

See `proposal.md — Why` for motivation. The design-relevant state:

- `readRetainedTranscript(store, sessionId, ctxWindow)` runs **synchronously on
  the main thread**: `store.read()` does `fs.readFileSync` of the retention
  file, then `parseSessionEntries` + `replayEntriesAsEvents` on the returned
  lines. Its contract is `{entries, events, state}`, **never throws** — the
  parse is inside that guarantee — and a replay failure keeps the state.
  Its only caller, the subscription handler's retained arm, reads `.events` and
  `.state`; nothing consumes `.entries`.
- `directoryService.loadSessionEvents` owns four things the retained path
  currently has none of: the `hydrationMetrics` sample + slow-load warning, the
  `inFlightLoadJobs` registry that `cancelLoad(sessionId)` (called by
  `browser-gateway` on last-unsubscribe) reads, the `ensureLoadWorkerPool()`
  null-after-dispose handling, and the `loadingSet` dedup. It returns
  `{success, events, error?}` — **no entries, no state** — and the subscription
  handler stamps `retainedTranscript` only inside `if (result.success)`,
  broadcasting `dataUnavailable: true` otherwise.
- `RemoteTranscriptStore.read()` owns responsibilities no caller may re-derive:
  the id refusal (`fileFor` throws), the `absent` reading of an unreadable file
  (**any** `readFileSync` failure, EACCES included, → `retained: false`), and
  the private `.complete` marker naming (`markerFor`).
- `append()` on a **restart** rewrites the file *first* and clears the marker
  *after* — so a stale `complete` marker briefly coexists with a fresh, shorter
  file. Today `read` and `append` are both synchronous on one thread, so no
  reader can observe that window.
- `loadSessionEntries(p)` is `parseSessionEntries(readFileSync(p).trim()
  .split("\n"))`. The `.trim()` is **not** equivalent to the store's
  `split("\n").filter(len > 0)`: `String.prototype.trim` strips U+FEFF, so the
  file path silently drops a leading BOM, while the store's split keeps it on
  entry 0 and `JSON.parse` throws — failing `parseSessionEntries`' header check
  and yielding zero events for the whole transcript.
- `append()` on a restart runs `rmSync(file)` then `writeFileSync(file, body,
  {flag:"wx"})`, and adjusts the marker **after** the body: writing it when the
  restart is itself complete, removing it when it is not.
- The two `readRetainedState` call sites differ: the transcript route consumes
  `entries` + `state`; the archived-open site consumes **only `.state`** yet
  pays a full file read to get it. Neither replays.

**This design supersedes two lines of the proposal:** the worker is fed the raw
transcript **text**, not a pre-split `entries` array (D1); and the read route is
**not** routed through the worker (D7).

## Goals / Non-Goals

**Goals:**

- Move read, split, parse and replay off the main thread for the hydration
  path, and the read off it for the HTTP path.
- Reuse the existing worker and `replayEntriesAsEvents` — one projection.
- Give the retained path the metrics, cancellation and pool-lifecycle handling
  the local path already has.
- Zero observable change (see `specs/server-session-hydration/spec.md`).

**Non-Goals:**

- No change to the read-only boundary, the origin gate, `decideRetainedRead`,
  or completeness semantics.
- No change to `RemoteTranscriptStore`'s write path (`append`, `forget`).
- No change to the local hydration path's dedup, failure, or broadcast
  semantics.
- No generic worker-pool extraction. Still two consumers.

## Decisions

### D1 — Feed the worker the RAW TRANSCRIPT TEXT

`SessionLoadRequest` becomes a two-arm input: `sessionFile?: string` **or**
`raw?: string`, with `loadAndReplay` validating exactly one is present and
returning `{success: false, error: "invalid_request"}` otherwise. The `raw` arm
splits and parses **in the worker**.

Raw text rather than the `entries` array the proposal sketched, because the
split is itself main-thread work on up to 256 MB, one 44 MB string is a
memcpy-class clone where 10⁵ separate strings is not. It is also the grain at
which parity becomes free:

```ts
// session-file-reader.ts — one splitter, both arms
export function splitTranscriptLines(raw: string): string[] {
  return raw.trim().split("\n");
}
export const loadSessionEntries = (p) =>
  existsSync(p) ? parseSessionEntries(splitTranscriptLines(readFileSync(p, "utf-8"))) : [];
```

The worker's `raw` arm calls `parseSessionEntries(splitTranscriptLines(raw))` —
the file arm's body minus the `fs` read. Identical bytes therefore produce
identical **events** by construction, closing the BOM divergence rather than
asserting around it.

The store's own `entries` splitting is deliberately **left alone**. Sharing the
helper there would look tidier and would silently change the HTTP surface:
`"".trim().split("\n")` is `[""]` where the store's filter yields `[]` (an
empty-origin transcript is reachable — the bridge emits one), interior blank
lines would reappear, and a leading BOM would vanish from entry 0. The spec
requires the HTTP body to be what it is today, so the store keeps
`split("\n").filter(len > 0)`. Parity is an **events** contract, and the events
come from the raw text, not from that array.

The rejected alternative was feeding the worker the **retention file path**. It
avoids the clone but moves store-owned responsibilities out of the store: state
derivation would be re-implemented from existence checks (which report
"present" for a file `read()` classifies `absent`), the private `.complete`
naming would be hard-coded by the caller, and the state check and the worker's
read would be two reads racing one decision.

The clone cost is measured by task 1.1/5.1; if it eats the win, the change is
reverted rather than kept.

### D2 — A `loadRetainedEvents` sibling on `DirectoryService`, NOT `loadSessionEvents`

Routing the retained path through `loadSessionEvents` itself is rejected: its
`{success, events}` shape loses the retained state, so a replay failure would
land in the handler's `dataUnavailable: true` branch — the exact downgrade the
spec forbids — `already_loading` would hand a concurrent second subscriber a
terminal empty frame, and retained events would silently acquire the
`customEventGroupResolver` annotation they skip today.

Calling `pool.load` directly from `retained-transcript.ts` is also rejected: the
pool is reachable only through `ensureLoadWorkerPool()` (which returns `null`
after `stopPolling`), `hydrationMetrics` is not on `BrowserHandlerContext` at
all, `HYDRATION_SLOW_WARN_MS` is module-private, and — decisively — a job
dispatched outside `inFlightLoadJobs` is invisible to `cancelLoad`, so
unsubscribing mid-parse could not cancel it. The spec requires the same
cancellation semantics as the local path.

So `DirectoryService` gains a narrow sibling:

```ts
loadRetainedEvents(sessionId: string, raw: string, knownContextWindow?: number):
  Promise<{ success: boolean; events: LoadedEvent[]; error?: string }>
```

It shares `loadSessionEvents`' plumbing — `ensureLoadWorkerPool()` with the same
`null` → `{success: false, error: "disposed"}` guard, the `inFlightLoadJobs`
register/unregister so `cancelLoad(sessionId)` reaches it, and the `finally`
that records the `hydrationMetrics` sample and emits the slow-load warning. It
differs in three ways: it dispatches `{raw}` instead of `{sessionFile}`; it does
**not** apply `options.customEventGroupResolver` (retained events do not carry
that annotation today, and adding it is a payload change this refactor must not
make); and it takes no `loadingSet` dedup, because coalescing happens one layer
up (D4).

### D3 — `readRetainedTranscript` stays, becomes async, and keeps its contract

The function survives because it is the only thing that owns "a replay failure
keeps the state". It takes `directoryService` alongside the store, and its body:

1. `await store.readRaw(sessionId)` → `{raw, complete, retained}`, mapped to
   `state` by the existing `readRetainedState` logic (D5). `absent` returns
   `{events: [], state: "absent"}` immediately, as today — no pool round-trip.
2. `await directoryService.loadRetainedEvents(sessionId, raw, knownContextWindow)`.
3. `success` → `{events, state}`. A **`cancelled`** result is distinct: it must
   take the same silent exit the local path takes (`subscription-handler`
   skips every side effect for `error === "cancelled"`), so it is surfaced to
   the caller as `cancelled`, NOT folded into `{events: [], state}` — otherwise
   a cancel would still stamp `retainedTranscript` and broadcast
   `session_updated` after the last subscriber left. Every other failure
   (`disposed`, `invalid_request`, and the worker's `err.message` for a replay
   throw) → log, return `{events: [], state}` — **state intact**, matching
   today's swallowed replay error.

The `entries` field is **dropped from the hydration return**: no caller reads
it, and shipping the split array back would reintroduce on the main thread the
work D1 moved off it. `readRetainedState` keeps returning entries for the two
HTTP call sites that actually need them.

The subscription handler's retained arm keeps its current shape — it already
assigns `retainedState` before returning `{success: true, events}`, so
`stopHeartbeat`, the failure branch and the `retainedTranscript` stamp are
untouched. `await` replaces `Promise.resolve(...)`.

### D4 — Leader/follower coalescing in the subscription handler

Making the read `await` opens an interleaving that cannot happen today: the
synchronous read's insert microtask drains before the next WebSocket macrotask,
so a second concurrent subscribe always sees `eventStore.hasEvents(...) === true`
and never hydrates. With an `await`, both arms run — and `insertEvent` is not
idempotent (fresh `seq` per call), so the transcript would be inserted twice and
both subscribers would render every message twice. `inFlightLoadJobs` is also a
`Map<sessionId, jobId>`, so a second job silently overwrites the first and
`cancelLoad` on last-unsubscribe reaches only one of them.

The fix is a per-session **in-flight promise**, held by the subscription handler
because that is where the `eventStore` inserts and the broadcasts live:

- **Leader** — the first cold subscribe for a session registers its hydration
  promise in the map, runs load + ingest + `session_updated` + per-subscriber
  replay exactly as today, and deletes the map entry when it settles.
- **Follower** — a subscribe arriving while that entry exists starts **no**
  hydration. It keeps its heartbeat running and awaits the leader's promise,
  then stops the heartbeat and emits nothing.

The follower emits nothing because it does not need to: the leader's completion
already loops `for (const sub of getSubscribers(sessionId))`, so a subscriber
that joined mid-hydration is in that snapshot and receives the full replay —
and on failure, the leader's `dataUnavailable` broadcast reaches it the same
way. One hydration, one insert, one jobId, cancellation intact, and no terminal
empty frame for the follower.

A subscribe arriving *after* the leader settles finds no map entry, but also
finds `eventStore.hasEvents(...) === true` and takes the existing warm path.

Rejected: `already_loading`-style rejection (the local path's shape), which puts
the follower in the handler's failure branch — the false empty state the spec
forbids; and idempotent inserts + a jobId set, which adds two mechanisms to
solve what one promise solves.

### D5 — Async store read: marker BEFORE **and** AFTER, `complete = both`

`RemoteTranscriptStore` gains `readRaw(sessionId): Promise<{raw: string;
complete: boolean; retained: boolean}>`; `read()` becomes async and is
reimplemented on top of it, keeping its own `split("\n").filter(len > 0)` (see
D1). `fs.readFileSync` → `await fs.promises.readFile`. The `complete | incomplete
| absent` mapping stays where it is today, in `readRetainedState`.

The archived-open call site needs only `.state`, so the store also gains
`completenessOf(sessionId): Promise<RetainedTranscriptState>` that reads the
marker and `stat`s the content — no file body at all. That route stops reading a
44 MB transcript to answer a boolean.

The `await` introduces two interleavings the synchronous version could not
produce, and they point in opposite directions:

- **completion:** `append` writes the body, then the marker. Entries-then-marker
  can pair stale entries with `complete: true` — truncated reported as whole.
- **restart:** `append` rewrites the (shorter) file, then removes the marker.
  Marker-then-entries can pair a stale `true` marker with the new truncated
  file — also truncated reported as whole.

Marker-first alone therefore fixes only one of them. The read samples the marker
**before and after** the content read and takes the conjunction:
`complete = markerBefore && markerAfter`. Both hazards resolve to
`complete: false`, i.e. a whole transcript may be briefly reported `incomplete`
— conservative, and self-healing on the next read. This is the one direction the
three-state contract tolerates.

A **third** interleaving is new and is not in the tolerated direction. The
restart path `rmSync(file)`s before it `writeFileSync`s, and `fs.promises
.readFile` runs on the threadpool — so a read landing inside that window gets
ENOENT and maps to `absent`, i.e. "no transfer ever happened" for a session that
is mid-restart. The synchronous read could not observe this. Mitigation: the
content read retries **once** on ENOENT after a macrotask yield; the window is
two adjacent synchronous `fs` calls, so one retry closes it, and a genuinely
absent transcript costs one extra failed `open`.

Two failure mappings must stay distinct, and `fs.promises.access` makes the
distinction easy to lose because it **rejects on ENOENT** where `existsSync`
merely returned `false`:

- **marker** access rejects (missing, or unreadable) → `complete: false`. Its
  own `try/catch`. A missing marker is the ordinary `incomplete` case and must
  never reach the `absent` mapping.
- **content** read rejects (missing, EACCES, EISDIR, or the refused-id throw
  from `fileFor`) → `{retained: false}` → `absent`, exactly as today.

Because `fileFor`'s throw becomes a **rejection** once `read` is async, both
`readRetainedState` and `readRetainedTranscript` `await` **inside** their `try`.
A `try { store.read() } catch` around a non-awaited promise catches nothing, and
the never-throws guarantee would break silently.

### D6 — Metrics recorded by `loadRetainedEvents`

Same recorder instance, same `{sessionId, wallMs, fileBytes, entryCount,
eventCount, at}` shape, same `HYDRATION_SLOW_WARN_MS` threshold, same
swallow-any-throw isolation — inherited, not reimplemented, because D2 puts the
retained dispatch inside `DirectoryService`.

`fileBytes = Buffer.byteLength(raw)` — the decoded text's byte length. It equals
the local path's `statSync().size` for valid UTF-8, which is what a JSONL
transcript is; invalid bytes decode to replacement characters and would diverge.
Good enough for a comparability metric, and strictly better than summing a split
entries array, which would undercount by every newline — a second reason D1
passes raw text.

The short-circuited `absent` read does **not** reach `loadRetainedEvents` and so
records no sample. This is deliberate: the metrics ring holds 20 samples, and
letting no-op reads evict real slow hydrations would defeat the question the
requirement exists to answer. The spec is written to match.

### D7 — The HTTP route gets async I/O, not the worker

`GET /api/sessions/:id/retained-transcript` uses `readRetainedState`, which never
replays; D4 removes its only main-thread stall. A worker would add a clone of the
entries array back across the boundary to produce output the worker did not
improve. The archived-open site moves to `completenessOf` and stops reading the
body at all (D5).

## Risks / Trade-offs

- **The raw-string clone could eat the win on small transcripts** → the change
  is justified by the tail (p99 3.9 MB, max 44.1 MB); tasks 1.1/5.1 require the
  before/after number and mandate revert if it does not move.
- **Worker timeout re-runs the parse in-process.** The pool's fallback calls
  `loadAndReplay` on the main thread after a 30 s timeout, restoring the
  pre-change stall for that request — and the heartbeat cannot fire during it.
  Bounded by the store's 256 MB cap, no worse than today, and the price of
  never hard-depending on the worker. Recorded, not mitigated.
- **`dispose()` drains queued jobs through the same in-process fallback**, so a
  queued 44 MB retained job is parsed on the main thread at `stopPolling`. Same
  shape as the timeout risk; shutdown-time only.
- **Retained hydration now competes for worker slots** with local hydration and
  `/api/session-diff` on a pool sized `min(maxConcurrentSpawns, cpus)`, and
  inflates the shared `inFlight()` counter. Accepted: it replaces *blocking the
  whole loop* with *queueing behind one job*.
- **Concurrent cold subscribes coalesce onto one hydration (D4)**, which is new
  machinery on a path that previously serialized by accident of being
  synchronous. A leaked map entry would wedge every later subscribe to that
  session, so the entry is deleted in a `finally`, not on the success path.
- **`store.read` becoming async touches a public store method** → callers are
  `readRetainedState` plus tests; `append` and `forget` are untouched.
- **A BOM-prefixed retained transcript starts replaying** where it previously
  produced zero events (D1's shared splitter). A behaviour change, in the
  direction of rendering data that was silently dropped.

## Migration Plan

Pure server-internal refactor. No persisted format, protocol, config, or client
change; retention files on disk are read exactly as before. Rollback is the
revert of the commit — nothing is written differently in the meantime.

`DashboardConfig.sessions.useLoadWorker = false` disables the offload for both
hydration paths, but it is **captured at `DirectoryService` construction** and
`reconfigurePolling` does not rebuild the load pool — so flipping it requires a
server restart, not just a config write. Stated because the switch is the
non-revert rollback lever and its actual reach is easy to overstate.

Closeout debt this change settles, not defers — mechanical but not small:
`RemoteTranscriptStore.read` is on the exported interface, with ~14 synchronous
`.read()` assertions in `remote-transcript-store.test.ts` and ~16
`readRetained*` calls in `retained-transcript.test.ts`, all of which become
`await`. `splitTranscriptLines` is exported from `session-file-reader.ts` and
adopted by the worker's raw arm only. The
`packages/server/src/session/AGENTS.md` rows for `retained-transcript.ts`,
`remote-transcript-store.ts`, `session-file-reader.ts`, `session-load-worker.ts`
plus the `directory-service.ts` row record the new signatures.
