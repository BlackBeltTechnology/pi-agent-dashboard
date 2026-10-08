## Context

- **Live stats today.** The bridge forwards `turn_end`. The server's `extractTurnStats` (`packages/shared/src/stats-extractor.ts`) reads `message.usage` and returns `null` without it. `packages/server/src/event-wiring.ts:1206-1241` accumulates the result (cache via `turnUsage`, `:1215-1216`) and synthesizes the `stats_update` event. `StatsUpdateMessage` was removed (`packages/shared/src/protocol.ts:383`).
- **Tool results already reach the server.** pi emits `message_end` for every message, tool results included (`emitToolResultMessage` in pi-agent-core `agent-loop.js`; tool-result `usage` "contributes to full-session statistics", pi 1.0.0 `docs/message-types.md`). The bridge forwards `message_end` with the full message, for assistant and tool-result roles alike (`packages/extension/src/bridge.ts:2607-2660`).
- **Client.** The reducer's `stats_update` arm (`packages/client/src/lib/chat/event-reducer.ts:2470-2500`) adds `tokensIn/tokensOut/cost`; inside `if (turnUsage)` it assigns `turnIndex` to the last user message, bumps `turnCount`, appends a `TurnStat` (`MAX_TURN_STATS = 50`, `:232`) and adds cache tokens (`:2498-2499`). `TokenStatsBar` renders reducer state (`packages/client/src/App.tsx:2282-2292`).
- **Batch recompute.** `extractStatsFromEvents` (`packages/server/src/session/event-status-extraction.ts:17-45`) sums `stats_update` events, cache from `turnUsage`. Hydration of an ended session REPLACES the session's totals with it over replayed events (`packages/server/src/browser-handlers/subscription-handler.ts:1029-1039`).
- **Replay.** `state-replay.ts` synthesizes `stats_update` only in the assistant arm (`packages/shared/src/state-replay.ts:111-153`). The bridge replays the current branch on register (`packages/extension/src/session-sync.ts:219-227`, `getBranch()`); the server synthesizes stats only from `turn_end` (`event-wiring.ts:1206`), so replayed `stats_update` events never re-accumulate server totals.
- **Offline.** `session-stats-reader.ts:57-68` uses one loop over all JSONL lines for cost and `lastTotalTokens`. The scanner `continue`s archived sidecars before the freshness check (`packages/server/src/session/session-scanner.ts:386-389`), then re-extracts only when the JSONL mtime is newer than `cachedAt` (`:407-415`). Unarchive restores from the sidecar without re-extracting (`packages/server/src/session/session-archive.ts:287-323`). Routine saves write `sessionToMeta(session)` as a full sidecar overwrite (`packages/server/src/session/session-to-meta.ts`).
- **Registration.** `memorySessionManager.register` carries over totals for a known id (`packages/server/src/session/memory-session-manager.ts:313-325`, required by `headless-reload` "Preserve accumulated session state on respawn") and zeroes `tokensIn/tokensOut/cost` for an unknown id (`:353-357`). `handleSessionChange` swaps `bc.sessionId` and re-registers synchronously on fork/new/resume (`packages/extension/src/session-sync.ts:230-243`).
- **pi 1.0.0** (unchanged since 0.99.1; verified on the unpacked 1.0.0 package).
  - `SessionManager.appendUsage(kind, provider, model, usage, note?)` writes `UsageEntry { kind, provider, model, usage, note? }`. `CompactionEntry.usage?` / `BranchSummaryEntry.usage?` and `ToolResultMessage.usage?` carry no provider/model (`dist/core/session-manager.d.ts`, `docs/message-types.md`).
  - Extensions see `ctx.sessionManager: ReadonlySessionManager` (`dist/core/extensions/types.d.ts:223`): it exposes `getEntries()` (full filtered copy) and `getSessionId()`, **not** `getEntryCount()` (`dist/core/session-manager.d.ts:178`).
  - `getSessionId()` is stable while the file is created lazily.
  - `/reload`, session replacement and exit all run `session_shutdown` on the outgoing runtime: `SessionShutdownEvent.reason` is `"quit" | "reload" | "new" | "resume" | "fork"` (`dist/core/extensions/types.d.ts:609-614`).
- **Bridge shutdown order.** The handler sends `session_unregister`, sleeps 100 ms, then disconnects (`packages/extension/src/bridge.ts:3932-3952`); `session_unregister` ends the session server-side and drives the final sidecar write.
- **Event subscription spec.** `catch-all-event-forwarding` fixes forwarding as 1:1 with three named exceptions, and lists control events with dedicated handlers that are not forwarded (`openspec/specs/catch-all-event-forwarding/spec.md`).
  - `CacheWarmer` refreshes while idle. `cache_warming_decision` (`action: "warm" | "stop"`, `dist/core/cache-warmer.d.ts:21`) fires before each scheduled refresh decision; handler failures fall back to pi's decision. The warmer can also stop without a decision event (mode change, settle, safety limits).

## Goals / Non-Goals

**Goals:** server session totals equal pi's for every kind on the live and offline paths; replayed views include every kind; no double count; context gauge and turn chart unaffected; existing non-archived sessions corrected on discovery.

**Non-Goals:**
- a per-kind cost breakdown UI; changing pi's cache warming;
- branch scope: totals recomputed from a replayed branch (hydration, `TokenStatsBar`) cover the rendered branch only, as today for assistant usage; reconciling abandoned-branch usage is out of scope;
- deduplicating events the bridge buffered during a server outage against JSONL re-extracted at server start (pre-existing for `turn_end`; out of scope, see Risks).

## Decisions

### D1 — One source per kind
| Usage | Live transport | JSONL / replay source | Context gauge | Turn bookkeeping |
|---|---|---|---|---|
| assistant | `turn_end` (unchanged) | assistant message | yes | yes |
| tool result | forwarded `message_end` with `message.role === "toolResult"` (server-side) | tool-result message | no | no |
| compaction / branch summary | `usage_recorded{kind:"compaction"\|"branch_summary"}` via drain | entry `usage` | no | no |
| `usage` entry (any kind) | `usage_recorded{kind:"usage:<kind>"}` via drain | `type:"usage"` | no | no |

- `turn_end.toolResults` is never counted. An assistant `message_end` is never counted (`turn_end` is its only source).
- **Replay invariant.** `replayEntriesAsEvents` emits `tool_execution_end`, never `message_end`, for tool-result messages (`packages/shared/src/state-replay.ts:157-184`). The bridge replays history on every register (`session-sync.ts:219-227`), so this invariant is what keeps register-time replay from re-counting tool-result usage. It is kept and regression-tested; the new replay arm adds only kind-marked `stats_update`, which the server never accumulates.
- The drain forwards only `usage`, `compaction` and `branch_summary` entries, never message entries, so tool-result usage cannot be counted twice.

### D2 — Bridge drain cursor and baseline
- Cursor `{ sessionId, lastEntryId }` over `ctx.sessionManager.getEntries()`.
- **Baseline + seed, one snapshot.** On bridge init (process start and `/reload` re-init) and in `handleSessionChange`, synchronously: take one `getEntries()` snapshot, set `lastEntryId` to its last entry id (or `null` when empty), compute `usageSeed` = full totals of every kind over that snapshot, and send `usageSeed` with `session_register`. Nothing is forwarded for the snapshot. Seed and cursor share one cutoff, so no entry is skipped or counted twice across registration.
- **Reconnect** (WS drop, server restart) does not touch the cursor; entries drained while disconnected travel in the connection's existing outbound buffer.
- **Reload / fork / new / resume.** pi runs `session_shutdown` on the outgoing runtime first, so its shutdown drain flushes the outgoing session before the new baseline.
- **Drain:** forward each allowlisted usage-bearing entry after `lastEntryId`, then advance. If `lastEntryId` is gone from the snapshot, re-baseline (no seed resend) and forward nothing.
- **Drain points:** `turn_end`, `agent_settled`, `cache_warming_decision` (handler returns `undefined`, body in try/catch), `session_shutdown`. The shutdown drain is sent **before** `session_unregister` in the same handler.
- `cache_warming_decision` becomes a control event in `catch-all-event-forwarding`: a dedicated handler that produces `usage_recorded`, never an `event_forward` (no JSON card per idle refresh).
- `provider` / `model` are forwarded when the entry has them (`usage` entries); otherwise omitted.
- Cost: one `getEntries()` copy plus a reverse scan to `lastEntryId` per drain point; no cheap count is reachable from the extension API. Budget: on a 10,000-entry session a drain with no new entries has p95 ≤ 5 ms over 200 runs (performance-optimization).
- One shared pure summing function over entries (`packages/shared`) backs `usageSeed`, `session-stats-reader.ts` and the replay arms, so the three agree.

**Rejected — absolute snapshot.** The bridge could send full non-message totals at every drain. Rejected: the reducer and `extractStatsFromEvents` are increment-based, so snapshots would need a second totals model on server and client and a replace-vs-add rule against replay.

**Rejected — server seeds from the JSONL file.** It has no shared cutoff with the bridge cursor (an entry appended between registration and the first drain is skipped), and a lazily created file may not exist yet at registration.

### D3 — Server accumulation and synthesis
- `usage_recorded` and a forwarded `message_end` whose `message.role === "toolResult"` and `message.usage` is set feed one accumulator. Usage is read from the in-flight forwarded event, never from the stored (possibly truncated) copy.
- The accumulator adds input, output, cacheRead, cacheWrite and cost to the session record and synthesizes `stats_update{ usageKind, tokensIn, tokensOut, cost, turnUsage }` (no `contextUsage`), stored and broadcast like the turn path.
- Non-turn events keep the `turnUsage` shape, so `extractStatsFromEvents` needs no change.
- Reducer: `turnIndex` assignment, `turnCount` increment and `TurnStat` append run only for turn kind (no `usageKind`, or `"turn"`); token, cost and cache totals run for every kind.

### D4 — Seeding, replay and re-extraction
- **Seed:** `register` applies `usageSeed` (all five totals, cache included) only for an id it has no record of. A known id keeps the `headless-reload` carry-over unchanged. Absent `usageSeed` (older bridge) → all five totals zero (today's code zeroes only `tokensIn/tokensOut/cost`; cache fields are pinned to zero too).
- **Replay:** `replayEntriesAsEvents` emits a kind-marked `stats_update` for each `usage` entry, compaction/branch-summary usage and tool-result usage, so hydration's replace-with-replay and `TokenStatsBar` include every kind on the rendered branch.
- **Re-extract:** `statsExtractorVersion` lives on the session record and in `sessionToMeta`, so full-overwrite saves keep it. For non-archived sidecars the scanner re-extracts when it is absent or older, regardless of mtime, through the same merge as the mtime trigger, so the persisted-`contextWindow` rule applies to both triggers. Archived sidecars stay unopened (`meta-json-session-cache` "Session discovery by filesystem scan"); an unarchived session is corrected at its next discovery or hydration.

## Risks / Trade-offs

- [Live lag until the next drain point] → accepted. Usually one idle refresh. When the warmer stops without a decision event, the lag lasts until the next turn, `agent_settled` or shutdown.
- [Shutdown flush is best-effort] → the drain precedes `session_unregister` on the same socket; delivery still rests on the existing 100 ms pre-disconnect wait.
- [SIGKILLed process leaves live short] → accepted; the next hydration or extractor-versioned re-extraction from JSONL corrects it.
- [Totals re-derived from JSONL while usage is undrained] → bounded double count, accepted. A server restart (re-extract, guaranteed once after upgrade by the version trigger) or a hydration (replace-with-replay) can already include entries the bridge has not drained yet; the next drain adds them again. Exposure ≤ one drain interval of entry usage (typically one idle refresh or one compaction). Re-baselining on reconnect would instead lose that usage after a plain WS drop. Corrected at the next re-extraction; same class as outage-buffered `turn_end` today. A server-acknowledged watermark is a follow-up, not this change.
- [First boot after upgrade re-parses every non-archived JSONL once] → same single-pass reader the mtime trigger uses; archived sessions excluded; duration measured and reported at verification, not gated.
- [Below-floor runtime (no usage entries / tool usage)] → nothing to count, nothing forwarded; no regression.
