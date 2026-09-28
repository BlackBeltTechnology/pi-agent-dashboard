# Tasks — fix-model-proxy-stream-lifecycle

## 1. Isolation test harness

- [x] 1.1 `__tests__/model-proxy-parallel-isolation.test.ts`: real listening Fastify, echo fake with a start barrier (asserts `maxInFlight === N`), unique secret per conversation
- [x] 1.2 OpenAI non-streaming, mixed OpenAI + Anthropic SSE, multi-turn: no cross-talk upstream or downstream; message ids unique per response
- [x] 1.3 Per-key cap isolation (`KEY_FULL` for a saturated key, `200` for another key, slots released)

## 2. System prompt reaches the provider

- [x] 2.1 Red: `streamer.test.ts` `callPiAiStreamSimple` maps `system` → `Context.systemPrompt`
- [x] 2.2 Add `callPiAiStreamSimple`; use it in both `/v1` wirings in `server.ts`

## 3. Disconnect aborts upstream

- [x] 3.1 Red: abort test (both endpoints). Victim upstream aborted, survivors complete un-aborted
- [x] 3.2 Detect disconnect via `reply.raw` "close" && `!writableFinished`

## 4. Mid-stream failure terminates the stream

- [x] 4.1 Red: upstream throws after the first delta. Client hung + `ERR_HTTP_HEADERS_SENT`
- [x] 4.2 On throw with headers sent, emit the converter `error` event and `reply.raw.end()` (both endpoints)

## 5. Close-out

- [x] 5.1 AGENTS.md rows (`model-proxy/AGENTS.md`, `model-proxy-routes.ts.AGENTS.md`), CHANGELOG `[Unreleased] → Fixed`
- [x] 5.2 Biome clean on changed lines; tsc error count unchanged; model-proxy suite green; server restarted
