# Heal orphaned tool + subagent cards when a session ends

## Why

Session `01a0a23d-…` (`zeta-pi-only-agent-docs`, cwd `judo-ng`) fanned out 7
parallel `Agent` calls, stalled its own event loop (`tickDrift=240s`), and was
force-closed by the bridge watchdog (`watchdog_force_close silent=148s`, then
`session timed out … reconnect grace period expired`). The JSONL ends with 14
`Agent` tool calls and 0 tool results. The dashboard shows the session as
`ended` — but its 14 subagent cards and their `Agent` tool cards stay `running`
forever, live and after every replay.

Cause: `event-reducer.ts` moves a subagent to a terminal state only on
`subagent_completed` / `subagent_failed` or the `tool_execution_end` backfill
(~L2296); a tool card only on `tool_execution_end`. A dying pi process emits
none of those. The one existing heal, `synthesizeSupersededEnd`
(`healedBy:"superseded"`), needs a *later assistant inference in the same
session* — which never comes after death. The server's unregister path
(`event-wiring.ts` ~L484–512) broadcasts `session_updated{status:"ended",
currentTool:null}` but writes nothing into the event store, so a reopened
session replays the orphaned `running` rows again.

Root cause of the stall itself is fixed upstream (`pi-dashboard-subagents`
change `reduce-fanout-parent-stall`). This change makes the dashboard honest
regardless of *why* a session died.

Second finding (spike `/tmp/perchild-cost-spike.mjs`, 7 concurrent children,
warm parent, 27 extensions): re-instantiating every extension per child costs
3.3 s of synchronous loop block, of which **3.1 s is one extension** —
`flows-anthropic-bridge-plugin/src/bridge/index.ts` `runProbe()` →
`resolvePiPackageEntry()` → `shared/src/pi-package-resolver.ts` `rootGlobalOr("")`
→ `npm root -g` `spawnSync` (~150 ms, twice per probe, per load). Dropping that
extension alone: 3.37 s → 0.22 s. The `npm root -g` result was deliberately
un-cached in `consolidate-tool-resolution` (`platform/npm.ts:109`) and the
`ToolRegistry` caches only the npm *binary*, not the command output. The same
~0.45 s tax lands on every pi startup and every `/reload`. A shared child loader
was spiked and rejected — `extensionsResult.runtime` is one mutable object, so
`pi.setSessionName/appendEntry` from any extension closure land on the last
session that called `bindCore`, and the first child `dispose()` marks the shared
runtime stale for all others (`/tmp/shared-loader-spike.mjs`).

## What Changes

- **Server synthesizes terminal events when a session ends.** On
  `sessionManager.onEnded` (the transition both seams fire — `onUnregister`
  misses every `update({status:"ended"})` ending: spawn failure, `process_gone`
  normalization, force-kill, `movedTo`), before the `session_updated{ended}`
  broadcast: scan the session's stored events back to the last `agent_start`,
  collect every `tool_execution_start` without a matching `tool_execution_end`,
  and for each insert + broadcast a synthesized
  `tool_execution_end{toolCallId, toolName, isError:true, result:"parent session ended", healedBy:"session_ended", details?}`.
  For `Agent` tool calls, `details.agentId` is recovered from the last
  `tool_execution_update` carrying it (at `data.partialResult.details.agentId`),
  so the reducer's existing `Agent` backfill arm flips the subagent to `failed`.
  Idempotent — a second `onEnded` finds nothing open.
- **Subagents are healed directly too.** The same scan synthesizes
  `subagent_failed` for every `subagent_created`/`subagent_started` with no
  terminal event, so a subagent that never ticked (its `agentId` never reached a
  `tool_execution_update`) is not stranded by relying on the Agent backfill
  alone.
- **Transcript replay stops lying.** The event store is memory-only, so a
  reopened session after restart/eviction re-parses the pi JSONL — and that
  parser (`state-replay.ts`) already closes orphaned tool calls, but as
  `{result:"", isError:false}`: a killed call renders as a *successful empty
  result*. That orphan-close gains `isError:true`, `result:"parent session
  ended"`, `healedBy:"session_ended"`, so live and every transcript-sourced
  replay agree. One line, one code path — no second heal pass (it would find
  nothing to do). Subagent cards need no replay work: subagent events are never
  persisted.
- **Reducer honours `healedBy:"session_ended"`** with the same guard as
  `"superseded"`: it only reduces a `running` row, never clobbers a real
  terminal, and a later real end (impossible here, but cheap) still wins.
- **Memoize `npm root -g` in `pi-package-resolver`.** Module-level cache of the
  `rootGlobalOr("")` result, shared by `resolvePiPackageEntry` and
  `listPiPackages`; `opts.npmRoot` still overrides; a test-only reset export.
  Per-child extension instantiation drops ~450 ms → ~15 ms; pi startup and
  `/reload` drop the same.
- **Flip `subagentTickThrottleMs` default `0 → 500`** (`packages/shared/src/config.ts`
  L927) — the rollout note says "flip once the throttle's suites are green";
  they are. The stalled session forwarded 7949 Agent ticks and coalesced 0.
  Because `ensureConfig()` materialized `0` into every existing
  `config.json`, the flip ships with a **one-shot marker-guarded migration**
  (`0` + no marker → `500` + marker); an explicit `0` set after the migration is
  honoured.

Not changed: subagents plugin card UI, the `superseded` heal, protocol types
(`healedBy` is already an open string on `tool_execution_end.data`).

## Capabilities

### New Capabilities
- `session-end-orphan-heal`: on session unregister the server closes every open
  tool call (and its subagent) with a synthesized, stored, broadcast
  `tool_execution_end{healedBy:"session_ended"}`.

### Modified Capabilities
- `subagent-live-cadence`: `subagentTickThrottleMs` default becomes `500`.
- `pi-package-resolver`: `npm root -g` shell-out runs at most once per
  process for the resolver's default path.

## Impact

- `packages/server/src/event-wiring.ts` — `onEnded` hook; new pure helper
  `packages/server/src/session/open-tool-calls.ts` (`findOpenToolCalls(events)`,
  `findOpenSubagents(events)`).
- `packages/shared/src/state-replay.ts` — orphan-close event shape.
- `packages/shared/src/config.ts` + `packages/server/src/cli.ts` — throttle
  default, marker, boot migration via `writeConfigPartial`.
- `packages/shared/src/pi-package-resolver.ts` header + the `pi-package-resolver`
  spec Purpose and its "never … process spawning" requirement — all three
  currently assert the opposite of the memo.
- `packages/client/src/lib/chat/event-reducer.ts` — `healedBy` guard accepts
  `"session_ended"`.
- `packages/shared/src/config.ts` — default flip + doc comment.
- `packages/shared/src/pi-package-resolver.ts` — memoized npm root.
- Tests: helper unit test (input built from a REAL recorded
  `tool_execution_update`, not a hand-shaped literal — the `agentId` path is
  nested under `partialResult`); `event-wiring` integration (both end seams, 2
  open tool calls, one `Agent` → synthesized ends stored + broadcast, subagent
  `failed` on replay, double-`onEnded` idempotence, `movedTo` exclusion);
  `state-replay` orphan-close shape test; reducer tests for the new `healedBy`
  incl. the subagent terminal guard; config default + migration tests;
  resolver test (spy `rootGlobalOr` called once across N resolves).
- Docs: `docs/AGENTS.md` / `packages/server/src/session/AGENTS.md` rows;
  `docs/faq.md` entry "subagent card stuck running after session ended".
- Rebuild: server restart + client build (`implement` skill matrix).

## Discipline Skills

- `systematic-debugging` — grounded in the reproduced session
  (`01a0a23d-…`): 14 `Agent` starts, 0 ends, `watchdog_force_close`. Tasks must
  reproduce with a killed pi process before the fix, not a mocked one only.
- `review-code` — the end hook is shared by every session death
  (TUI quit, heartbeat expiry, run termination, force-kill, move); the synth
  must be a no-op when nothing is open and must not double-insert.
- `performance-optimization` — the npm-root memo is measure-first: spike
  numbers above are the baseline; task 4b.3 re-runs the spike after the change.
