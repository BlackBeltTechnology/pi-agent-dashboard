# Design — Attribute and eliminate poll-path event-loop stalls

## Context

Measured evidence (production `/api/health` + 20-sample loop + 240k-line
`server.log`):

- Server event-loop delay: `mean≈p99≈21ms` (healthy), `max≈711–731ms` (lone
  recurring spike). Single synchronous burst signature.
- Not hydration (sample static during spike), not client (server-side ELD).
- `durationMs` per tick ≈ 4.6s is **jitter stagger**, not blocking; the 5s
  slow-tick warning is therefore near-useless (fires 1,704×, blind to the 700ms
  real stall).

The `server-openspec-polling` spec already moved derivation + serialization into
a worker. What it explicitly left on the main thread:

> "The main thread SHALL retain ownership of the `openspec list` CLI spawn, the
> spawn-concurrency semaphore, the per-cwd cache, the mtime/TOCTOU gate stamping,
> and the broadcast."

Plus `tickFolderHeads()` runs **ungated, every tick**, before the openspec gate,
doing git HEAD reads across every pinned + active-session directory.

## Why measure-first (not fix-first)

We have a strong candidate (`tickFolderHeads`) but not proof. The main-thread
survivors run in **different event-loop turns** (see "Execution model" below):
in `tickOpen` — folder-head `execSync` git reads, `reconcileWatchers`,
`computeKnownDirectories`; in each `dirPollPre` — the list-signal
`effectiveMtimeOr` stat-fan; in each `dirPollPost` — the worker-response
**deserialization** (structured-clone, payload-proportional) and the broadcast.
Plus V8 GC. Any one is a plausible
~700ms burst. Shipping a `tickFolderHeads` rewrite on a guess risks (a) fixing
the wrong thing and (b) duplicating the caution the archived poll work already
exercised. Attribution is cheap (`performance.now()` marks) and turns the guess
into a fact before we touch the hot path.

## Phase 1 — Attribution

### 0. Execution model — why a naive per-tick segment sum is wrong

The 700ms event-loop-delay spike is, by its p99≈21ms / max≈711ms shape, **one
synchronous event-loop turn**. Attribution must therefore be **per-turn**, not
per-tick. `scheduleOpenSpecTick` does NOT run its work in one turn:

- **Turn A** (the `setInterval` fire): `tickFolderHeads()` (sync `execSync` git
  HEAD reads, all folders), `reconcileWatchers()`, `computeKnownDirectories()`,
  and the `Promise.all` timer setup — all synchronous, one turn.
- **Per-dir, each split into TWO turns** by the `await` inside the callback
  (`const next = await pollDirectoryGated(cwd)`) and the worker `await` inside
  `pollOne`. For each dir's `setTimeout(…, phaseOffsetMs(cwd, jitterSeconds))`:
  - **`dirPollPre`** (the `setTimeout` fire, synchronous prefix *before* the
    worker await): `pollOne`'s root `statMtimeOr(openspecRoot/changesRoot)` +
    the list-signal `effectiveMtimeOr([changesRoot, …taskFiles])` stat-fan.
  - *(worker runs off-thread)*
  - **`dirPollPost`** (the continuation after the worker resolves): the
    worker-response **deserialization** (structured-clone on the main thread) +
    the `nextJson` compare + `onChangeCallback` broadcast.

So the tick's synchronous work is spread across `tickOpen` + (per dir)
`dirPollPre` + `dirPollPost` — as many turns as there are dirs, times two, plus
one. **Summing them both false-positives** (many modest per-turn costs sum past
a threshold with no single stall — benign jitter accumulation) **and
false-negatives** (a real single-turn burst in an uninstrumented turn leaves the
sum low → alarm silent). Also: `durationMs` is wall time spanning all
`phaseOffsetMs` delays + worker round-trips, so it is not the burst either. Every
attribution below is therefore **per single synchronous turn**, never a per-tick
sum.

### 1a. Sub-threshold event-loop spike retention (primary signal)

Today `/api/health` reads `{meanMs,p99Ms,maxMs}` from a **single boot**
`monitorEventLoopDelay` histogram (`server.ts`) and **resets it on every read**.
A stall that happens when nobody polls leaves no trace, and any ring sampler
that reads that same histogram would race `/api/health`'s reset (each wipes the
other's window).

**Two independent feeds into one ring buffer** — attribution is by self-record,
not by correlating a timer sampler to a turn:

1. **Per-turn self-record (authoritative attribution, 1b).** Each instrumented
   turn wraps its own synchronous run in `performance.now()` and, when it
   exceeds a floor, records `{at, ms, turn}` itself. The turn *knows* its name
   and its exact synchronous cost — no guessing which turn a spike belongs to.
2. **Dedicated ELD sampler (safety net for *un*instrumented stalls).** A
   **second, dedicated `monitorEventLoopDelay()` instance** (never the boot
   histogram) is snapshotted on a fixed cadence; a `max` above the floor records
   `{at, ms, turn: null}`. This catches stalls no instrumented turn owns — GC,
   session-hydration deserialize, WS on-connect. `/api/health`'s histogram +
   reset stay untouched (additive, no reset race).

A `turn: null` spike whose `ms` has **no matching same-window per-turn entry**
is the evidence that the burst is uninstrumented (→ GC / other subsystem, Phase
2 re-scopes). The two feeds together answer both "which turn" and "is it even a
poll turn."

Reuse only the ring-buffer **container** shape from `hydration-metrics.ts`
(O(1) record, capped, newest-first, process-local). Do NOT reuse its
*event-driven* `record`-per-call model.

```
eventLoopSpikes: [
  { at: 1750000000000, ms: 711, turn: "dirPollPost" },  // self-recorded
  { at: 1749999940000, ms: 731, turn: "tickOpen" },     // self-recorded
  { at: 1749999900000, ms: 690, turn: null },            // ELD sampler, unattributed
  ...
]  // newest-first, capped
```

### 1b. Per-turn synchronous attribution (naming signal)

Wrap each candidate **turn** in `performance.now()` (mark at turn entry, measure
at turn exit) and, when a turn's own synchronous run exceeds a floor, self-record
`{at, ms, turn}` into the buffer (feed 1 above):

| Turn          | Synchronous work in this single turn                            |
|---------------|-----------------------------------------------------------------|
| `tickOpen`    | `tickFolderHeads` (`execSync` git HEAD) + `reconcileWatchers` + `computeKnownDirectories` |
| `dirPollPre`  | one dir's `pollOne` prefix *before* the worker await: root `statMtimeOr` ×2 + list-signal `effectiveMtimeOr([changesRoot, …taskFiles])` stat-fan |
| `dirPollPost` | one dir's continuation *after* the worker resolves: worker-response deserialize (structured-clone) + `nextJson` compare + `JSON.stringify` fallback + `onChangeCallback` broadcast |

Label note (V3): the per-change **TOCTOU mtime stamping already runs inside the
worker** (`offload-openspec-poll-to-worker`), off the main thread — it is NOT a
main-thread turn. The only on-thread stat work is `dirPollPre` (root + list-
signal stats). The earlier `gateStat` label wrongly lumped the offloaded stamp
with on-thread stats; the split above names only what actually blocks the loop.

The two leading `dirPollPost` culprits for large repos are the worker-response
deserialization (payload-proportional structured-clone) and, per connected WS
client, the broadcast send. Record the worst *single turn*, never a sum. If a
turn is indicted and needs finer breakdown (deserialize vs. broadcast within
`dirPollPost`), add inner marks then — measure-first, don't pre-instrument.

### 1c. Fix the slow-tick alarm (add, don't replace)

`durationMs` (wall) is dominated by jitter, so it is blind to sub-second stalls
— but it still catches a genuinely overdue tick (slow worker/spawn, small sync
segments). **Keep it.** **Add** a second, independent warning that fires when
any single instrumented turn's synchronous `performance.now()` run exceeds a
threshold (proposed default 250ms, configurable). Jitter (spread across turns)
never trips the per-turn alarm; a 700ms single-turn burst does. The two alarms
are orthogonal: wall-overdue vs. main-thread-blocked.

Schema note: the spike record stores the single worst `turn` (1b); the per-turn
alarm keys on that same per-turn synchronous value. No summed field is stored or
alarmed on — the earlier draft's store-MAX-but-alarm-on-SUM mismatch is gone.

## Attribution result (tasks 2.1 / 2.2)

Phase 1 deployed to the live production instance; `eventLoopSpikes` collected
over a 63-min window (poll interval 180s):

- **21 named-turn spikes — 100% `tickOpen`**, 640–705ms, one per poll interval
  (08:00:07, 08:03:07, 08:06:07 … exactly every 180s).
- The dedicated ELD sampler's `turn: null` spikes land at the **same `:07`
  timestamps** (e.g. 08:21:07 → `tickOpen` 705ms AND `null` 719ms) — two-feed
  corroboration that the ~700ms burst IS the poll `tickOpen` turn (not GC /
  hydration / WS-connect).

**Finding: the stall is `tickOpen → tickFolderHeads`** — the ungated, every-tick
synchronous `execSync` git-HEAD fan-out (`readHead` runs 3 `execSync` spawns per
folder × ~11 folders ≈ 33 blocking subprocesses on one turn). This is the
design's leading hypothesis, now proven. **Phase 2 branch taken: 3.1
(`tickOpen → folderHeads`).**

**Remedy applied (3.1):** async + concurrency-bounded git HEAD reads.
`readHeadDisplayAsync` (git-operations.ts) reads HEAD via async `execFile` (never
blocks the loop); `folder-head-poll.ts` fans out with a concurrency cap
(`mapBounded`, default 4); `tickFolderHeads` is `await`ed before the openspec
fan-out so per-cwd `git_head_update` still precedes `openspec_update`. Chosen
over mtime-gating (which risks suppressing a same-mtime branch switch). Guards
(4.1a): `directory-service-folderhead-async.test.ts` asserts the ordering AND
that a branch switch still reflects on the next tick.

## Phase 2 — Elimination (branches on 1b result)

Whichever turn/sub-cost 1b indicts. Each branch carries a **CONTRACT #4 guard**
(archived mtime-gate / byte-identical-payload / worker-offload must not
regress) — the branch is not done until its guard test is green.

**If `tickOpen → folderHeads` (leading hypothesis):**
- It runs ungated every tick (`execSync` git HEAD reads). Preferred:
  `setImmediate`-chunk between folders, or async (`fs.promises` HEAD-ref read /
  async `child_process`) + bounded concurrency, so the reads never form one
  synchronous burst.
- mtime-gating the folder-head poll is an option BUT **risks
  `refresh-folder-header-branch`**: HEAD must reflect the current branch every
  tick; a branch switch whose ref-file mtime didn't advance could be suppressed.
  Guard: a test that a branch switch surfaces within one tick after gating.
- Async/chunked folder-head reads **reorder `git_head_update` vs
  `openspec_update`** per cwd (folder-head broadcasts currently fire
  synchronously before the openspec ones). Guard: assert per-cwd event ordering
  or confirm the client tolerates interleave.

**If `dirPollPost → worker-response deserialize` (co-leading hypothesis):**
- The main-thread structured-clone of a large `PollWorkerResponse.data` is
  payload-proportional. Options: return the pre-`serialized` string only (skip
  re-materializing `data` on the main thread where the caller only needs the
  string), or transfer via a transferable/`ArrayBuffer` instead of structured
  clone. Guard: byte-identical-payload invariant still holds.

**If `dirPollPost → broadcast`:**
- Note (V4): the fan-out is **already one dir per turn** (each dir broadcasts in
  its own `dirPollPost`), so the cost is NOT many-dirs-in-one-burst. A heavy
  `dirPollPost` broadcast means the **per-client** send loop over many connected
  WS clients for one dir's frame. Remedy: chunk/yield the *client* loop, not the
  dir loop. **Risks byte-identical-payload** (`serialized` is passed straight
  through today) **and the deliberate transitional `{pending:true}` emit**.
  Guard: byte-identical + pending-emit tests stay green.

**If `dirPollPre → list-signal stat-fan` (`effectiveMtimeOr`):**
- Batch the read-side `stat`s via `fs.promises` with a concurrency cap. **Do NOT
  touch the per-change TOCTOU stamp** — it already runs in the worker; making
  any pre/post-call mtime capture async widens the bracket the archived
  `fix-openspec-mtime-gate-toctou` depends on. Only the on-thread list-signal
  fan is in scope. Guard: mtime-gate + TOCTOU tests stay green. Note: this fan
  is a handful of `tasks.md` stats per dir — it may legitimately not indict;
  attribution decides.

**If `GC` or an uninstrumented turn:** 1a's ELD sampler will emit `turn: null`
spikes with no matching per-turn self-record → the burst is allocation pressure
or a turn outside `tickOpen`/`dirPollPre`/`dirPollPost` (session hydration
deserialize, `session_register`, WS on-connect snapshot). Separate follow-up;
the two-feed buffer *proves* it is uninstrumented rather than us guessing. This
means CONTRACT #1 is fully satisfied only for the instrumented turns — an
all-`null` spike set is itself the evidence, and Phase 2 re-scopes to the
indicted subsystem.

## Alternatives considered

- **Raise `pollIntervalSeconds` / unpin dirs (config only).** Real mitigation,
  zero code — recommended to the user as an immediate stopgap. But it only makes
  the stall rarer, not gone, and doesn't explain the source. Not a substitute for
  the fix; noted in tasks as the interim workaround.
- **Fix `tickFolderHeads` directly without attribution.** Rejected: guess-driven,
  may miss the real turn (deserialize/GC), no regression signal afterward.
- **New standalone perf subsystem.** Rejected: over-built. Reuses the
  `hydration-metrics.ts` ring container + the `/api/health` surface. (The
  fixed-cadence ELD sampler is genuinely new wiring, but it is a few lines on an
  existing surface, not a subsystem.)

## Risks

- Turn marks add negligible overhead (a few `performance.now()` per turn).
- Sampler uses a **dedicated** `monitorEventLoopDelay` instance, never the boot
  histogram — no reset race with `/api/health`.
- Ring buffer is process-local, bounded, no persistence — reuses only the
  container shape of `hydration-metrics.ts`, not its event-driven record model.
- Phase 2 touches the poll hot path; each branch is gated by a named CONTRACT #4
  guard test (see Phase 2). Known regression vectors already identified:
  `dirPollPre` list-fan→async must not touch the worker's TOCTOU bracket,
  `dirPollPost` broadcast→chunk breaking byte-identical payload / the
  `{pending:true}` emit, `tickOpen` folderHeads→mtime-gate suppressing a
  same-mtime branch switch, `tickOpen` folderHeads→async reordering
  `git_head_update` vs `openspec_update`.
- Attribution may point outside the instrumented turns (GC, hydration deserialize,
  WS on-connect). That is a valid outcome, not a failure — it re-scopes Phase 2
  rather than forcing a guess.
