## 1. Config surface (`packages/shared`, `packages/server/src/config-api.ts`)

- [ ] 1.1 Test loader — `packages/shared/src/__tests__/` memory-limits pattern: absent → `33554432`; `0` → `0`; `-1` / `"x"` → default; `1000` (below `4 × 262144`) → clamped to `1048576`. Verify red first.
- [ ] 1.2 Implement `MemoryLimitsConfig.maxBytesPerSession` + `DEFAULT_MEMORY_LIMITS.maxBytesPerSession = 32 MiB` in `memory-limits.ts`; loader branch in `config.ts` with the floor clamp (D5/D6). Verify 1.1 green; `writeConfigPartial` round-trip test (`config-api.test.ts`) still green with the new key present.
- [ ] 1.3 Test loader for the two new keys — `maxTotalEventBytes`: absent → `805306368`, `0` → `0`, garbage → default; `maxCachedSessions`: absent → `32`, `0`/negative/garbage → default, `1` honoured. Verify red first.
- [ ] 1.4 Implement `MemoryLimitsConfig.maxTotalEventBytes` (768 MiB) and `maxCachedSessions` (32) in `memory-limits.ts` + `config.ts` loader (D7/D8). Verify 1.3 green.

## 2. Store accounting (`packages/server/src/persistence/memory-event-store.ts`)

- [ ] 2.1 Test near-ceiling flood stays under budget — `memory-event-store.test.ts`: budget 1 MiB, ceiling 256 KiB, count cap 100 000; insert 100 × ~200 KiB non-essential events · `getBufferBytes(sid) ≤ 1 MiB + byteSlack` after every insert; surviving seqs are the newest. Verify red first.
- [ ] 2.2 Test chat head survives a byte trim — seq 1 `message_start`, seq 2 `message_end`, then large updates past budget · seq 1, 2 present. Verify red first.
- [ ] 2.3 Test budget `0` disables — 100 × 200 KiB with `maxBytesPerSession = 0` and count cap 100 · all 100 resident. Verify red first.
- [ ] 2.4 Test accounting exact after every removal path — one test driving count trim, `collapseSuperseded`, `collapseOnEnd`, `deleteEventsForSession`; after each step `getBufferBytes(sid) === Σ e.bytes over getEvents(sid, 0)`. Verify red first.
- [ ] 2.5 Test bulk-load linearity — reuse the existing trim-linearity probe pattern: insert 10 000 events under a trimming budget · trim passes ≈ inserts / slack, not per insert. Verify red first.
- [ ] 2.6 Implement D1–D3: `StoredEvent.bytes`, `SessionBuffer.bytes`, measure in `insertEvent` via `measureBytes`, `trimBufferToLimit(buf, {maxEvents, maxBytes})` returning `bytesDropped`, hysteretic trigger with `byteSlack`, decrement in `dropIfSuperseded` and `deleteEventsForSession` (eviction drops the buffer whole). Verify 2.1–2.5 green and the full existing `memory-event-store*` suite green.
- [ ] 2.7 Test global budget evicts LRU-first — `maxTotalEventBytes` 4 MiB, per-session budget 0 (off), count cap high; fill 4 unpinned sessions × ~1.5 MiB · global total ≤ 4 MiB + slack, the least-recently-accessed buffers gone, newest intact. Verify red first.
- [ ] 2.8 Test pinned sessions survive global reclaim — same setup, LRU session pinned via `isSessionPinned` · pinned buffer resident, an unpinned newer one evicted. Verify red first.
- [ ] 2.9 Test all-pinned fallback — every session pinned and over budget · the LRU pinned session is byte-reclaimed, global total ≤ budget + slack (budget is a bound, not a hint). Verify red first.
- [ ] 2.10 Test global budget `0` disables global reclaim · all buffers resident. Verify red first.
- [ ] 2.11 Implement D7: incremental global total maintained from the per-session totals (no walk), decremented on every removal path incl. LRU eviction; LRU-first whole-buffer eviction skipping pinned; all-pinned byte-reclaim fallback. Verify 2.7–2.10 green and the full existing `memory-event-store*` suite green.
- [ ] 2.12 Test accounting exactness extends to the global total — after driving every removal path, global total `===` Σ per-session totals `===` Σ resident `e.bytes`. Verify red first, then green against 2.11.
- [ ] 2.13 Test byte-trim leaves a healable gap — subscribe-with-`lastSeq` inside a byte-trimmed range returns the remaining events above `lastSeq` (subscription-handler test pattern, or store-level `getEvents(sid, lastSeq)` if the handler test is heavy). Verify green.

## 3. Telemetry (`memory-event-store.ts`, `packages/server/src/routes/system-routes.ts`)

- [ ] 3.1 Test counters — byte trim of N events / B bytes · `trimmedBytes += B`, `trimmedEvents.total += N`; count trim under budget · `trimmedBytes` unchanged. Verify red first.
- [ ] 3.2 Test `/api/health` carries `storeTrim.trimmedBytes` additively — existing health-route test: every prior field present with same type, new field present. Verify red first.
- [ ] 3.3 Implement D4: `TrimStats.trimmedBytes`, `EMPTY_TRIM_STATS`, test-only `getBufferBytes(sessionId)` probe. Verify 3.1–3.2 green.
- [ ] 3.4 Test `/api/health` exposes retention + heap headroom additively — `storeTrim.residentBytes` (global) and `server.heapSizeLimit` present with correct types, every prior field unchanged. `heapSizeLimit` is absent today, so no client can compute headroom. Verify red first.
- [ ] 3.5 Implement 3.4 via `v8.getHeapStatistics().heap_size_limit` and the store's global total. Verify green; `curl /api/health | jq '.server.heapSizeLimit, .storeTrim.residentBytes'` non-null on the live server.
- [ ] 3.6 Test heap-pressure shedding — injected heap-usage probe reporting >85 % of the ceiling · reclaim targets a fraction of the configured budget instead of the steady-state budget; at <85 % behaviour is unchanged. Verify red first, then implement.

## 4. Wiring + Settings (`server.ts`, `packages/client/src/components/settings/`)

- [ ] 4.1 Implement: thread `config.memoryLimits.maxBytesPerSession`, `maxTotalEventBytes` and `maxCachedSessions` into `createMemoryEventStore`, REPLACING the hardcoded `undefined, // maxCachedSessions (use default)` at `server.ts:925`. Verify server boots (`curl /api/health`) and `server.test.ts` green.
- [ ] 4.2 Test settings controls — `settings-field-contract.test.tsx` pattern: `maxBytesPerSession` config `33554432` renders `32`, absent renders `32`; `maxTotalEventBytes` `805306368` renders `768`; `maxCachedSessions` absent renders `32`; editing only one writes only that key; changing only `maxEventsPerSession` includes none of them; restart-required badge shown. Verify red first.
- [ ] 4.3 Implement the three controls in `SettingsPanel.tsx` Memory Limits section with MiB ↔ bytes conversion at the edge; hints per the settings-panel spec (global bound evicts whole idle sessions; evicted sessions re-read from transcript); i18n keys with English fallback in every locale file. Verify 4.2 green and `settings-bespoke-validation.test.tsx` green.

## 5. Docs + closeout

- [ ] 5.1 Delegate to `DocScribe`: `docs/architecture.md` memory-limits table rows for `maxBytesPerSession`, `maxTotalEventBytes`, `maxCachedSessions` (defaults, shed order, `0`); one line in the event-store section noting the envelope is the PRODUCT of the per-session budget and the resident count. Verify grep finds all three keys in `docs/architecture.md`.
- [ ] 5.2 Update `packages/server/src/persistence/memory-event-store.ts.AGENTS.md` (bytes accounting, generalized trim, `trimmedBytes`, probe), `packages/shared/src/AGENTS.md` (`memory-limits.ts` row), `packages/server/src/routes/AGENTS.md` (`system-routes.ts` `EMPTY_TRIM_STATS`), client settings `AGENTS.md`. Verify `kb dox lint` clean.
- [ ] 5.3 Full suite `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean.
- [ ] 5.4 Comment on #425 with the change name.
- [ ] 5.5 Manual: after the live server has run ≥24 h on the new defaults, confirm `storeTrim.residentBytes` holds under `maxTotalEventBytes`, `evictedSessions` is now non-zero, and `heapUsed` no longer trends toward the ceiling. Compare against the pre-change baseline (686 MB strings / 798 MB live set / `evictedSessions = 0`).
