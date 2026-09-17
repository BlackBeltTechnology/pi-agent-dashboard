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
- **Expose retention + heap headroom in `/api/health`.** Add retained bytes
  (global and per session), `evictedSessions` alongside the existing
  `storeTrim`, and `heapSizeLimit` — absent today, so no client can compute how
  close the server is to its ceiling.
- **Shed under heap pressure.** When `heapUsed` approaches `heapSizeLimit`,
  trim more aggressively than the steady-state budget requires, so the server
  degrades (older transcript detail is dropped) instead of dying.
- **Characterize the back-pressure and stall findings.** Record the dropped-frame
  and event-loop-spike behaviour against the new telemetry to confirm they
  subside once retention is bounded, and split any residue into its own change
  rather than widening this one.

## Impact

- Affected specs: `dashboard-server`, `shared-config`, and the event-store
  retention behaviour; `settings-panel` for the new key.
- Affected code: `packages/server/src/persistence/memory-event-store.ts`
  (accounting + budget eviction), `packages/server/src/routes/system-routes.ts`
  (`/api/health` fields), `packages/shared/src/memory-limits.ts` (new key +
  default).
- Behavioural change: under sustained load the server will now **drop old event
  detail it previously retained**. That is the point — the alternative currently
  observed is a fatal OOM that loses everything. Replay/hydration already
  tolerates evicted sessions (`specs/session-diff-extraction`), so the
  degradation path exists.
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
