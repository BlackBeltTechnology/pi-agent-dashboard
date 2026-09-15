## Why

`memory-event-store` bounds each session by event COUNT (`maxEventsPerSession`, default 20 000) and each event by SIZE (`maxEventDataSize`, 256 KiB) but never by their PRODUCT: one session may legally retain ~5.2 GB of serialized event data (#425). `fit-attachments-for-display` raised the per-event ceiling 20 000 → 262 144 bytes and recorded the ~13× envelope growth as a conscious, deferred trade-off. Nothing in the store tells an operator how close a session is to that envelope, and the only reclaim is the count trim, which does not fire at all while a session is under 20 000 events — so 20 000 near-ceiling events (a subagent flood with large tool results, or a transcript replay of one) is a heap the process cannot shed.

## What Changes

- **Aggregate byte budget per session.** The store SHALL track the serialized byte size of every retained event and the running total per session buffer, and SHALL bound that total to a new `maxBytesPerSession` limit (default 64 MiB, `0` = unlimited) using the SAME shed policy the count trim already uses: drop the oldest non-essential events first, essential chat events (`message_start` / `message_end` / inline-terminal pair) only under pressure. Trim is hysteretic (a byte slack proportional to the budget) so it stays amortized O(1) per insert like the count trim.
- **Bytes stay exact under every mutation.** The byte total SHALL be decremented on every path that removes a retained event — count trim, byte trim, superseded-update collapse, end-triggered tail drop, `deleteEventsForSession`, LRU eviction — so it can never drift from the sum of what is resident.
- **Telemetry.** `TrimStats` gains an additive `trimmedBytes` counter (bytes released by byte-triggered trims) and the per-session `bySession` map keeps counting events; `/api/health` `storeTrim` carries the new field; `getBufferStats(sessionId)` (or equivalent test-only probe) exposes resident bytes so the regression gate can assert the bound.
- **Config surface.** `memoryLimits.maxBytesPerSession` in `config.json`, browser-safe default in `memory-limits.ts`, one numeric control in Settings ▸ Memory Limits beside `maxEventsPerSession`, live via `PUT /api/config` like its siblings.

Replay semantics are unchanged by construction: a byte trim removes events exactly the way the count trim does today (seq gaps, `getEvents` filters by seq, holey-store backfill already handles gaps, originals recover from the transcript per attachment-storage D7), so no new hole class is introduced.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `in-memory-event-buffer`: new requirement — per-session aggregate serialized-byte budget with the chat-head-preserving shed policy, exact accounting under every removal path, hysteresis, and the additive `storeTrim.trimmedBytes` telemetry field.
- `settings-panel`: the Memory Limits section exposes `maxBytesPerSession`.

## Impact

- `packages/server/src/persistence/memory-event-store.ts` — `StoredEvent` gains `bytes`; `SessionBuffer` gains `bytes`; `insertEvent` measures post-truncation size via the existing `measureBytes`; `trimBufferToLimit` generalized to a bytes target; every splice/delete path decrements; `TrimStats`/`EMPTY_TRIM_STATS` extended.
- `packages/shared/src/memory-limits.ts`, `packages/shared/src/config.ts` (loader + `DEFAULT_MEMORY_LIMITS`), `packages/server/src/config-api.ts` (partial write).
- `packages/server/src/server.ts` — thread the new limit into `createMemoryEventStore`.
- `packages/server/src/routes/system-routes.ts` — `EMPTY_TRIM_STATS` fallback shape.
- `packages/client/src/components/settings/SettingsPanel.tsx` + field-contract tests.
- `docs/architecture.md` memory-limits table; directory `AGENTS.md` rows.

## Discipline Skills

- `performance-optimization` — the store is on the hot insert path; the budget accounting must stay O(1) per insert and the trim amortized; measured with the existing trim-cost probes.
- `doubt-driven-review` — a retention change affects every event type; reviewed before it stands for replay-hole and accounting-drift traps.
- `review-code` — before commit.
