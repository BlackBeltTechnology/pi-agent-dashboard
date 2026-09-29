## ADDED Requirements

### Requirement: Session totals include non-message usage

Session token and cost totals SHALL include all model-attributed usage pi records, not only assistant-message usage:
- `usage` session entries (for example `kind: "cache_warm"`; unknown `kind` values SHALL count as normal usage),
- the `usage` field of compaction and branch-summary entries,
- usage carried on tool-result messages (for example codemode nested calls and `models.classify()`).

Each kind SHALL be counted from exactly one source. Input, output, cache-read, cache-write and cost SHALL all be counted for every kind. Only assistant-message usage SHALL update the context-usage estimate.

**Live path.** The bridge SHALL forward each recorded non-assistant usage as a `usage_recorded` event carrying the kind, provider, model and usage. For usage entries and compaction/branch-summary usage, the bridge reads session-manager entries appended since a per-session cursor at `turn_end`, `agent_settled`, `cache_warming_decision` and `session_shutdown`; the shutdown drain SHALL be sent before the bridge disconnects. Tool-result usage is taken from the tool-result message. The cursor SHALL be keyed by session id, not by session-file path (pi creates the file lazily). The server SHALL accumulate `usage_recorded` into the session totals and SHALL synthesize a `stats_update` marked with its usage kind.

**Consistency.** Live totals SHALL include each recorded usage no later than the next drain point, and SHALL equal the JSONL-derived totals once the session has shut down through pi's shutdown path. A process killed without that path MAY leave live totals short; JSONL-derived totals remain authoritative on the next re-extraction.

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
- **WHEN** a turn ends whose tool-result message carries usage
- **THEN** that usage SHALL be added to the totals exactly once

#### Scenario: Idle cache warming reaches live totals
- **WHEN** an idle session's cache warmer refreshes and pi later emits the next `cache_warming_decision`
- **THEN** the refresh's usage SHALL be in the live totals

#### Scenario: Live and derived totals agree at shutdown
- **WHEN** a session with cache warming enabled idles through refreshes and then shuts down
- **THEN** its live token and cost totals SHALL equal the totals derived from its JSONL

#### Scenario: Lazy session file is not a session switch
- **WHEN** a new session's file path appears after the first user message
- **THEN** no usage recorded before that point SHALL be skipped

### Requirement: A session registered with existing history starts from its derived totals

When the server registers a live session whose session file already contains entries (resume, fork, switch), it SHALL seed that session's totals from the file's JSONL-derived totals, and live accumulation SHALL add only usage recorded after registration.

#### Scenario: Fork starts from the copied history
- **WHEN** a session forks to a new file that contains copied entries with usage
- **THEN** the new session's live totals SHALL equal the totals derived from the new file
- **AND** later usage SHALL be added on top

### Requirement: Observing cache-warming decisions SHALL NOT influence them

Where the bridge uses the `cache_warming_decision` event only as a drain point, its handler SHALL return no decision override and SHALL NOT throw.

#### Scenario: Drain handler leaves pi's decision intact
- **WHEN** pi emits `cache_warming_decision` with action `refresh`
- **THEN** the bridge handler SHALL return no result
- **AND** pi SHALL apply its own `refresh` decision

## MODIFIED Requirements

### Requirement: Stats extraction from turn_end events
The server SHALL extract token usage stats from forwarded `turn_end` events by reading `event.message.usage`, and SHALL synthesize the `stats_update` event from them (the bridge forwards the event; it does not send `stats_update` itself). The extracted data SHALL include: `tokensIn` (input tokens), `tokensOut` (output tokens), `cost` (from `usage.cost.total`), per-turn breakdown (`turnUsage` with input, output, cacheRead, cacheWrite), and optionally `contextUsage` from `ctx.getContextUsage()`.

#### Scenario: Turn ends with usage data
- **WHEN** a `turn_end` event fires with `message.usage` containing token counts
- **THEN** the server SHALL extract stats and synthesize a `stats_update` event

#### Scenario: Turn ends without usage data
- **WHEN** a `turn_end` event fires but `message.usage` is undefined
- **THEN** the server SHALL NOT synthesize a `stats_update` event from it

#### Scenario: Context usage included
- **WHEN** `ctx.getContextUsage()` returns `{ tokens: 50000, contextWindow: 200000 }`
- **THEN** the `stats_update` message SHALL include `contextUsage` with those values
