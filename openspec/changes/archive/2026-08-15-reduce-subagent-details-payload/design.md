## Context

Every subagent progress tick carries the cumulative timeline. `agent.ts`
builds one `snapshotDetails()` object and hands it to BOTH carriers
(`agent.ts:993-1006`):

```
pushUpdate() → progress.schedule(details)   // → subagents:* event_forward
             → onUpdate({ …, details })     // → tool_execution_update
```

`entries` is append-only, so tick size grows linearly with run length on both
wire segments and in every stored event.

### The invariant that governs this design

Two doubt-review cycles established that the pipeline has a documented,
load-bearing invariant: **every subagent frame is an idempotent FULL snapshot,
latest-supersedes.** `subagent-frame-buffer.ts` states it verbatim — *"retain
the latest frame per `agentId` (each frame carries a FULL snapshot, so latest
supersedes older ones)"*.

Four independent hops depend on it, and a delta/incremental encoding breaks all
four:

| Hop | Mechanism | Effect of a delta |
|---|---|---|
| Producer throttle | `agent.ts:430-440` — `pending = details`, latest wins | skipped appends lost |
| Bridge frame buffer | `subagent-frame-buffer.ts` — latest-per-`agentId`; `resync()` replays that frame | intermediate deltas dropped; resync reply becomes unfoldable |
| Server collapse | `memory-event-store.ts:262-266` — `entriesSurvive` is VACUOUSLY TRUE when `entries` is absent | predecessors false-subsumed, entries permanently shed |
| WS back-pressure | `browser-gateway.ts:126-129`, `droppedFramesTotal` | any dropped frame is a permanent hole |

Independently: head-tail truncation REWRITES `entries` into head + sentinel +
tail, so a consumer's held count never matches a producer-side index — **any
count anchor is invalid the moment a ceiling fires**, which is exactly the long
runs this change targets.

### The pull path already exists

| Fact | Source |
|---|---|
| Client requests resync when a running subagent's timeline is empty | `AgentToolRenderer.tsx:222-233` (`requestResyncIfStale`) |
| Routed browser → server → owning bridge | `browser-gateway.ts:703`, `session-action-handler.ts:895` |
| Bridge answers from its retained snapshot, as a synthetic `subagents:started` `event_forward` | `bridge.ts:977-994` |
| The buffer retains the latest FULL snapshot of every RUNNING subagent, updated regardless of ready state, bounded at 64 agents, dropped on terminal | `subagent-frame-buffer.ts:18-23, 69-70, 121-131` |
| That reply becomes eventType `subagent_started` with data `{id, details}` | `flow-event-wiring.ts:90` |
| **The reply is NOT protected by the subagent-timeline ceiling.** `locateSubagentTimeline` matches only `toolName === "Agent"` or `tool_execution_update`/`end`, so a `subagent_started` frame falls through to the generic pass, where ANY array > 20 items becomes the string `"[array truncated]"`, which the reducer then ignores | `memory-event-store.ts:617-620`, `:388-393`, `createTruncator:853-860`, `event-reducer.ts:404-411` |
| The live broadcast sends the STORED event, so broadcast bytes == stored bytes | `event-wiring.ts:776-778` |

So the fat timeline is **already held in-process and already served on demand** —
but the last hop of that pull path is broken today for any run past 20 entries.
That is a pre-existing bug (a plausible root cause behind the recurring
"subagent inspector empty" fix history), and this design cannot lean on the pull
path without fixing it first (D5a).

## Goals / Non-Goals

**Goals:**

- Intermediate tick size becomes O(1) in timeline length, asserted on broadcast
  bytes.
- The timeline remains reachable on demand, with recovery semantics no weaker
  than today's.
- Finished-run replay is byte-for-byte unchanged.
- Correct against every producer version in the wild with no producer change.

**Non-Goals:**

- Changing the producer package. This design does not touch
  `@blackbelt-technology/pi-dashboard-subagents`.
- Any new wire key, delta encoding, index, or version negotiation.
- Changing retention or collapse policy (both keep working unchanged; see D5).
  Truncation needs ONE scoped fix to its type gate (D5a) — not a policy change.
- Reducing scalar fields (`activity`, tokens, counters) — bounded already.

## Decisions

### D1 — Measure first, and measure the CEILING of the win

Re-run the `scripts/heap-probe.mjs` + docker-harness A/B
(`[[faux:subagent-sustained]]`, GC floor over ≥ 60 s) on current `main`. Record
per-tick bytes on both wire segments as a function of accumulated entry count.

**Additionally measure the inspector-open share** — what fraction of subagent
runtime has a detail view mounted. This bounds the achievable win: if inspectors
are open for most of a run, the fat payload flows anyway and this change buys
little. That measurement is the kill switch for the whole design, so it comes
first.

*Alternative rejected:* implement then measure. The collapse A/B already
demonstrated a size intuition inverting under measurement.

### D2 — Strip at the BRIDGE, not at the producer

The bridge sees every frame, already retains the fat snapshot, and is **our
code in this repo** (`packages/extension/`). Stripping there rather than at the
source is the decision that collapses the entire cross-package problem:

- no producer release, capability flag, or minimum-version note;
- the old-producer requirement is satisfied *by construction* — the reduction is
  downstream of every producer version that exists;
- the multi-party compatibility matrix reduces to one party.

Rule: on the forward path, a frame describing a NON-terminal subagent
(`queued`/`running`) has `details.entries` removed; the buffered copy keeps it.
Terminal frames and resync replies forward unchanged.

Applied at BOTH carriers — the `subagents:*` `event_forward` and the
`tool_execution_update` — because one `snapshotDetails()` object feeds both
(`agent.ts:993-1006`). The bridge already separates these concerns structurally:
`markForwarded(channel, data)` and `buffer(channel, data)` are distinct hooks
(`bridge.ts:2069-2070`).

**Strip placement is a decision, not a detail.** There is no single chokepoint:

- `sendEventForward` is the wrong place — the resync reply itself calls it
  directly (`bridge.ts:986`) for a frame describing a RUNNING agent, so a strip
  there would strip the very reply the pull model depends on;
- the EventBus forward path is also insufficient alone — `flushPendingSubagentFrames`
  drains buffered frames via `sendEventForward` directly (`bridge.ts:2040-2050`),
  so fat intermediate frames would leak past a bus-path-only strip;
- the two carriers are structurally disjoint: `subagents:*` frames flow through
  the EventBus path with the `markForwarded`/`buffer` hooks
  (`flow-event-wiring.ts:63-90`), while `tool_execution_update` is a pi core
  event forwarded via `pi.on()` → `connection.send`. Two injection points, not
  one.

So the strip is applied at an explicit ALLOWLIST of call sites with a
"fat-allowed" flag for resync + terminal, and the predicate is an allowlist of
non-terminal statuses (`queued`/`running`) — not a `!terminal` negation, since
`AgentStatus` also carries `"stopped"` (`events.ts:34-36`, unemitted today).

The strip MUST clone. `SubagentFrameBuffer` retains the frame **by reference**
(`subagent-frame-buffer.ts:110-120`), so a mutating strip corrupts the retained
fat snapshot — turning the pull source into another thin frame.

*Alternatives considered:*

- **Producer-side delta** — rejected: breaks the four-hop invariant above,
  requires a bridge→producer resync channel, and forces a four-party version
  matrix (producer, bridge, server, client, all independently versioned).
- **Producer-side window snapshot** (last N entries + total) — preserves
  latest-wins and is a genuine option, but still a producer release, still loses
  head fidelity, and still needs the same open-inspector liveness work. Strictly
  dominated by stripping at the bridge.
- **Server-side strip** — the server would have to re-serve the timeline it just
  discarded, i.e. hold per-agent state on the hottest ingest path, and that
  state cannot survive JSON-persistence reload. The bridge already holds it
  legitimately, scoped to the live session.

### D3 — Never strip a terminal frame

The terminal frame is the durable record: `tool_execution_end` backfill
(`event-reducer.ts:2017-2084`) is what makes a finished run render after a
refresh, and the frame buffer drops finished agents so no resync can recover
them afterwards.

Terminal covers `completed`, `failed`, **`aborted`, and early-error exits**
(`agent.ts:1041`, `1219`, `1233`). A terminal path that is stripped by accident
is a run whose timeline is gone forever — the single highest-severity failure
mode in this change, and the one the tests must pin hardest.

### D4 — Open-inspector liveness is the one genuinely new mechanism

Today the open inspector is fed by the push firehose. Stripping removes that, so
the trigger must change. `requestResyncIfStale` currently fires only on
open/expand AND only when the timeline is empty
(`AgentToolRenderer.tsx:226-233`) — a mounted view watching a growing timeline
never re-fires.

- **v1 — cadence, no protocol change**: while a detail view is mounted for a
  RUNNING subagent, re-fire the existing `subagent_resync_request` on a low
  cadence. Fat frames flow only for the agent someone is actually watching.
  Drop the `emptyTimeline` precondition on this trigger (keep it for the
  open-time one).
- **v2 — watch signal, only if v1 is too coarse**: the client declares a watched
  `agentId`; the bridge stops stripping for that agent, restoring today's live
  push scoped to one agent and one viewer.

Ship v1. Escalate to v2 only on measured evidence that the cadence is
perceptible, and record that evidence.

### D5 — Everything downstream keeps working UNCHANGED

This is the design's main claim and each limb is checkable:

| Mechanism | Why it is unaffected |
|---|---|
| Collapse predicate | Thin ticks are still full snapshots with stable key sets; with `entries` never present, the non-empty→empty violation `entriesSurvive` guards cannot arise. Collapse becomes MORE effective. |
| Truncation ceilings | Thin ticks have no timeline to truncate, and TOOL-carrier fat frames (`tool_execution_end`) engage the head-tail budget exactly as today. **One scoped fix is required** for the `subagent_*` carrier — see D5a. |
| Producer throttle | Untouched; still coalescing full snapshots. |
| Frame buffer | Untouched semantics; it keeps buffering the FAT frame — that is now load-bearing rather than best-effort (see Risks). |
| Reducer merge | Untouched. A frame without `entries` is already a no-op for the timeline under the existing empty-array overwrite guard (`event-reducer.ts:404-410`). |
| Old clients | Unchanged code path: they already fire resync on an empty timeline when opening an inspector, and now get a fat reply. Degradation is "timeline populates on open" instead of pre-pushed. |

### D5a — Extend the truncation type gate to the `subagent_*` carrier (REQUIRED)

`locateSubagentTimeline` gates on `data.toolName === "Agent"` OR
`tool_execution_update`/`tool_execution_end` with `details.agentId`
(`memory-event-store.ts:617-620`). A resync reply is `subagent_started` with
`{id, details}` and matches neither, so it takes the generic pass and its
`entries` array is clobbered to `"[array truncated]"` at > 20 items.

Extend the gate to also match `subagent_*` event types carrying
`details.entries`. Then the head-tail budget applies, the generic clobber is
unreachable, and the pull path delivers a real (bounded) timeline.

This is the ONLY server-side change in the design, it is confined to one type
predicate, and **it is a standalone bug fix**: today a resync for any run past
20 entries silently returns no timeline at all. It must land FIRST — the rest of
the design leans on the pull path being functional.

*Consequence for the spec:* "the same truncation ceilings as today's
full-payload frames" means the head-tail budget — a long timeline is served
head + sentinel + tail, not verbatim. That is the existing, accepted contract
for over-ceiling runs; the pull path merely starts honouring it.

### D6 — Observability

`/api/health` `storeTrim` gains additive counters (subagent-tick bytes ingested
/ broadcast) mirroring `collapsedUpdates`. The bridge's existing resync stats
(`resyncRequests` / `resyncServed` / `resyncNoop`) gain a cadence counter so the
new pull loop is provably not a new firehose.

The spec's ≤ 2x bound is a GROWTH CURVE, which cumulative counters cannot
assert — the gate is a test serializing successive broadcast payloads across a
growing timeline. Additive fields only; update the exact-shape `toEqual` in
`memory-event-store.test.ts` in the same commit.

## Risks / Trade-offs

- **A stripped terminal frame loses a timeline permanently** → D3; pinned by
  tests over every terminal path including `aborted` and early-error, with an
  anti-vacuity check that mis-classifying terminal as non-terminal fails them.
- **Open-inspector latency regresses** (push → pull) → D4 v1 measured against
  perceived latency before ship; v2 watch signal is the designed escalation.
- **The frame buffer becomes load-bearing, not best-effort** → its 64-agent
  bound and eviction policy need review; a run evicted from the buffer can no
  longer be resynced mid-run (it still lands at terminal). Raise the bound or
  document the ceiling with a counter.
- **`toolDetails` on the message row goes thin mid-run**
  (`event-reducer.ts:1893`) → audit every consumer reading `entries` off the raw
  object: renderers, plugins, exports, the session distiller.
- **Mid-run replay content changes** → a replayed in-flight run yields scalars
  until a resync is served. This is a real behavioural change, is spec'd
  explicitly, and is recoverable — but it must not be discovered in the field.
- **An open inspector re-fattens the store** → `subagent_started` frames never
  collapse (`resolveUpdateDetails` requires `data.partialResult.details`,
  `memory-event-store.ts:193-199`), so each cadence reply is stored fat while a
  view is mounted, and is broadcast to every subscriber of that session, not
  only the requester. The store win is therefore real only while nobody is
  watching. D1's inspector-open share bounds it, and v2's watch signal is the
  escalation if the cadence proves costly.
- **A run that dies without a terminal frame loses more than it does today** →
  crash/kill leaves only thin ticks in the store, and recovery needs a LIVE
  bridge (`bridge.ts:980` gates on `sessionReady && isActive()`) with the agent
  still in the 64-entry buffer. Today the fat ticks in the store would replay a
  partial timeline. This window is a genuine regression and must be stated in
  the spec rather than discovered in the field.
- **The win may be small** → D1 measures the inspector-open share first and
  kills the change if the fat payload flows anyway.

## Migration Plan

1. Measure (D1): post-collapse tick bytes + inspector-open share. Write
   `heap-evidence.md`. If the ceiling is low, stop here and correct the
   proposal's framing.
2. Land D5a (truncation type gate) FIRST and alone — it is a standalone bug fix
   and every later step depends on the pull path working.
3. Land the bridge strip (D2/D3) with the fat buffer retained, behind a config
   flag defaulted ON only after step 4 is in the same build.
4. Land the open-inspector cadence (D4 v1) and the counters (D6).
4. Re-measure; assert the ≤ 2x bound on broadcast bytes and confirm the resync
   rate did not replace the firehose it removed.

Rollback: one flag — the bridge forwards frames unstripped and behaviour is
byte-identical to today. No producer, protocol, or store rollback exists to do.

## Open Questions

- Is the frame buffer's 64-agent bound sufficient once resync is load-bearing,
  and what is the right behaviour when a running agent has been evicted from it?
- Does any consumer of raw `toolDetails` (renderers, plugins, exports, session
  distiller) depend on mid-run `entries`? An audit answers this before ship.
- Should the cadence in D4 v1 be fixed, or backoff-scaled by timeline size? A
  fixed low cadence is the simpler default; evidence from D1 decides.
- A resync reply fans out to every browser subscribed to the session, not just
  the requester. Is that acceptable at cadence rate, or does the reply need
  requester-scoped delivery? (Pre-existing behaviour, newly load-bearing.)
- An old client that opens an inspector while the timeline is NON-empty never
  re-fires resync (`requestResyncIfStale` requires `emptyTimeline`) and freezes
  at the open-time snapshot. Acceptable degradation, or worth a targeted fix?
