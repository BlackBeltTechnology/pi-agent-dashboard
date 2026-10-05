# token-stats-pipeline Specification

## Purpose

End-to-end pipeline for extracting, forwarding, accumulating, and displaying per-turn token usage statistics from pi sessions.

## Requirements

### Requirement: Stats extraction from turn_end events
The server SHALL extract token usage stats from forwarded `turn_end` events by reading `event.message.usage`, and SHALL synthesize the `stats_update` event from them (the bridge forwards the event; it does not send `stats_update` itself). The extracted data SHALL include: `tokensIn` (input tokens), `tokensOut` (output tokens), `cost` (from `usage.cost.total`), per-turn breakdown (`turnUsage` with input, output, cacheRead, cacheWrite), and optionally `contextUsage` from the forwarded event, which the bridge enriches from `ctx.getContextUsage()`.

#### Scenario: Turn ends with usage data
- **WHEN** a `turn_end` event fires with `message.usage` containing token counts
- **THEN** the server SHALL extract stats and synthesize a `stats_update` event

#### Scenario: Turn ends without usage data
- **WHEN** a `turn_end` event fires but `message.usage` is undefined
- **THEN** the server SHALL NOT synthesize a `stats_update` event from it

#### Scenario: Context usage included
- **WHEN** `ctx.getContextUsage()` returns `{ tokens: 50000, contextWindow: 200000 }`
- **THEN** the `stats_update` message SHALL include `contextUsage` with those values

### Requirement: Server-side token accumulation
The server SHALL accumulate token stats on the session record. For every usage it extracts — from a forwarded `turn_end`, a forwarded tool-result `message_end`, or a forwarded `usage_recorded` event — the server SHALL add the values to the session's running totals (`tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`) before synthesizing the corresponding `stats_update`.

#### Scenario: First turn stats received
- **WHEN** a session's first extracted usage has `tokensIn: 1000, tokensOut: 500, cost: 0.01`
- **THEN** the session record SHALL be updated to `tokensIn: 1000, tokensOut: 500, cost: 0.01`

#### Scenario: Subsequent turn accumulates
- **WHEN** a second extracted usage has `tokensIn: 2000`
- **THEN** the session's `tokensIn` SHALL be `3000` (1000 + 2000)

#### Scenario: Non-turn usage accumulates cache tokens
- **WHEN** a `usage_recorded` event with `cacheRead: 50000` and `cost.total: 0.015` arrives
- **THEN** the session's `cacheRead` SHALL increase by `50000` and its `cost` by `0.015`

### Requirement: Stats broadcast to browsers
After accumulating stats, the server SHALL broadcast the updated session totals to all connected browsers via `session_updated`. Additionally, the raw `stats_update` event SHALL be stored in the event buffer and broadcast as an `event` to subscribers for the token stats bar chart.

#### Scenario: Stats update triggers session update
- **WHEN** a `stats_update` is processed
- **THEN** a `session_updated` message with the new totals SHALL be broadcast to all browsers

#### Scenario: Stats event stored for replay
- **WHEN** a `stats_update` is processed
- **THEN** a `stats_update` event SHALL be inserted into the event store and broadcast to session subscribers

### Requirement: Event status extraction
The server SHALL extract session status changes from forwarded events and apply them to the session record:
- `agent_start` → `status: "streaming"`, `currentTool: undefined`
- `agent_end` → `status: "idle"`, `currentTool: undefined`
- `tool_execution_start` without `parentToolCallId` → `currentTool: <toolName>`
- `tool_execution_end` without `parentToolCallId` → `currentTool: undefined`
- `tool_execution_*` with `parentToolCallId` (a nested call) → no change to `currentTool`
- `model_select` → `model: "<provider>/<id>"`, optionally `thinkingLevel`

#### Scenario: Agent starts streaming
- **WHEN** an `agent_start` event is forwarded
- **THEN** the session status SHALL change to `"streaming"`

#### Scenario: Tool execution tracked
- **WHEN** a `tool_execution_start` event with `toolName: "read"` is forwarded
- **THEN** the session's `currentTool` SHALL be set to `"read"`

#### Scenario: Model change detected
- **WHEN** a `model_select` event with `model: { provider: "anthropic", id: "claude-4" }` is forwarded
- **THEN** the session's `model` SHALL be updated to `"anthropic/claude-4"`

#### Scenario: Nested end does not clear the parent
- **WHEN** `currentTool` is `codemode` and a nested `tool_execution_end` carrying `parentToolCallId` arrives
- **THEN** `currentTool` SHALL remain `codemode`

### Requirement: Session totals include non-message usage

Session token and cost totals SHALL include all model-attributed usage pi records, not only assistant-message usage:
- `usage` session entries (for example `kind: "cache_warm"`; unknown `kind` values SHALL count as normal usage),
- the `usage` field of compaction and branch-summary entries,
- usage carried on tool-result messages (for example codemode `models.classify()` and `models.generateImages()`).

Each kind SHALL be counted from exactly one source; `turn_end.toolResults` SHALL NOT be counted. Input, output, cache-read, cache-write and cost SHALL all be counted for every kind. Only assistant-message usage SHALL update the context-usage estimate.

**Live path — tool results.** The server SHALL count usage on a forwarded `message_end` only when `message.role` is `"toolResult"`, reading it from the forwarded event as received. A forwarded assistant `message_end` SHALL NOT be counted; `turn_end` is the only source of assistant usage.

**Live path — entries.** The bridge SHALL forward each `usage`, `compaction` or `branch_summary` entry carrying usage as a `usage_recorded` event with the kind, the usage, and the provider and model when the entry has them. It SHALL NOT forward message entries. It reads `ctx.sessionManager.getEntries()` past a cursor holding the session id and the last forwarded entry id, at `turn_end`, `agent_settled`, `cache_warming_decision` and `session_shutdown`; the shutdown drain SHALL be sent before the bridge's `session_unregister`, including on session replacement (`reason` `new`, `resume`, `fork`) and reload. On bridge initialisation (including reload) and on a session change, the bridge SHALL, from one `getEntries()` snapshot, set the cursor to the snapshot's last entry, forward nothing from it, and send the snapshot's full totals (every kind) as `usageSeed` with `session_register`. A reconnect SHALL NOT move the cursor. If the last forwarded entry id is no longer present, the cursor SHALL re-baseline to the current last entry and forward nothing. The cursor SHALL be keyed by session id, not by session-file path (pi creates the file lazily).

**Synthesis.** The server SHALL accumulate both live sources into the session totals and SHALL synthesize a `stats_update` marked with its usage kind, carrying the usage as `turnUsage` and no `contextUsage`.

**Consistency.** Live totals SHALL include each recorded usage no later than the next drain point, and SHALL equal the JSONL-derived totals once the session has shut down through pi's shutdown path, provided the server did not re-derive the session's totals from its JSONL (restart re-extraction, hydration) while usage was undrained. A process killed without that path MAY leave live totals short, and such a re-derivation MAY count up to one drain interval of entry usage twice; JSONL-derived totals remain authoritative on the next re-extraction.

**Replay.** Replay SHALL NOT emit `message_end` for tool-result messages, so the bridge's register-time history replay adds no tool-result usage on the server.

#### Scenario: Cache-warm usage counted from JSONL
- **WHEN** a session file contains a `usage` entry with `kind: "cache_warm"`, `cacheRead: 50000` and `cost.total: 0.015`
- **THEN** the session's derived cost SHALL include `0.015` and its cache-read total SHALL include `50000`

#### Scenario: Unknown usage kind counted
- **WHEN** a `usage` entry has an unrecognised `kind`
- **THEN** its tokens and cost SHALL be added to the totals

#### Scenario: Compaction usage counted, gauge untouched
- **WHEN** a compaction entry carries `usage` with `totalTokens: 40000`
- **THEN** that usage SHALL be added to the totals
- **AND** the context-usage estimate SHALL NOT be set from it

#### Scenario: Tool-result usage counted once
- **WHEN** a turn ends whose tool-result message carries usage, repeated in `turn_end.toolResults` and present as a message entry
- **THEN** that usage SHALL be added to the totals exactly once

#### Scenario: Assistant message_end not counted
- **WHEN** an assistant `message_end` with usage is forwarded, followed by its `turn_end`
- **THEN** that usage SHALL be added to the totals exactly once, from the `turn_end`

#### Scenario: Idle cache warming reaches live totals
- **WHEN** an idle session's cache warmer refreshes and pi later emits the next `cache_warming_decision`
- **THEN** the refresh's usage SHALL be in the live totals

#### Scenario: Live and derived totals agree at shutdown
- **WHEN** a session with cache warming enabled idles through refreshes and then shuts down
- **THEN** its live token and cost totals SHALL equal the totals derived from its JSONL

#### Scenario: Lazy session file is not a session switch
- **WHEN** a new session's file path appears after the first user message
- **THEN** no usage recorded before that point SHALL be skipped

#### Scenario: Reload does not re-forward history
- **WHEN** the bridge re-initialises on a session whose entries already include usage
- **THEN** none of those entries SHALL be forwarded as `usage_recorded`

#### Scenario: Register-time replay adds no usage
- **WHEN** the bridge registers a session whose history holds a tool-result message with usage and replays it
- **THEN** the server's totals SHALL NOT change from the replayed events

#### Scenario: Outgoing session drained on fork
- **WHEN** a usage entry is recorded after the last drain point and the session then forks
- **THEN** the usage SHALL be forwarded for the outgoing session before its `session_unregister`

#### Scenario: Reconnect keeps the cursor
- **WHEN** usage is recorded while the bridge's connection is down and the connection is restored
- **THEN** that usage SHALL be forwarded once at the next drain point

### Requirement: A session id first seen with existing history starts from its seeded totals

When the server registers a live session whose id it has no record of and the registration carries `usageSeed` (fork, switch to an unscanned file), it SHALL set that session's totals (`tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`) from `usageSeed`, and live accumulation SHALL add only usage recorded after the bridge's baseline. Registration of a known id SHALL keep its carried-over totals and ignore `usageSeed`. A registration without `usageSeed` SHALL start an unknown id with all five totals at zero.

#### Scenario: Fork starts from the copied history
- **WHEN** a session forks to a new file that contains copied entries with usage
- **THEN** the new session's live totals SHALL equal the totals derived from the new file
- **AND** later usage SHALL be added on top

#### Scenario: Usage right after a fork is not lost
- **WHEN** a usage entry is appended to a forked session after its registration and before the next drain point
- **THEN** that usage SHALL be forwarded at the next drain point and counted once

#### Scenario: Known id keeps its totals
- **WHEN** a session the server already holds re-registers (reload respawn, reconnect)
- **THEN** its totals SHALL be carried over and SHALL NOT be re-seeded from the JSONL

### Requirement: Observing cache-warming decisions SHALL NOT influence them

Where the bridge uses the `cache_warming_decision` event only as a drain point, its handler SHALL return no action override, and a drain failure SHALL be caught inside the handler.

#### Scenario: Drain handler leaves pi's decision intact
- **WHEN** pi emits `cache_warming_decision` with action `warm` and the drain throws
- **THEN** the bridge handler SHALL return `undefined` without throwing
- **AND** pi SHALL apply its own `warm` decision
