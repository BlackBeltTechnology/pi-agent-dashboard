# Test Plan — bound-event-store-by-bytes

Stage: design   Generated: 2025-06-11

Clarifications raised at the hard gate were resolved before this file was
written (perf observable = pass-count only; settings accepts a sub-floor value
as typed; store-derived signals live in a `storeRetention` block). No open
markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Per-session budget binds | BVA | L1 | automated | budget 1 MiB, per-event ceiling 256 KiB, count cap 100 000 | insert 100 × ~200 KiB non-essential events | after every insert resident bytes ≤ 1 MiB + `BYTE_TRIM_SLACK`; surviving seqs are the newest |
| E2 | Reclaim target is the budget, not the trigger | BVA | L1 | automated | budget 1 MiB, total driven just past `budget + slack` | one insert crosses the threshold | after the pass resident bytes ≤ budget (NOT merely ≤ budget + slack) |
| E3 | Slack window suppresses the next pass | BVA | L1 | automated | buffer just reclaimed to budget | insert events totalling < `BYTE_TRIM_SLACK` | zero further reclaim passes run (trim-pass probe unchanged) |
| E4 | Total at exactly `budget + slack` does not trim | BVA | L1 | automated | resident bytes driven to exactly `budget + BYTE_TRIM_SLACK` | next read | no reclaim has run; all events resident |
| E5 | Budget `0` disables the byte bound | EP | L1 | automated | `maxBytesPerSession` = 0, count cap 100 | insert 100 × 200 KiB | all 100 resident; zero byte-triggered passes, including on the first event ever stored |
| E6 | Single event larger than the budget is admitted | BVA | L1 | automated | budget 1 MiB, a single 2 MiB event, empty buffer | insert it | event retained; buffer not emptied; invariant holds via the one-event exception |
| E7 | Chat head survives an ordinary byte trim | state-based | L1 | automated | seq 1 `message_start`, seq 2 `message_end`, then large `tool_execution_update`s past budget | reclaim runs | seq 1 and seq 2 present; only oldest non-essentials dropped |
| E8 | Essentials drop only when essentials alone exceed the budget | BVA | L1 | automated | a session whose `message_*` events alone exceed the budget | reclaim runs | every non-essential dropped first, then oldest essentials; total within budget |
| E9 | Floor clamp does not touch `0` | EP | L1 | automated | `maxBytesPerSession` = 0, per-event ceiling 256 KiB | store constructed | effective budget is 0 (unlimited); no byte bound enforced |
| E10 | Floor is meaningful when the per-event ceiling is disabled | BVA | L1 | automated | per-event ceiling 0, `maxBytesPerSession` 1 MiB | store constructed | effective budget raised above the finite measurement cap, not left at 1 MiB |
| E11 | Loader partitions for `maxBytesPerSession` | EP+BVA | L1 | automated | absent · `0` · `-1` · `"x"` · `1000` | config load | absent/`-1`/`"x"` → 33554432; `0` → 0 preserved; `1000` → loaded as-is, store clamps |
| E12 | Loader partitions for `maxTotalEventBytes` | EP+BVA | L1 | automated | absent · `0` · garbage | config load | absent/garbage → 805306368; `0` → 0 preserved |
| E13 | Loader partitions for `maxCachedSessions` | EP+BVA | L1 | automated | absent · `0` · negative · garbage · `1` | config load | absent/`0`/negative/garbage → 32; `1` honoured |
| E14 | Store default and config default agree | decision-table | L1 | automated | the two constants, in different packages | compare | `DEFAULT_MAX_CACHED_SESSIONS` === the configured default (both 32) |
| E15 | Configured resident count is honoured | BVA | L1 | automated | `maxCachedSessions` = 8, 8 unpinned buffers resident | a 9th unpinned buffer is created | least-recently-accessed unpinned buffer evicted; 8 resident |
| E16 | Bound-enabled matrix | decision-table | L1 | automated | all four combinations of `maxEvents > 0` × `maxBytes > 0` | insert past each bound | only the enabled bound(s) trigger a pass; both-disabled retains everything |
| E17 | Global budget evicts LRU-first | BVA | L1 | automated | `maxTotalEventBytes` 4 MiB, per-session budget 0, count cap high, 4 unpinned sessions × ~1.5 MiB | inserts push the global total past `budget + GLOBAL_TRIM_SLACK` | global total ≤ budget after the pass; least-recently-accessed buffers gone; newest intact |
| E18 | Pinned sessions survive global reclaim | decision-table | L1 | automated | same setup, LRU session pinned via `isSessionPinned` | global reclaim runs | pinned buffer resident; an unpinned, more-recently-accessed buffer evicted instead |
| E19 | Global budget `0` disables global reclaim | EP | L1 | automated | `maxTotalEventBytes` = 0, total far above any budget | inserts | no buffer evicted on account of bytes, including on the first event |
| E20 | Per-session budget never byte-trims under the global bound | decision-table | L1 | automated | `maxBytesPerSession` 32 MiB, 32 unpinned sessions each holding 32 MiB, global 768 MiB | global reclaim runs | whole buffers evicted until ≤ 768 MiB; no individual session was byte-trimmed |
| E21 | Accounting exact after every removal path | state-based | L1 | automated | one session driven through count trim, `collapseSuperseded`, `collapseOnEnd`, `deleteEventsForSession` | after each step | `getBufferBytes(sid)` === Σ `e.bytes` over `getEvents(sid, 0)` |
| E22 | Global total exactness | state-based | L1 | automated | multiple sessions driven through every removal path incl. eviction | after each step | global total === Σ per-session totals === Σ resident `e.bytes` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Byte reclaim is amortized O(1) per insert | linearity probe (pass-count) | L1 | automated | 10 000 events inserted under a trimming per-session budget | trim passes ≈ inserts / slack-window, NOT ≈ inserts | single run |
| P2 | Global reclaim is amortized, not per-insert | linearity probe (pass-count) | L1 | automated | sustained inserts across N sessions resting at the global budget | global reclaim passes ≪ inserts; no per-insert buffer-map sort | single run |
| P3 | Accepted-overshoot latch stops the rescan | linearity probe (pass-count) | L1 | automated | all sessions pinned, non-essentials exhausted, inserts continue | fallback scan runs once, then zero further scans until a latch-clearing event | single run |
| P4 | Steady-state retention holds on the live server | soak observation | — | manual-only | live dashboard on the new defaults | `storeRetention.residentBytes` stays under `maxTotalEventBytes`; `evictedSessions` non-zero; `heapUsed` no longer trends to the ceiling; compare to the 686 MB / `evictedSessions = 0` baseline | ≥ 24 h |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Controls render configured values | state-based | L1 | automated | config `maxBytesPerSession` 33554432, `maxTotalEventBytes` 805306368 | settings panel loads | controls show `32` and `768` (MiB at the edge) |
| F2 | Controls render defaults when absent | EP | L1 | automated | config with none of the three keys | settings panel loads | `32`, `768`, `32` respectively |
| F3 | Edited value is written back in bytes | state-based | L1 | automated | user sets the per-session control to `32` | save | write includes `memoryLimits.maxBytesPerSession` = 33554432 |
| F4 | Editing one control does not pin the others | decision-table | L1 | automated | user changes only `maxCachedSessions` | save | write includes `maxCachedSessions` only; not `maxTotalEventBytes`, not `maxBytesPerSession` |
| F5 | Unrelated Memory Limits field pins none of the new keys | decision-table | L1 | automated | user changes only `maxEventsPerSession` | save | write includes none of the three new keys |
| F6 | Restart-required is indicated | state-based | L1 | automated | user changes any of the three controls | change committed | restart-required badge shown, consistent with sibling controls |
| F7 | Sub-floor value is accepted as typed | BVA | L1 | automated | user types a per-session budget below the floor | save | value written as typed; no client-side clamp or block; hint states a floor applies |
| F8 | Byte-trimmed range still heals on resubscribe | state-convergence | L3 | automated | browser subscribed with a `lastSeq` inside a byte-trimmed range | resubscribe | server serves the events above `lastSeq` that remain; view converges with a gap, no error |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | All-pinned fallback spares essentials | fault-injection (state) | L1 | automated | every resident session pinned, global total over threshold | fallback reclaim runs | only non-essentials dropped; that session's `message_start` / `message_end` survive |
| X2 | Fallback reclaims below the budget, not to it | fault-injection (state) | L1 | automated | all pinned, over threshold | fallback runs | global total reclaimed to `budget - GLOBAL_TRIM_SLACK`; next insert does not re-trigger it |
| X3 | Exhausted fallback accepts overshoot and latches | fault-injection (state) | L1 | automated | all pinned, no non-essentials left to drop | fallback runs | essentials retained; total stays above budget; `globalBudgetExceeded` latch set |
| X4 | Latch clears on a state change | state-transition | L1 | automated | latch set | a buffer is deleted / a session unpins / the total falls below budget | latch clears and reclaim resumes on the next qualifying insert |
| X5 | Measurement stays bounded with the ceiling disabled | fault-injection (input) | L1 | automated | per-event ceiling 0; a deeply nested / very large payload | insert | measurement terminates at the finite fallback cap; accounted at cap + 1; no unbounded walk |
| X6 | History backfill degrades gracefully after a byte trim | fault-injection (state) | L3 | automated | session whose oldest events were released by a byte reclaim | client requests history older than the oldest retained event | exactly one `history_backfill_result`; returns what remains; signals no-further-history; no error, no hang |
| X7 | Cold-load hydration respects the budget | state-transition | L1 | automated | a transcript larger than `maxBytesPerSession` replayed through `insertEvent` | session cold-loads | insert loop completes; resident bytes within budget; restored depth is bounded by bytes rather than the count cap |

### Telemetry

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| T1 | Byte trim moves both counters | decision-table | L1 | automated | byte-triggered pass dropping N events / B bytes | pass runs | `trimmedBytes` += B; `trimmedEvents.total` += N |
| T2 | Count-only trim does not move the byte counter | decision-table | L1 | automated | count trim while the byte total is under budget | pass runs | `trimmedBytes` unchanged |
| T3 | Eviction is counted in bytes separately | decision-table | L1 | automated | whole-buffer global eviction | reclaim runs | `evictedBytes` += released bytes; `evictedSessions` += 1; `trimmedBytes` unchanged |
| T4 | Fallback reclaim counts as a byte trim | decision-table | L1 | automated | all-pinned fallback drops non-essentials | reclaim runs | `trimmedBytes` += released bytes |
| T5 | Health carries the new counter additively | state-based | L1 | automated | `/api/health` requested | route handler | `storeTrim.trimmedBytes` present; every prior `storeTrim` field present with its original name and type |
| T6 | Retention signals sit outside the counter struct | state-based | L1 | automated | `/api/health` requested | route handler | `storeRetention` carries `residentBytes`, effective budgets and `globalBudgetExceeded`; `storeTrim` carries none of them; `heapSizeLimit` beside the process gauges |
| T7 | Effective budget reflects the store's clamp | BVA | L1 | automated | configured per-session budget below the floor | `/api/health` requested | reported effective budget is the clamped value, not the configured one |
| T8 | Health fields are non-null on a running server | process smoke | L2 | automated | a booted dashboard server | `curl /api/health` | `storeRetention.residentBytes`, `storeRetention.effective.*` and `server.heapSizeLimit` present and non-null |

---

## Coverage summary

- Requirements covered: 7/7 (5 in `in-memory-event-buffer`, 2 in `settings-panel`)
- Scenarios by class: edge 22 · perf 4 · frontend 8 · error 7 · telemetry 8
- Scenarios by level: L1 44 · L2 1 · L3 2 · manual-only 1
- Scenarios by disposition: automated 48 · manual-only 1

## New infra needed

- none. L1 extends the existing `memory-event-store*` / `config` / settings
  vitest suites, L2 extends the existing qa health smoke, L3 extends the
  existing Playwright specs against the docker harness.
