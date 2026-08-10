# Design — resolve-subagent-inspector-by-session-id

## Context

Two id spaces name one subagent run (see `proposal.md` Why). The `subagents` map
is keyed only by the v4 `agentId`; the v7 runner `session.id` never enters it.
Goal: make the map resolvable by **either** id, without changing how `agentId` is
minted and without a cross-repo lockstep deploy (older producer must not regress).

## Decision 1 — New optional field `agentSessionId` on `AgentDetails` (producer, v0.2.3)

The field lives on **`AgentDetails`** (the producer's per-snapshot detail object),
populated in `snapshotDetails()` = the runner `createResult.session.id`.
**Optional**: consumers treat its absence as "single-key, as today."

- **On `AgentDetails`, NOT a bare top-level frame field.** `AgentDetails` is the
  `details` payload of BOTH the live `subagents:*` frames AND the Agent tool's
  return, which becomes the `tool_execution_end` `details`. Putting the field on
  `AgentDetails` makes it flow through **both** consume paths from one producer
  edit — the live-frame reducer arm (`readSubagentDetails(details)`) and the
  `tool_execution_end` (`toolName === "Agent"`) backfill (`endDetails`). A
  frame-only field would MISS the backfill path, which is the dominant real case:
  after `/resume` or a refresh, state-replay synthesizes NO `subagents:*` frames
  (see `event-reducer.ts` ~L1644) and rehydrates completed subagents solely from
  the `tool_execution_end` backfill. **(doubt-review F3 — the headline fix would
  otherwise be inert exactly when a completed subagent is viewed after refresh.)**
- **Name.** `agentSessionId` (not bare `sessionId`) — the payload flows inside the
  PARENT session's `event_forward`; a bare `sessionId` risks being read as the
  parent. `agentSessionId` unambiguously names the subagent runner's own id.
- **Why a field, not a lookup.** The consume side has no other channel to learn
  the runner id — it is minted inside the producer's in-memory spawn.

**Type home (consume side, in-repo):** `SubagentState` and the client's
`AgentDetails` mirror live in `packages/subagents-plugin/src/client`, which is
workspace-symlinked into `packages/client` (verified: `node_modules/...plugin ->
../../packages/subagents-plugin`), so adding the optional field is a local edit
with no publish. **(doubt-review F6.)**

## Decision 2 — Dual-index in the event reducer (client `subagents` map)

On every subagent frame arm AND the `tool_execution_end` `toolName === "Agent"`
backfill: when `agentSessionId` is present, set `session.subagents` under **both**
keys to the **same** `SubagentState` object, and persist `agentSessionId` on the
state.

```
subagents.set(agentId, state)
if (state.agentSessionId) subagents.set(state.agentSessionId, state)   // alias → same ref
```

- Every existing `.get()` (SubagentDetailView, popout, resync guard) resolves
  either id with **zero call-site changes**.
- Each frame is a full-snapshot replace; re-setting both keys each frame keeps
  the alias current (latest-wins, same as today).
- **Same reference** so a later update via one key is visible via the other.

### Invariants (doubt-review N1/N2)

- **`state.id` stays canonical v4.** The aliased state's `.id` remains the
  `agentId`, even when retrieved via the v7 key. Consumers MUST NOT assume the
  lookup key equals `state.id`/`agentId` (a v7 route param resolves a state whose
  `.id` is the v4). Every current call site keys by the route/detail id and reads
  fields off the state — none equate the two — so this holds today.
- **De-dup any future enumeration.** Dual-`set` is safe for `.get()` and `.size`
  truthiness (the only current access shapes). A FUTURE `.values()/.entries()`
  render would double-count aliased agents; such a render MUST de-dup by
  `state.id`. Called out so it is not discovered by a double-render regression.
- **Client alias key is session-lifetime by design (doubt-review cycle-2 F5).**
  Unlike the bridge buffer, the client `session.subagents` map is NOT capped; the
  completed arm SETs (never deletes) the entry, so the `agentSessionId` key
  persists for the session — acceptable session-scoped foreground state (~2× the
  subagent count, bounded by session lifetime). **Paired-key invariant:** the
  `agentId` and `agentSessionId` keys are a PAIR pointing at one ref — any future
  change that deletes one on completion MUST delete the other, else the survivor
  is a dangling orphan.

### Alternative rejected — a separate `sessionId → agentId` lookup map in the client
Adds a second indirection every `.get()` must consult; touches every call site.
Dual-set into the existing map is smaller and keeps call sites untouched.

## Decision 3 — Resync-by-session-id is DERIVED from `snapshots`, not a tracked alias

**Cycle-2 introduced a separate `aliasToAgentId` map + `finished` guard; cycle-3
showed that structure has its own edges (a bounded `finished` set defeats its own
revival guard past 64 completions; a re-populated key can orphan the old one).
The fix is to remove the separate structure entirely and DERIVE the mapping.**

The `SubagentFrameBuffer` keeps its `agentId`-keyed `pending`/`snapshots` maps
exactly as today — no new map, no `finished` set. `resync(id)` resolves as:

```
resync(id):
  snap = snapshots.get(id)                                   // fast path: id is an agentId
  if (!snap)                                                 // else: id may be an agentSessionId
    snap = [...snapshots.values()].find(s => s.details.agentSessionId === id)
  return snap ?? no-op                                       // unknown/finished → silent no-op
```

- **Why a scan is fine.** Resync is a rare, user-initiated request (open a
  running subagent's detail/popout, or reconnect). `snapshots` is bounded to 64
  logical agents, so the fallback scan is O(≤64) on a cold path — negligible.
- **Self-bounding, zero lifecycle.** The mapping is a pure function of
  `snapshots`. It cannot leak, diverge, or accumulate: when the terminal branch
  or overflow eviction removes a snapshot, the derived mapping for it is gone with
  it — no populate/delete symmetry, no collision-safe delete, no `finished` set,
  no `reset()` alias clear. **Dissolves cycle-2 F2/F4/F6 and cycle-3 A/D.**
- **Terminal-first is a non-issue.** A `created→completed` whose first observed
  frame is terminal never retains a running snapshot, so a scan finds nothing —
  no leak, no stale serve. The completed run is dual-indexed **client-side** via
  the reducer's completed/backfill arm, independent of this bridge path.
- **Revival after terminal (cycle-3 C).** With no alias to leak, a late/duplicate
  non-terminal frame at worst re-adds a snapshot (already bounded to 64). Per the
  cycle-3 finding this is not practically triggerable on the bridge (flush emits
  buffered frames in insertion order before later live frames; TCP preserves
  order; state-replay emits no `subagent_*` frames), so no extra guard is
  warranted — matching the existing variant-A path's assumptions.
- **Resync log label (N3):** log BOTH the incoming id and the resolved `agentId`
  (the incoming may be a v7), so the log is not misleading.

### `agentSessionId` is immutable per `agentId` (invariant, cycle-3 B)

The producer mints the runner `session.id` ONCE at spawn (`createAgentSession`),
so every frame for a given `agentId` carries the SAME `agentSessionId`. The
consume side relies on this: the derived scan and the client dual-index assume one
stable `agentSessionId` per `agentId`. A producer that changed it mid-run would
orphan the client's prior alias key — out of scope and contract-forbidden; stated
here so the assumption is explicit rather than accidental.

## Decision 4 — Resync request may carry either id

`subagent_resync_request { sessionId(parent), agentId }` is unchanged on the wire;
the `agentId` field may now hold a v7. The client sends whichever id the surface
holds:
- `AgentToolRenderer.requestResyncIfStale` already reads `details.agentId` (v4) —
  unchanged; still correct.
- `SubagentPopoutClaim` sends `params.agentId`, which may be a v7 from a deep link.
The bridge resolves via Decision 3. No new message type.

## Decision 5 — Graceful degrade (no cross-repo lockstep)

With producer `< 0.2.3` (no `agentSessionId`): reducer sets only the `agentId`
key; bridge builds no alias; a v7-routed inspector shows "Subagent not found" —
**exactly today's behaviour**. No regression. The dependency floor bump
(`>= 0.2.3`) is what makes the fix active on fresh installs; the consume code is
safe to land first and is inert until the producer ships.

## Decision 6 — Scope boundary

In scope: the `:agentId` slot of `/session/:sessionId/subagent/:agentId`, the
card, the inline expand, and resync. Out of scope (Non-Goals in proposal): the
duplicate gateway-session registration, the v4 mint, and a runner id used in the
parent `:sessionId` slot.

## Risks

| Risk | Mitigation |
|---|---|
| Bridge alias leaks / diverges (cycle-2/3 F1/F2/F4/A/D) | **Dissolved by Decision 3's derived scan** — no separate alias map or `finished` set exists; the resync mapping is a pure function of the already-bounded `snapshots` map. |
| Client map doubles entries; session-lifetime keys | Aliases share the state ref; client map is session-scoped foreground state (F5, documented); paired-key invariant on any future delete. |
| `agentSessionId` mutates per `agentId` (cycle-3 B) | Contract-forbidden invariant: producer mints `session.id` once at spawn; stated explicitly in Decision 3. |
| `agentSessionId` collides with a real `agentId` | v7 vs v4 are disjoint value spaces; a collision is astronomically unlikely and would only alias a run to itself. |
| Producer ships late | Consume side degrades to today's behaviour; no regression; floor bump gates activation. |
| Backfill path missed (F3) | `agentSessionId` on `AgentDetails` (Decision 1) reaches BOTH the live frame arm AND the `tool_execution_end` `Agent` backfill; both dual-index — each covered by a reducer scenario. |
| Contract #5 (no clobber) regressed | Preserved: dual-index keeps ONE state ref per logical agent and leaves the entries-merge logic untouched — the alias is a second key, not a second object. (doubt-review N4.) |

## Test Strategy

Unit (L1, vitest) is the primary level — reducer dual-index, frame-buffer alias
resolution, graceful-absence. `scenario-design` derives the full scenario set and
the manifest; this section states intent only.
