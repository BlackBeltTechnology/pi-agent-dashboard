## Context

Reproduced: session `01a0a23d-48a2-7734-8658-b5f498287e4e`. JSONL: 14
`Agent` `toolCall`s, 0 `toolResult`s. Server log (`~/.pi/dashboard/server.log`
~L349791, L350008): `watchdog_force_close silent=148145ms … maxTickDrift=240749ms`,
`session timed out … (reconnect grace period expired)`. Dashboard: session
`ended`, 14 subagent cards `running`, 14 `Agent` tool cards `running`, also
after reload (replay reproduces them).

Reducer terminal transitions for a subagent: `subagent_completed` /
`subagent_failed` arms (~L2629), or the `Agent` backfill inside
`tool_execution_end` (~L2296, sets `failed` when `isError`). Tool card: only
`tool_execution_end`. Existing client heal `synthesizeSupersededEnd` requires a
later assistant inference (`hasLaterAssistantInference`) — absent after death.

Server unregister (`event-wiring.ts` ~L484–512): resets canvas, evicts prompt
acks, clears liveness, broadcasts `session_updated{status:"ended", currentTool:null}`.
Store untouched. Server tracks `currentTool` as one string; open tool call ids
are derivable only from the event stream (`eventStore.getEvents(sessionId, 1)`).

Two end seams, not one (`memory-session-manager.ts` L435, L463): `unregister()`
fires `onEnded` then `onUnregister`; `update({status:"ended"})` fires **only**
`onEnded` — and that is the seam used by spawn-failure, zombie normalization
(`process_gone`), manual force-kill, and `movedTo`. `onEnded` also re-fires on a
later `closedReason` change for an already-ended session.

Stored `tool_execution_update` carries the Agent snapshot at
`data.partialResult.details.agentId` (reducer L2159–2200; bridge
`subagent-frame-strip.ts` preserves the nested path) — NOT `data.details`.

Subagent cards are keyed independently of tool calls: `subagent_created` /
`subagent_started` create them by `data.id`, and only `subagent_completed` /
`subagent_failed` or the `Agent`-tool backfill terminate them.

The event store is in-memory (100 sessions LRU, 20k events/session,
`memory-event-store.ts`). Reopening an ended session after a restart or an
eviction re-hydrates by parsing the pi JSONL transcript. That parser
(`shared/src/state-replay.ts` `replayEntriesAsEvents`, L234–243) **already
closes every orphaned tool call** — but as `{result:"", isError:false}` with no
`healedBy`, i.e. a dead call renders as a successful empty result. Every
transcript-sourced path funnels through it (disk `session-load-worker.ts`,
retained/remote `retained-transcript.ts`, bridge register-replay
`session-sync.ts`). Subagent lifecycle events are forward-only
(`flow-event-wiring.ts` `SUBAGENT_EVENT_MAP`) and never reach the JSONL, so a
transcript replay has no subagent cards to heal at all.

So the orphans the incident showed after "reload" came from the WARM path
(store-resident events), not from a cold parse.

`session.movedTo` — not `closedReason` — marks a relocation: `ClosedReason` is
`"manual" | "process_gone" | "spawn_failed" | "unknown"` and the `session_moved`
handler sets `movedTo` while leaving the reason to normalize to `"unknown"`.

## Goals / Non-Goals

Goals
- Every open tool card + subagent in a session that ends reaches a terminal
  state, live and on every replay, on every unregister path.
- Zero behaviour change when nothing is open.
- Flip the already-built Agent-tick throttle on.
- Make per-child extension instantiation cheap without sharing any
  extension state between sessions.

Non-goals
- Fixing why the session died (upstream change `reduce-fanout-parent-stall`).
- Healing tool cards mid-session (that is the `superseded` heal).
- New protocol messages or plugin UI work.

## Decisions

### D1: server-side synthesis on `onEnded`, not a client-side reaction to `session_updated`

Client-only heal (react to `session_updated{ended}` in `useMessageHandler`)
would fix the live view but every replay re-creates the orphans, and the
reducer has no session-status input. Synthesizing into the store makes the
stream self-describing: the reducer's existing `tool_execution_end` +
`Agent` backfill arms do all the work, replay and live are identical, and the
heal is independent of which client renders it.

Alternative rejected — bridge-side synthesis on `watchdog_force_close`: the
bridge is inside the dying process; it cannot be trusted to run.

**Hook `sessionManager.onEnded`, not `onUnregister`** (doubt-review finding,
both reviewers). `onUnregister` misses every `update({status:"ended"})` ending
— spawn failure, `process_gone` normalization, manual force-kill, `movedTo`.
`onEnded` fires on the exact terminal transition from BOTH seams, and on the
unregister seam it runs BEFORE `onUnregister`, so the synthesized ends still
precede the `session_updated{ended}` broadcast. `onEnded` re-firing on a
`closedReason` change is harmless: the first pass inserted the ends, so the
second pass's `findOpenToolCalls` returns `[]` — idempotence comes from the
store, not a flag.

### D2: open-call derivation scoped to the last `agent_start`

`findOpenToolCalls(events: StoredEvent[]): OpenToolCall[]` — single backwards
pass: walk from the tail, stop at `agent_start`; collect `tool_execution_end`
ids into a closed set; each `tool_execution_start` not in the set is open;
remember the latest **`tool_execution_update.data.partialResult.details.agentId`**
per id for `Agent` calls. Pure, unit-tested, O(turn length). Earlier turns are
already terminal (the superseded heal or real ends) — reopening them would
produce duplicate ends.

The `agentId` path is `data.partialResult.details.agentId` — verified against
the reducer's own read (L2159–2200) and the bridge's `subagent-frame-strip`.
Reading `data.details.agentId` (the first draft of this design) finds nothing,
leaves every subagent card `running`, and a fixture written to the same wrong
shape would go green while production stays broken — so the unit test MUST build
its input from a real recorded `tool_execution_update`, not a hand-shaped
literal.

Scan bound: the backwards pass stops at the first `agent_start`; the retained
window is already capped by the store (20k events/session), so the worst case
is one bounded in-memory walk. A separate arbitrary limit is NOT introduced —
an unmeasured cut-off silently skips heals on exactly the huge sessions this
change targets. The walk cost at the 20k cap is measured in the verification
step; if it exceeds ~10 ms a limit is added then, derived from that number.

Trimming degrades the heal, and says so: `tool_execution_start`,
`subagent_created` and `subagent_started` are not in
`ESSENTIAL_CHAT_EVENT_TYPES`, so a long session can lose a start while keeping
its updates. A subagent whose `created`/`started` were both trimmed and whose
`agentId` never reached a surviving update is unreachable by any heal — there is
nothing in the retained stream that names it. Accepted: it is also invisible to
the reducer, so it renders no card.

Known gap (local review, cycle 1): the bridge sends a SYNTHETIC bare
`agent_start` after a mid-turn reconnect (`bridge.ts` ~L1517/L3255, gated on
`isAgentStreaming`). It is indistinguishable from a real one in the stored
stream, so a call opened BEFORE the reconnect sits above that boundary and the
live heal misses it — the flaky-WS-then-death path. Accepted rather than
heuristically detected: dropping the turn scope would let a start whose end
never reached the store (lost in a transport / back-pressure gap) be "healed"
with a false error, which is the worse failure. The D7
transcript orphan-close is NOT turn-scoped, so the next cold hydration of that
session still renders the call as an error card.

Store trimming: `getEvents(sessionId, 1)` may not reach the last `agent_start`
for a very long turn (per-session cap). Then everything visible counts as one
turn — still correct for open calls (an end always follows its start, so a
trimmed start with a visible end is simply not in the visible set; a visible
start with no visible end is genuinely open).

### D3: event shape

```ts
{ eventType: "tool_execution_end", timestamp: now, data: {
    toolCallId, toolName, isError: true,
    result: "parent session ended", healedBy: "session_ended",
    ...(agentId ? { details: { agentId } } : {}) } }
```
`healedBy` is already an open string field consumed by the reducer. `result`
reads as the tool error text in the card; the subagent backfill copies it into
`error` (`isError ? { error: resultStr ?? detailError }`).

Insert via `eventStore.insertEvent` + `browserGateway.broadcastEvent(sessionId, seq, event)`
(`seq` is the `insertEvent` return), same pair as the stats path (~L1098–1100),
skipping broadcast while `replayingSessions.has(sessionId)`. Runs BEFORE the
`session_updated{ended}` broadcast so a client sees the cards settle, then the
session end.

`healedBy` is loosely typed (`tool_execution_end.data` is an open record) and
this is its first server→browser use — producer today is the client's own
`useStaleToolReconcile`. No protocol type changes; the field is documented in
the server helper instead.

### D3b: subagents are healed directly, not only via the Agent backfill

The `Agent`-tool backfill only reaches a subagent whose `agentId` was ever
stamped onto a `tool_execution_update`. A subagent created but never ticked (WS
back-pressure dropped the ticks, or it died between `subagent_started` and the
first tick) would stay `running` forever — contract violation on exactly the
overloaded sessions this change targets.

So the same scan also collects subagent ids: `subagent_created` /
`subagent_started` with no later `subagent_completed` / `subagent_failed` →
synthesize `subagent_failed{ id, error: "parent session ended", healedBy: "session_ended" }`.
This is independent of tool-call recovery; when both fire for the same subagent
the reducer's `setSubagentState` merge is idempotent (both write `failed`).
Subagent scan is NOT turn-scoped — subagents outlive a single `agent_start` —
but is bounded by the same retained window as the tool-call scan.

Live-only by construction: subagent events never reach the JSONL, so there is no
replay-side counterpart to keep in sync.

### D6b: endings that are not deaths are excluded

`movedTo` (`event-wiring.ts` ~L1686) records a live relocation to another
instance as `update({ movedTo, status:"ended" })`. Its tool calls are still running on the
destination, so fabricating `isError:true, "parent session ended"` for them is a
lie the destination cannot correct. The heal therefore skips a session with
`session.movedTo !== undefined`.

The gate is the `movedTo` FIELD, not `closedReason`: `ClosedReason` has no move
member and the move handler leaves the reason to normalize to `"unknown"` —
keying on it would never fire the exclusion.

### D7: transcript replay is fixed at the parser, not with a second heal pass

A second heal pass over hydrated events would be dead code: the parser closed
those calls already, so `findOpenToolCalls` returns `[]` on every
transcript-sourced stream. The real defect is the SHAPE of the parser's
orphan-close — a killed tool call replays as a silent success, contradicting the
error card the live heal produces for the same call.

So the fix lands in the parser (`state-replay.ts` L234–243): the orphan-close
event becomes
`{ toolCallId, toolName, result: "parent session ended", isError: true, healedBy: "session_ended" }`.
One edit, one code path; live and replay agree by construction — no new
integration point in `subscription-handler.ts`, no register-replay call site, no
seq question (the parser's events flow through the existing insert paths).

Blast radius is every transcript consumer (disk hydration, archive, remote
retained, bridge register-replay) — intended: they all render the same lie
today. The D4 reducer guard applies unchanged, so a real end still wins.

Subagent cards need nothing here: never persisted to the JSONL, so a transcript
replay cannot show a stuck one. Subagent healing is live-only (D3b).

### D4: reducer guard generalised — tool card AND subagent backfill

`if (healedBy === "superseded" && existing?.status !== "running") break;`
becomes `if (healedBy !== undefined && existing?.status !== "running") break;`
— any synthesized heal is `running`-only; real ends (no `healedBy`) unchanged.
The "real end overwrites superseded placeholder + clears marker" branch
(~L2267) already keys on `healedBy` absence; no change.

The subagent backfill inside the same arm (~L2340) needs its OWN guard. Its
`patch` sets `status` unconditionally and is spread AFTER `existingSub`, so a
synthesized Agent end would overwrite a **real `completed` subagent with
`failed`** — reachable whenever `subagent_completed` arrived but the process
died before the Agent tool's own end. (The `tool_execution_update` arm already
has this guard: `...(isTerminal ? {} : { status: "running" })` at ~L2215; the
end arm does not.) So: when `healedBy` is set, the backfill SHALL skip a
subagent whose status is already terminal, and only reduce `created`/`running`.
Same rule for the D3b synthesized `subagent_failed`.

### D5: throttle default flip + one-shot migration

`subagentTickThrottleMs: 0 → 500` in `DEFAULT_CONFIG`, comment updated to point
at this change. Bridge behaviour with `500` is already covered by the
`reduce-bridge-tick-bandwidth` suites; only the default test changes.

Migration site: **the server boot path only** (`cli.ts` ~L673, beside
`ensureConfig()`), written through `writeConfigPartial` (`server/src/config-api.ts`
L152) — the only merge-preserving writer. NOT in `loadConfig`, which is a pure
read called by every bridge process: putting a read-modify-write there races N
processes on one non-atomic `writeFileSync`, and `ensureConfig`'s own writer
persists only an 11-key subset (it would clobber user keys). The marker is
declared on `DashboardConfig` so the settings UI round-trip preserves it — a
stripped marker would re-run the migration and silently undo a deliberate `0`.

The flip alone reaches nobody: `ensureConfig()` (`config.ts` ~L1626) writes
`subagentTickThrottleMs: DEFAULTS.subagentTickThrottleMs` into
`~/.pi/dashboard/config.json` on first run, so every existing install already
has a materialized `0` that the parser honours as explicit. So a **one-shot
migration** on load: when the stored value is `0` AND the marker key
`subagentTickThrottleMigrated` is absent, rewrite the value to `500` and set the
marker. A user who sets `0` *after* the migration keeps it — the marker, not the
value, decides. Chosen over a blunt "any 0 becomes 500" (would silently
override a deliberate opt-out, breaking the explicit-config contract) and over
a defaults-only flip (no-op for every existing install).

Bridge reads `windowMs` once at init (`bridge.ts` ~L406), so the new value
reaches a session only after its next start / `npm run reload`. Expected;
documented in the task's verification step.

### D6: memoize `npm root -g` inside `pi-package-resolver`, not in `platform/npm.ts`

Spike (`/tmp/factory-cost-spike.mjs`, `/tmp/one-ext-profile.mjs`): re-running
the 27 cached factories costs 524 ms; 508 ms is `flows-anthropic-bridge-plugin`
whose `runProbe()` calls `resolvePiPackageEntry` for two specs, each defaulting
`npmRoot` to `rootGlobalOr("")` = `spawnSync(npm root -g)` (~150 ms). CPU
profile: `spawn` 97 %.

Options:
- Cache in `platform/npm.ts rootGlobal()` — rejected: `consolidate-tool-resolution`
  removed exactly that cache on purpose (invalidation belongs to
  `ToolRegistry.rescan()`); reintroducing it changes semantics for the runtime
  scanner and doctor paths too.
- Cache in the bridge plugin — fixes one caller; the resolver is the shared hot
  path (`pi-resource-scanner.ts:248` already keeps its own
  `cachedNpmGlobalRoot` for the same reason).
- **Chosen:** module-level `let cachedNpmRoot: string | undefined` in
  `pi-package-resolver.ts`; `defaultNpmRoot()` fills it once via
  `rootGlobalOr("")`; both `resolvePiPackageEntry` and `listPiPackages` use it
  when `opts.npmRoot` is absent. Export `resetNpmRootCacheForTests()`. The
  global npm root does not change within a process lifetime; a `""` result
  (npm missing) is cached too — retrying per call would just repeat the
  slow failure.

The module's own stated contract has to move with it: the source header
(`pi-package-resolver.ts` L23–25, "holds no module-level cache") and the
standing spec Purpose (`openspec/specs/pi-package-resolver/spec.md` L7,
"never installs, never mutates, never caches") both assert the opposite of this
decision — the delta MODIFIES that requirement rather than only adding one, or
the archived spec contradicts itself. `resolver-parity-with-scanner.test.ts`
asserts the literal token `rootGlobalOr` appears in the resolver source; the
`defaultNpmRoot()` wrapper keeps it.

Why not share one loader across children (the upstream change's original D1):
spiked and rejected — `DefaultResourceLoader.getExtensions()` returns one
`extensionsResult` whose `runtime` every `ExtensionRunner.bindCore` mutates, so
captured `pi.*` calls route to the last-bound session and the first child's
`dispose()` → `runtime.invalidate()` throws "extension ctx is stale" in the
others (observed: bridge `registerAskUserTool` throw, `MCP initialization
failed`). Per-child loaders + this memo: 7-way fan-out spawn block 4.5 s →
~0.2 s with full isolation.

## Risks / Trade-offs

- A synthesized end for a tool that was *about* to finish in a session that
  re-registers within the grace window: not possible — unregister is after
  grace expiry; a re-registered session is a new registration and a new
  `agent_start` scope.
- `findToolEndEvent` (`memory-event-store.ts`, serving
  `/api/session/:id/tool-result/:toolCallId`) returns the most recent end. If a
  real end could ever land after a synthesized one, that endpoint would serve
  the synthesized `isError:true`. Ordering says it cannot (the synthesis runs on
  the terminal transition, single-threaded), but the helper is written so a
  later real end wins on the client regardless (D4).
- Heal scan runs on every session end — bounded by `agent_start` and the store's
  retained window (D2); measured in the task's verification, not assumed.
- Parser change (D7) flips every historical orphan-closed tool call in every
  transcript from a silent empty success to an error card. That is the point,
  but it is a visible change to already-archived sessions.
- Marker-based throttle migration writes to the user's `config.json` once. A
  user who had deliberately set `0` before this release loses it — accepted:
  `0` was never a chosen value, `ensureConfig` materialized it.
- Long turn beyond the store cap (D2) — degrades to "visible window", never to
  a wrong terminal state.
- Card text "parent session ended" is an error-styled result; acceptable and
  truthful.
- Memoized npm root goes stale if the user changes the global npm prefix
  mid-process — same trade-off the scanner already makes; a restart clears it.

## Verification shape

- Unit: `findOpenToolCalls` — mixed open/closed, Agent with/without update
  carrying `agentId`, prior-turn open call excluded, empty input.
- Integration (`event-wiring`): ending with 2 open calls → 2 inserts + 2
  broadcasts before `session_updated`; zero open → zero inserts; replay after
  the end contains the synthesized events; `update({status:"ended"})` (no
  unregister) heals identically; `onEnded` firing twice inserts once.
- Parser (`state-replay`): a transcript whose last turn has an unclosed tool
  call replays `tool_execution_end{isError:true, healedBy:"session_ended"}` for
  it; a fully-closed transcript is unchanged.
- Cold hydration end-to-end: reopen an ended session after a server restart —
  the tool card is an error card, matching what the live heal showed before.
- Reducer: `session_ended` heal flips running Agent card + subagent to
  error/failed; ignored on `complete` row and on unknown id.
- Config: default `500`; stored `0` without the marker migrates to `500` and
  sets the marker; stored `0` WITH the marker stays `0`; a stored non-zero value
  is never touched.
- Resolver: with `rootGlobalOr` spied, N calls to `resolvePiPackageEntry` /
  `listPiPackages` without `npmRoot` → 1 spy call; `opts.npmRoot` bypasses the
  cache; reset helper clears it. Re-run `/tmp/perchild-cost-spike.mjs wrapper 7`:
  loop block < 300 ms (was 3.3 s).
- Live: kill a pi process (`kill -9 <pid>`) mid-`Agent` run from a
  dashboard-attached session; after grace expiry the card and subagent show
  error state; reload the page — still terminal.
