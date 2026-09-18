# Bound the event store by BYTES, not by counts

## Why

The dashboard server has died of `FATAL ERROR: Reached heap limit` **at least 8
times**. Sessions never have: across **4721** keeper/session logs in
`~/.pi/dashboard/` there is not one session heap death. Every OOM in the corpus
is the server, at two distinct ceilings:

| crash heap | meaning |
|---|---|
| `~8130 (8202) MB` | server dying **at its 8192 stamp**, GC thrashing, mutator utilization collapsed to `0.017` |
| `~4093 (4097) MB` | server dying at the **runtime default** — a server that never received the stamp (the dead `buildSpawnEnv` path, fixed by `bound-session-heap-and-gc-telemetry` task 8.6) |

`bound-session-heap-and-gc-telemetry` caps *sessions*, which were never the
offender. This change addresses the process that actually OOMs.

### Root cause: every bound is per-item; none is aggregate

A heap snapshot was taken from the live server (35.8 h uptime, 13 active
sessions, `heapUsed` 868 MB, `rss` peaking 1867 MB). The live set after V8's
forced GC:

| bucket | bytes |
|---|---|
| **strings** | **686 MB (86%)** |
| object | 45 MB |
| code | 28 MB |
| array | 15 MB |

**The per-item caps are all working correctly.** Of 1,237,999 retained strings,
only **8** exceed the 256 KiB `DEFAULT_MAX_EVENT_DATA_SIZE` (6 MB total). No
single oversized payload is to blame. The mass is death by a million cuts:

| string size | count | bytes |
|---|---|---|
| < 1 KB | 1,139,036 | 88 MB |
| **1–16 KB** | **88,083** | **338 MB** |
| **16–64 KB** | **10,726** | **239 MB** |
| 64–256 KB | 146 | 15 MB |
| > 256 KB | 8 | 6 MB |

98,809 strings in the 1–64 KB band carry **577 MB — 84% of all string bytes**,
every one of them individually legal. By content they are retained tool
payloads: `{"path": "/Users/robson/…"}` tool arguments alone account for
160 MB, the rest being markdown document bodies read or written by sessions.

The store enforces three bounds, and each is individually respected:

- per-event serialized size — 256 KiB ✔
- per-session events — 20000 ✔ (`storeTrim.trimmedEvents.total` = **1,284,215**; 19 sessions sit pegged at the cap)
- cached sessions — 100 ✔ (`evictedSessions` = **0** — LRU has never once fired)

**Their product is unbounded in bytes: 100 × 20000 = 2,000,000 events resident
with no ceiling on their total size.** The observed occupancy is ~36 MB per
pegged session (686 MB across 19). Extrapolated to the 100 sessions the config
already permits: **≈3.6 GB — which is the ~4093 MB crash.** Chattier events
reach the ~8130 MB crash. Both observed ceilings sit inside the permitted
envelope, which is why raising the cap only moved the crash.

### Secondary findings (same process, same pressure)

- **Event-loop stalls**: spikes of **8.3 s** and **24.3 s**; mean delay 20 ms. Consistent with GC thrashing against a near-full heap.
- **Back-pressure**: `droppedFrames.serverToBrowser` = **177,384**; socket buffer sat above threshold for **605 s** cumulative. Frames are dropped rather than retained, so this is a *symptom and a UX loss*, not a second leak — but it shares the cause and belongs in the same investigation.
- **RSS ≫ heap**: `rss` 1867 MB against `heapUsed` 818 MB. Fragmentation/`malloced` overhead means host memory pressure is roughly 2× the heap figure any ceiling is expressed in.

### Supersedes `bound-session-retained-bytes`

This change **absorbs and replaces** `bound-session-retained-bytes` (active,
0/19 tasks, never started). Its design, spec deltas and tasks are folded in here
rather than discarded; its per-session budget is retained as one of three
bounds, with its default retuned by measurement. That change is removed so one
coherent retention change owns `memory-event-store.ts` and the Memory Limits
settings section instead of two overlapping ones.

Its per-session budget was necessary but **not sufficient**, and its default is
disproved by the measurement above:

| bound | permitted resident |
|---|---|
| today — 100 cached × 20000 events, no byte cap | ~3.6 GB at measured rates (**= the ~4093 MB crash**) |
| per-session cap alone — 64 MiB × 100 cached | **6.4 GB** (**still above both crash ceilings**) |
| this change — 32 MiB × 32 cached, capped globally at 768 MiB | **768 MiB**, bounded by construction |

That change's own design note conceded the 6.4 GB cross-session worst case was
"still the LRU's job, unchanged" — but live telemetry reports
`evictedSessions = 0`: **the LRU has never fired**, because it triggers on
session COUNT (100) while only ~19 buffers are ever resident. The mechanism it
delegated to does not run.

Measured occupancy is **36 MB per pegged session**, *below* the proposed 64 MiB
per-session default — so that change as specified **would not have trimmed the
workload that actually OOM'd**. The unbounded dimension is the multiplier
(resident sessions), not the individual session.

## Settings and defaults

The existing Settings ▸ Memory Limits section already exposes
`maxEventsPerSession`, `maxStringFieldSize` and `maxWsBufferBytes`. Two gaps:

1. **`maxCachedSessions` is not operator-configurable at all.** `server.ts:925`
   passes `undefined, // maxCachedSessions (use default)`, hardcoding 100. This
   is the "resident sessions" knob and the direct multiplier on every
   per-session bound.
2. **No aggregate byte ceiling exists** in any form.

Proposed defaults, each derived from the measurement rather than picked:

| setting | today | proposed | basis |
|---|---|---|---|
| `maxCachedSessions` | 100 (hardcoded) | **32**, configurable | 13 active / 19 pegged observed; evicted sessions rehydrate from the transcript |
| `maxTotalEventBytes` (new) | — | **768 MiB**, `0` = off | current live occupancy is 686 MB; keeps steady-state heap ≈1 GB against the 8192 ceiling |
| `maxBytesPerSession` | — (proposed 64 MiB elsewhere) | **32 MiB** | 36 MB measured per pegged session — 64 MiB never binds |
| `maxEventsPerSession` | 20000 | **unchanged** | chat-head preservation depends on it; the byte budget is the correct lever |
| `maxStringFieldSize` | `0` (truncation OFF) | **unchanged, documented** | see below |

`maxStringFieldSize: 0` disables per-field truncation entirely
(`createTruncator` sets `stringPass = false`), which is why the 1–64 KB band
exists at all: 98,809 strings that a 4000-char cap would have truncated. Raising
it to the store's own `DEFAULT_MAX_STRING_SIZE` (4000) would reclaim roughly
150–250 MB — but it truncates transcript text users read, so it is a **fidelity
trade-off, not a bug**. This change does NOT flip it; it documents it as an
opt-in lever for memory-constrained hosts and lets the aggregate budget do the
work instead.

Worst case under the proposed defaults: `min(32 × 32 MiB, 768 MiB)` = **768 MiB**
of serialized event data, versus 3.6 GB today and 6.4 GB with the per-session cap
alone. Two qualifiers, both established during review:

- The enforced high-water mark is `768 MiB + GLOBAL_TRIM_SLACK` (~806 MiB), since
  reclaim is hysteretic — "768 MiB" is the budget, not the ceiling.
- The budget counts **serialized `data` bytes**, while the crash ceiling counts
  **V8 heap bytes**, and `rss` ran 1867 MB against `heapUsed` 818 MB. Strings are
  86 % of the live set so the two track closely for this workload, but 768 MiB of
  budget means roughly 1 GiB heap and ~2 GiB RSS. The defaults are sized against
  the 8192 MB stamp with that factor applied; the budget is not an RSS figure.

## What Changes

- **Add a global byte budget to the event store.** A new **operator-configurable**
  `memoryLimits` key bounds *total retained event bytes across all sessions* —
  the dimension nothing currently constrains. Enforced by evicting/trimming by
  LRU when the aggregate is exceeded, reusing the existing pinning rules so an
  active or pinned session is never starved to serve an idle one. The existing
  count caps stay as cheap first-line guards.
- **Account bytes as events are stored.** The store already computes byte sizes
  per event (`measureBytes`, `jsonStringByteSize`); accumulate them into a
  running per-session and global total instead of discarding them, so the budget
  is enforced without a second walk.
- **Make `maxCachedSessions` operator-configurable** and lower its default,
  replacing the hardcoded `undefined` at `server.ts:925`.
- **Expose retention + heap headroom in `/api/health`.** Add retained bytes
  (global and per session), `evictedSessions` alongside the existing
  `storeTrim`, and `heapSizeLimit` — absent today, so no client can compute how
  close the server is to its ceiling. The two retention/heap numbers are GAUGES
  and sit beside `rss`/`heapUsed`, not inside `storeTrim`, which is documented as
  cumulative counters never reset on read.
- **Heap-pressure shedding is NOT in this change.** Trimming harder as
  `heapUsed` approaches `heapSizeLimit` was cut during review: it has no defined
  trigger site, no defined target when a budget is `0`, and at the new defaults
  the store (768 MiB) cannot reach 85 % of an 8 GiB ceiling — it would fire only
  where its own semantics are undefined. The aggregate budget is the actual fix;
  shedding is filed as a follow-up. `heapSizeLimit` is still exposed here.
- **Characterize the back-pressure and stall findings.** Record the dropped-frame
  and event-loop-spike behaviour against the new telemetry to confirm they
  subside once retention is bounded, and split any residue into its own change
  rather than widening this one.

## Impact

- Affected specs: `in-memory-event-buffer` (per-session budget, global budget,
  configurable resident count, byte-trim telemetry) and `settings-panel` (three
  new Memory Limits controls).
- Affected server/shared code:
  `packages/server/src/persistence/memory-event-store.ts` (accounting + budget
  eviction), `packages/server/src/routes/system-routes.ts` (`/api/health`
  `server.heapSizeLimit` + `server.residentBytes` as GAUGES beside `rss`/`heapUsed`,
  NOT inside the cumulative `storeTrim` struct), `packages/shared/src/memory-limits.ts`
  and `packages/shared/src/config.ts` (three new keys + loader clamps),
  `packages/server/src/config-api.ts` (partial write), `packages/server/src/server.ts`
  (threading; replaces the hardcoded `undefined // maxCachedSessions` at :925).
- **Affected UI** — `packages/client/src/components/settings/SettingsPanel.tsx`,
  Memory Limits section. Three numeric controls added beside the existing ones:
  `maxBytesPerSession` and `maxTotalEventBytes` (labelled in MiB, converted to
  bytes at the edge) and `maxCachedSessions` (a plain count). Each carries a
  translated label + hint with an English fallback across every locale file, a
  partial config write, and the restart-required badge the sibling controls
  already use. No new screen, route, component or layout — it is three fields in
  an existing section, so there is no design/mockup work. Covered by
  `settings-field-contract.test.tsx` and `settings-bespoke-validation.test.tsx`
  (tasks 4.2–4.3).
- No other UI surface changes: the new `/api/health` fields are additive and no
  client component is required to render them in this change.
- Behavioural change: under sustained load the server will now **drop old event
  detail it previously retained**. That is the point — the alternative currently
  observed is a fatal OOM that loses everything. Replay/hydration already
  tolerates evicted sessions (`specs/session-diff-extraction`), so the
  degradation path exists.
- **Accepted regression — scrollback gets shallower.** `history_backfill` reads
  ONLY the in-memory store, never disk (serving it from disk is an explicit
  non-goal of `lazy-load-session-history`), and cold-load hydration re-inserts a
  transcript through `insertEvent`. So the byte budget now bounds both how far
  back a user can scroll and how much of a reopened session is restored — where
  today the bound is 20 000 events. This is real user-visible loss and it is
  accepted: the alternative observed eight times is a fatal OOM that loses every
  session's history at once. It degrades gracefully (backfill returns what
  remains and the client renders a gap), which a spec scenario now asserts, and
  operators who prefer depth over headroom raise `maxBytesPerSession` or set it
  to `0`.
- **Existing pegged sessions are trimmed on day one.** The 32 MiB default sits
  BELOW the measured 36 MB per pegged session deliberately — a default above the
  observed occupancy is a default that never fires.
- Relationship to `bound-session-heap-and-gc-telemetry`: complementary and
  non-overlapping. That change caps session processes and keeps `serverHeap` at
  8192; this change stops the server from *filling* whatever ceiling it is
  given. `serverHeap` must not be lowered until this lands.

## Discipline Skills

- `performance-optimization` — measure-first is already satisfied (heap snapshot
  + live telemetry); it governs the eviction-path work so the byte accounting
  does not itself become a hot-path cost.
- `observability-instrumentation` — the new `/api/health` retention and
  heap-headroom fields.
- `systematic-debugging` — the residual event-loop stalls and dropped frames,
  which are correlated but not yet root-caused.
- `doubt-driven-review` — the eviction policy is a data-loss decision; the
  pinning/active-session interaction must be stress-tested before it stands.
