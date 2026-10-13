## Why

When a pi session reconnects to the dashboard (WS reconnect with new entries, dashboard restart, `/reload`), the bridge replays its transcript through `replayEntriesAsEvents`, whose orphan-close fabricates `tool_execution_end{isError:true, result:"parent session ended", healedBy:"session_ended"}` for every `toolCall` without a `toolResult` — including calls that are **still executing** in the live process. A running `Agent` card then shows a failed header (`!`, `<1s`, "N failed") while its body keeps ticking (`running bash`, 17m elapsed): the parent session did not end, the UI lies.

## What Changes

- The bridge's register/reconnect replay SHALL NOT fabricate a terminal end for a tool call the live process is still executing (the trailing assistant message's open calls while the agent is streaming). Truly dead orphans (earlier assistant messages, or any orphan when the agent is idle) are still closed as today.
- Cold transcript replays (disk hydration, archive, retained remote transcript) keep the existing orphan-close unchanged — there is no live process.
- Client reducer: a live `tool_execution_update` arriving on a row healed with `healedBy:"session_ended"` SHALL fully reopen it (row `toolStatus`, `toolCalls` entry, duration, heal markers, subagent status) instead of only merging details. This repairs stores that already hold a fabricated end and bridges that predate the fix.
- The bridge marks its synthetic reconnect `agent_start` (`synthetic: true`), and the server `onEnded` open-call scan walks past a marked start. So a call left open by a live replay is still closed if the process really dies, and the scan's documented reconnect gap closes too.
- The tool-result lookup no longer serves a `session_ended` placeholder end as the result of a call in a session that is still alive, so the stale-tool reconcile cannot re-poison a reopened card.
- The client records a heal marker on a subagent's terminal state so the reopen can target heal-derived `failed` states precisely.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `chat-view`: post-restart ask_user scenario precondition admits a `running` tool row (behaviour unchanged).
- `dashboard-server`: the full tool-result lookup does not answer with a `session_ended` placeholder for a live session.
- `subagent-live-detail-reliability`: the non-regressing hydration rule gains one exception, a `session_ended`-healed subagent revived by a live tick.
- `session-end-orphan-heal`: transcript orphan-close no longer applies to the in-flight tail of a live bridge replay; the server end-of-session scan looks past a synthetic reconnect `agent_start`; a `session_ended` heal is reopened by a later live tick.

## Impact

- `packages/shared/src/state-replay.ts` — `replayEntriesAsEvents` gains an option to leave the live tail open.
- `packages/extension/src/session-sync.ts` (`replaySessionEntries`, new `isLive`), `bridge.ts` onReconnect, `bridge-handlers/lifecycle.ts` session_start — liveness decided per call site; synthetic `agent_start` marked.
- `packages/server/src/session/open-tool-calls.ts` — `findOpenToolCalls` skips marked synthetic `agent_start`.
- `packages/subagents-plugin/src/client/types.ts` — optional `SubagentState.healedBy`.
- `packages/server/src/routes/session-routes.ts` + `persistence/memory-event-store.ts` `findToolEndEvent` — skip `session_ended` ends for live sessions.
- `openspec/specs/chat-view` — scenario GIVEN widened (behaviour unchanged).
- `packages/client/src/lib/chat/event-reducer.ts` — `tool_execution_update` reopen of a `session_ended` row.
- Tests: shared state-replay, extension session-sync, server open-tool-calls, client event-reducer.
- No protocol, persistence-format, or API change. Old bridge + new server/client: a poisoned row reopens on the next live tick (ticking tools such as `Agent`) and stays reopened (the route fix stops the reconcile re-poisoning it). Non-ticking tools stay mislabeled until their real end, which overwrites the heal. New bridge + old server (unsupported pairing): a tail call left open after a reconnect is healed on the next cold hydration, not live.

## Discipline Skills

- `systematic-debugging` — reproduce the reconnect-mid-turn path with a failing test before the fix.
- `review-code` — inline review before commit.
- None of security / performance / observability / doubt-driven apply (no untrusted input, no latency budget, no irreversible step).
