# Measurements — compact-warm-replay-stream (issue #399)

Reproduce: `node scripts/measure-replay-compaction.mjs [session.jsonl]`

## Synthetic #399-shaped warm window

140 assistant messages × ~150 cumulative snapshot updates — the shape a live
session accumulates in `createMemoryEventStore`.

| metric | before | after | reduction |
|---|---|---|---|
| events replayed | 21 420 | 420 | **98.0 %** |
| wire bytes | 6.26 MB | 0.10 MB | **98.4 %** |
| batches (50 → 200) | 429 | 3 | **99.3 %** |

`compactEventsForReplay` wall time on the 21 420-event window: **2.2–2.7 ms**,
single O(n) pass. Gated at L1 by P3 (p95 < 50 ms).

Each batch is one client React commit, so the batch-count collapse (429 → 3) is
the half of #399 the user actually perceives as "reopening is slow".

## Real persisted session (cold path, reference)

`~/.pi/agent/sessions/…/2026-06-08T23-26-09-633Z_019ea98e-….jsonl`

| metric | value |
|---|---|
| persisted entries | 611 |
| cold-load events synthesized (`state-replay.ts`) | 1 428 |
| cold-load events **after** compaction | 1 428 |
| cold wire bytes | 0.06 MB |

The cold path emits exactly one `message_update` + `message_end` per assistant
message, so nothing is superseded and **compaction is a verified no-op there**.

### Resolves the design's open question

> *"Should compaction also apply to the cold-load replay path? … applying it
> uniformly is simpler and is the current plan."*

Confirmed empirically: 1 428 → 1 428 events, byte-identical. Applying the pass
uniformly to both replay paths is safe and needs no special-casing.

## Thinking policy (D2)

Decided by `replay-compaction-equivalence.test.ts`, not by assumption:
**exempt thinking-bearing `message_update`s**. Dropping them is NOT
state-equivalent — the live path builds a `thinking` row carrying `startedAt` +
`duration`, while the `message_end` reconstruction path
(`reconstruct-reasoning-on-replay`) rebuilds it without them. The test asserts
the shipped policy is deep-equal AND that the alternative is not.

## Rule narrowing found by the equivalence gate (D1)

The naive positional rule broke the `[text, toolCall, text]` fixture: at
`tool_execution_start` the reducer flushes `streamingText` into a row keyed
`flush-<toolCallId>`; with every preceding update dropped, `streamingText` is
empty, no flush happens, and the row is instead appended at `message_end` with a
different id and position. The rule therefore also retains **the last text
`message_update` before each `tool_execution_start`** — at most one extra event
per tool call, which the numbers above already include.
