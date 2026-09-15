## 1. Config surface (`packages/shared`, `packages/server/src/config-api.ts`)

- [ ] 1.1 Test loader — `packages/shared/src/__tests__/` memory-limits pattern: absent → `67108864`; `0` → `0`; `-1` / `"x"` → default; `1000` (below `4 × 262144`) → clamped to `1048576`. Verify red first.
- [ ] 1.2 Implement `MemoryLimitsConfig.maxBytesPerSession` + `DEFAULT_MEMORY_LIMITS.maxBytesPerSession = 64 MiB` in `memory-limits.ts`; loader branch in `config.ts` with the floor clamp (D5/D6). Verify 1.1 green; `writeConfigPartial` round-trip test (`config-api.test.ts`) still green with the new key present.

## 2. Store accounting (`packages/server/src/persistence/memory-event-store.ts`)

- [ ] 2.1 Test near-ceiling flood stays under budget — `memory-event-store.test.ts`: budget 1 MiB, ceiling 256 KiB, count cap 100 000; insert 100 × ~200 KiB non-essential events · `getBufferBytes(sid) ≤ 1 MiB + byteSlack` after every insert; surviving seqs are the newest. Verify red first.
- [ ] 2.2 Test chat head survives a byte trim — seq 1 `message_start`, seq 2 `message_end`, then large updates past budget · seq 1, 2 present. Verify red first.
- [ ] 2.3 Test budget `0` disables — 100 × 200 KiB with `maxBytesPerSession = 0` and count cap 100 · all 100 resident. Verify red first.
- [ ] 2.4 Test accounting exact after every removal path — one test driving count trim, `collapseSuperseded`, `collapseOnEnd`, `deleteEventsForSession`; after each step `getBufferBytes(sid) === Σ e.bytes over getEvents(sid, 0)`. Verify red first.
- [ ] 2.5 Test bulk-load linearity — reuse the existing trim-linearity probe pattern: insert 10 000 events under a trimming budget · trim passes ≈ inserts / slack, not per insert. Verify red first.
- [ ] 2.6 Implement D1–D3: `StoredEvent.bytes`, `SessionBuffer.bytes`, measure in `insertEvent` via `measureBytes`, `trimBufferToLimit(buf, {maxEvents, maxBytes})` returning `bytesDropped`, hysteretic trigger with `byteSlack`, decrement in `dropIfSuperseded` and `deleteEventsForSession` (eviction drops the buffer whole). Verify 2.1–2.5 green and the full existing `memory-event-store*` suite green.
- [ ] 2.7 Test byte-trim leaves a healable gap — subscribe-with-`lastSeq` inside a byte-trimmed range returns the remaining events above `lastSeq` (subscription-handler test pattern, or store-level `getEvents(sid, lastSeq)` if the handler test is heavy). Verify green.

## 3. Telemetry (`memory-event-store.ts`, `packages/server/src/routes/system-routes.ts`)

- [ ] 3.1 Test counters — byte trim of N events / B bytes · `trimmedBytes += B`, `trimmedEvents.total += N`; count trim under budget · `trimmedBytes` unchanged. Verify red first.
- [ ] 3.2 Test `/api/health` carries `storeTrim.trimmedBytes` additively — existing health-route test: every prior field present with same type, new field present. Verify red first.
- [ ] 3.3 Implement D4: `TrimStats.trimmedBytes`, `EMPTY_TRIM_STATS`, test-only `getBufferBytes(sessionId)` probe. Verify 3.1–3.2 green.

## 4. Wiring + Settings (`server.ts`, `packages/client/src/components/settings/`)

- [ ] 4.1 Implement: thread `config.memoryLimits.maxBytesPerSession` into `createMemoryEventStore` as the next positional parameter (default `DEFAULT_MAX_BYTES_PER_SESSION`). Verify server boots (`curl /api/health`) and `server.test.ts` green.
- [ ] 4.2 Test settings control — `settings-field-contract.test.tsx` pattern: config `33554432` renders `32`; absent renders `64`; edit to `32` + Save writes `memoryLimits.maxBytesPerSession: 33554432` and no other `memoryLimits` key; changing only `maxEventsPerSession` does not include it; restart-required badge shown. Verify red first.
- [ ] 4.3 Implement the control in `SettingsPanel.tsx` Memory Limits section with MiB ↔ bytes conversion at the edge; i18n keys with English fallback in every locale file. Verify 4.2 green and `settings-bespoke-validation.test.tsx` green.

## 5. Docs + closeout

- [ ] 5.1 Delegate to `DocScribe`: `docs/architecture.md` memory-limits table row for `maxBytesPerSession` (default, shed order, `0`); one line in the event-store section. Verify grep finds the key in `docs/architecture.md`.
- [ ] 5.2 Update `packages/server/src/persistence/memory-event-store.ts.AGENTS.md` (bytes accounting, generalized trim, `trimmedBytes`, probe), `packages/shared/src/AGENTS.md` (`memory-limits.ts` row), `packages/server/src/routes/AGENTS.md` (`system-routes.ts` `EMPTY_TRIM_STATS`), client settings `AGENTS.md`. Verify `kb dox lint` clean.
- [ ] 5.3 Full suite `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean.
- [ ] 5.4 Comment on #425 with the change name.
