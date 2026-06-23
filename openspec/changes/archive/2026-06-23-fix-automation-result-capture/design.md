## Context

`result.md` capture lives entirely in the automation-plugin server entry (`packages/automation-plugin/src/server/index.ts`). The flow:

1. On `session_register` the host stamps the spawned session with `automationRun`. The plugin's `onEvent` correlates by `automationRun.runId` (commit 5009b883) and calls `ctx.sendToSession(sessionId, promptText)` to deliver the action prompt, then `runText.set(sessionId, [])`.
2. For every subsequent forwarded event on a tracked session, `extractAssistantText(event)` is pushed into `runText[sessionId]`.
3. On `agent_end`, `runText[sessionId]` is joined and handed to `engine.onSessionEnded(sessionId, result)` which writes `result.md` (empty → auto-archive).

The defect is step 2's extractor. Two compounding problems, confirmed against the run session `019ef1f5-8850-7609-ad1d-6b1cca4b1a6c`:

- **Array content dropped.** Persisted messages carry `content` as an array of blocks:
  ```jsonc
  { "type": "message", "message": { "role": "assistant", "content": [{ "type": "text", "text": "PONG" }] } }
  ```
  The extractor only accepts a *string* `content`/`text`, so the assistant reply yields `null` and is never captured.
- **Prompt leaks in.** The injected prompt (step 1, `sendToSession`) round-trips as a differently-shaped forwarded event (string text, no explicit assistant role). The guard rejects only *explicit* non-assistant roles, so the prompt passes and is buffered; `agent_end` flushes it to `result.md`.

The persisted JSONL shape above is the on-disk record; the **forwarded wire event** the plugin's `onEvent` actually receives may differ and MUST be captured live before pinning the extractor (task 1.1).

## Goals / Non-Goals

- Goal: `result.md` contains the run's assistant output only.
- Goal: the injected action prompt never appears in `result.md`.
- Goal: empty/again-no-findings runs still flush empty → auto-archive.
- Non-Goal: changing the on-disk format, location, retention, correlation, or the ChatView live transcript (the transcript already renders correctly; only the captured summary is wrong).
- Non-Goal: capturing tool calls or reasoning — `result.md` is the assistant's textual findings.

## Decisions

### Decision 1: Anchor capture to the verified assistant-output event shape

Before coding, enumerate the real event shapes pi forwards for the run session (instrument `ctx.onEvent` once against a live run, or read pi's event contract). Capture text only from the event(s) that carry assistant message output. Treat a role-less text event as NON-assistant (invert the current lenient guard): require `role === "assistant"` explicitly, or match the specific assistant message `eventType`. Extraction MUST handle the array-of-blocks `content` shape — concatenate the `text` of `{type:"text"}` blocks — not only string content.

Rationale: the empirical failure (prompt captured, `PONG` reply discarded because its `content` is a block array) proves the current heuristic both over-captures the prompt and under-captures the reply. Pinning to the actual assistant event shape AND handling array content fixes both.

### Decision 2: Exclude the injected prompt by identity, defensively

Even with a tightened role guard, belt-and-suspenders: the plugin knows the exact `promptText` it injected per run. The capture path MAY skip any captured chunk equal to the run's injected `promptText`. This guarantees the prompt cannot leak even if pi's input-echo event ever carries an `assistant`-ish shape.

Rationale: cheap, run-scoped, and immune to future event-shape drift.

### Decision 3: Keep the buffer + agent_end flush model

No change to buffering/flush/auto-archive. Only the per-event predicate (what counts as capturable assistant text) changes. This keeps the diff surgical and preserves the existing concurrency/runId-keyed semantics.

## Risks / Trade-offs

- Risk: pi's assistant-output event shape differs across versions. Mitigation: verify against the live event stream before pinning; keep extraction tolerant to the known assistant shapes (`data.text`, `data.message.content`) but gated on an explicit assistant role / eventType.
- Risk: a model that legitimately repeats the prompt verbatim would be filtered by Decision 2. Accepted — vanishingly rare and harmless for a findings summary.

## Verification

- Unit test: feed `[injected-prompt echo event, assistant reply event, agent_end]` → `result.md` == reply, excludes prompt.
- Unit test: feed `[injected-prompt echo event, agent_end]` (no assistant reply) → empty → run auto-archived.
- Live: re-run the PONG automation; `result.md` == `PONG`.

## Live finding (task 1.1) — anchor is `turn_end`, NOT `message_end`

The Decision 1 hypothesis (capture on assistant `message_end`) was WRONG. Live
instrumentation of `ctx.onEvent` against a Gemini PONG run in the Docker test
harness shows the run session forwards assistant output as:

```text
message_start { message:{ role:"assistant", content:[] } }
message_update { message:{ role:"assistant", content:[{type:"thinking",...}] } }   (×N, streaming)
message_update { message:{ role:"assistant", content:[{type:"thinking",...},{type:"text",text:"PONG"}] } }
turn_end       { message:{ role:"assistant", content:[{type:"thinking",...},{type:"text",text:"PONG"}] } }
agent_end      { messages:[ ... ] }
```

Key facts:
- NO assistant `message_end` is emitted. Only USER messages emit
  `message_start`/`message_end`. The original code captured nothing because it
  required `message_end` (which only carried the user prompt, rejected by role)
  and could not read array `content`.
- The injected prompt is delivered as an `input` event PLUS a user
  `message_start`/`message_end` — never a `turn_end`.
- `turn_end` carries the FINALIZED assistant message exactly once per turn.

Resolution: anchor capture on `turn_end` + `role==="assistant"`, concatenating
`{type:"text"}` blocks (so `thinking` blocks drop). `message_update` is ignored
(streaming dup). Verified live: `result.md` == `PONG`, prompt absent,
`GET /api/plugins/automation/result` → `{"result":"PONG\n"}`.
