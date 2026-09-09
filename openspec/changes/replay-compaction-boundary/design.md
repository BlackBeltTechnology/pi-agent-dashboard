# Design

## Context

Two independent paths build the same chat transcript:

| Path | Source | Compaction handling today |
|---|---|---|
| Live (warm) | pi events → bridge → server buffer → reducer | `session_compact` → divider row (`event-reducer.ts:2368`) |
| Server cold load | pi JSONL → `loadSessionEntries` → `replayEntriesAsEvents` → reducer | **nothing** — no `compaction` arm |
| Extension replay | `sessionManager.getBranch()` → `replayEntriesAsEvents` → `event_forward` | **nothing** — same missing arm |

`replayEntriesAsEvents` has two producers, not one: `session-load-worker.ts` (server, raw file) and `session-sync.ts:199 replaySessionEntries()` (extension, on register / reconnect / fork). One arm fixes both; every decision below must hold for both.

`replayEntriesAsEvents` exists precisely to make the cold path produce the events the live path would have produced (it already does this for `model_change` → `model_select`, `custom` → `custom_entry`, `custom_message` → `message_end{role:"custom"}`). The compaction gap is a missing arm in an established pattern, not a new mechanism.

## Decisions

### D1 — Synthesize the existing event, do not invent a new one

The arm emits `session_compact`. Rejected alternative: a new `compaction_replay` event plus a reducer case. That would duplicate the divider-rendering rule in two places and let live and cold render differently over time. Single-sourcing the rendering rule in the existing reducer arm is the same call the `custom_entry` replay path already made (`state-replay.ts`, "so replay and live reduce into the same row shape").

### D2 — Emit only fields the entry actually carries

Live `session_compact` data: `{ reason, willRetry, estimatedPostCompactionTokens }`. The persisted entry carries none of them (measured: all 141 entries have exactly `details, firstKeptEntryId, fromHook, id, parentId, summary, timestamp, tokensBefore, type`).

Do NOT fabricate a `reason`. The reducer's metadata block is guarded by `if (reason !== undefined || willRetry !== undefined || estimatedPostCompactionTokens !== undefined)`; with all three absent, `next.compaction` stays untouched and the row renders exactly as a legacy live event does. Absent ≠ wrong; a guessed `reason: "threshold"` would be wrong 100% of the time it disagreed with reality (`fromHook: true` on every observed entry — a custom compactor, not a pi threshold).

### D3 — `summary` is not rendered

The entry's `summary` is the LLM-context replacement text, often multi-KB. It is the *content* of the compaction, not its boundary. Rendering it would insert a large unlabelled block the live path never shows — a cold/warm divergence, the exact class of bug this change closes. Out of scope; if wanted later it is a UI feature with its own affordance (collapsed disclosure), specified separately.

### D4 — Position by iteration order, not by sort

The arm pushes inside the existing `for (const entry of entries)` loop, so the divider lands between the entries that precede and follow it in the branch — no timestamp sort, no seq rewrite. This matches every other arm and is why the flow-event arm's explicit `seq` sort is the exception, not the rule.

### D5 — No dedup logic, because register-time reset already guarantees it

The first draft argued "warm and cold are mutually exclusive per subscribe". That is true of the *server cold load* only and is NOT the argument that covers the extension producer, which replays on every reconnect regardless of buffer state. The actual guarantee is register-time:

- **Server cold load** — runs only when the events are absent from the in-memory buffer, and the result is buffered (`on-demand-session-replay`).
- **Extension replay** — always preceded by `session_register`, where the server takes exactly one of two branches (`event-wiring.ts:1281`): wipe the store + `broadcastSessionStateReset` (client resets and re-reduces the replay from scratch), or `skipReplayInsert` (bridge's `eventCount` matches `lastEntryCount` → replayed events are dropped, never inserted). Either branch is idempotent.

The synthesized `session_compact` rides that existing gate like every other replayed event; it needs no bookkeeping of its own. Worth stating the failure mode explicitly since the reducer's divider push has no idempotence (`id: compact-${messages.length}`, always appended): if that gate ever regressed, the symptom would be duplicate dividers — a visible, testable symptom, not silent corruption.

### D6 — The `compacting` latch clear is an accepted, bounded side effect

`session_compact` is not purely a render signal: `extractSessionUpdates` maps it to `{ compacting: false }` (`event-status-extraction.ts:100`), the latch the reload dispatcher reads to refuse a mid-compaction reload (`See change: fix-out-of-band-reload`), and that derivation runs on replayed events too (`event-wiring.ts:827` and `:910` — both the `skipReplayInsert` early-return and the main path).

So a reconnect whose replay carries an OLD compaction entry, landing while a NEW compaction is genuinely in flight, clears the latch early. Accepted rather than fixed here:
- the window is bounded by the in-flight compaction, and the real `session_compact` re-clears the latch at its end (self-healing, no stuck state);
- the correct fix is replay-gating the `compacting` derivation server-side — a change to existing live-path behavior, in a different package, for a pre-existing class of issue. Bundling it would violate the surgical-change rule.

Carried into `test-plan.md` as a scenario so the exposure is recorded rather than forgotten.

### D7 — `session_before_compact` parity is out of reach, and that is fine

Live, a compaction renders TWO rows: a raw JSON card for `session_before_compact` (no reducer case → default arm) and the divider. pi persists no before-compact entry, so replay can only ever produce the divider. Parity in this change is scoped to the `session_compact` row; the extra live card is a pre-existing divergence that this change narrows and does not widen.

## Open question — resolved before drafting, not deferred

The first draft deferred "does `getBranch()` return the pre-compaction entries?" to a task. It is answerable now: `appendCompaction` appends the compaction entry as a child of the current leaf, so the parent chain walked by `getBranch()` (extension) and by `loadSessionEntries` (server, leaf-heuristic + parentId walk) still reaches the earlier messages. Confirmed against real transcripts — 96 of 170 compaction-bearing session files carry content on both sides of the marker. The divider lands between content; the degenerate "lone divider at the top" case does not arise. Task 1.1 is now a fixture assertion, not an investigation.

## Out of scope

- `tokensBefore` → a "compacted N→M tokens" badge (needs a new reducer read of `data.preCompactionTokens`; separate change).
- `thinking_level_change` cold-replay parity.
- Subscribing `after_provider_response` / `before_provider_headers`.
