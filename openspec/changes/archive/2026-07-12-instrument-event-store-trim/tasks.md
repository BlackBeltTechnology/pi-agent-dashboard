# Tasks

## 1. Instrument the store (observability-instrumentation) — ADD
- [x] 1.1 `trimBufferToLimit(buf, cap)` returns `{ dropped, toolEndDropped }` —
  counting `tool_execution_end` among dropped entries in the existing single pass
  (no second scan; preserve the O(n)-amortized contract from
  `preserve-chat-head-on-event-trim`).
- [x] 1.2 `evictIfNeeded()` returns the number of session buffers it deleted.
- [x] 1.3 Add closure counters in `createMemoryEventStore`: `trimmedEventsTotal`,
  `trimmedToolEndTotal`, `trimmedEventsBySession` (Map), `evictedSessionsTotal`;
  accumulate them in `insertEvent` from the two return values (per-session tally
  keyed by the sessionId `insertEvent` already has).
- [x] 1.4 Add `getTrimStats()` to the returned store handle →
  `{ trimmedEvents: { total, toolExecutionEnd, bySession }, evictedSessions }`.

## 2. Surface on `/api/health` — ADD
- [x] 2.1 Add `eventStore` to the `registerSystemRoutes` deps (server.ts call
  site ~1132) and destructure it in `system-routes.ts`.
- [x] 2.2 In the `/api/health` handler, add `storeTrim:
  eventStore.getTrimStats?.() ?? { trimmedEvents: { total: 0, toolExecutionEnd: 0,
  bySession: {} }, evictedSessions: 0 }` next to `droppedFrames`. Additive; leave
  every existing field unchanged.

## 3. Tests
- [x] 3.1 Store unit test: insert past `maxEventsPerSession + trimSlack` with a
  mix incl. `tool_execution_end` → `getTrimStats().trimmedEvents.total > 0` and
  `.toolExecutionEnd` counts exactly the dropped terminal events; `bySession`
  attributes to the right session.
- [x] 3.2 Store unit test: exceed `maxCachedSessions` → `evictedSessions`
  increments; a session under both caps yields all-zero stats (no false counts).
- [x] 3.3 Health-route test (extend `system-routes`/health test): `/api/health`
  returns a `storeTrim` object with the four fields; zero when nothing trimmed.

## 4. Validate
- [x] 4.1 `npm test` green (new store + health tests, existing suites). New
  store-trim + health-shape tests pass; the only red files are pre-existing
  flaky server-startup 5000ms timeouts (pass in isolation) and pre-existing
  `image-fit-extension` jimp errors — both untouched by this change.
- [x] 4.2 `openspec validate instrument-event-store-trim --strict`.
- [x] 4.3 `npm run quality:changed` clean (tsc --noEmit; full suite; zero new
  Biome warnings on changed lines). Root `tsc --noEmit` reports no error in any
  changed file; Biome clean on all added lines (sole warning is the pre-existing
  `truncateStrings` cognitive-complexity note, untouched).

## 5. Decision follow-through (not code)
- [x] 5.1 After a real-usage window, read `/api/health#storeTrim` on the live
  server. If `trimmedEvents.toolExecutionEnd` stays 0 → the deferred Gate B
  backstop (`fix-stuck-tool-card-superseded-heal` design.md "Deferred") is not
  justified; record the verdict. If it climbs → scope the backstop with this data.
