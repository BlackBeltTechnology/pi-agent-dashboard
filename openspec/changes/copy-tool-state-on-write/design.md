# Design: tool-call map copy-on-write

## Context

See [proposal.md](proposal.md) for motivation and scope.
`reduceEvent` currently starts with an unconditional `new Map(state.toolCalls)` (`packages/client/src/lib/chat/event-reducer.ts:1847–1853`).
Writes also occur outside its main switch: healed-row reopening, seeding a running call, and nested-root updates (`packages/client/src/lib/chat/event-reducer.ts:638–705,1659–1713`).
The Agent update path captures a pre-event `prior` map and can undo a row revive through a finalizer (`packages/client/src/lib/chat/event-reducer.ts:2612–2635`; `packages/subagents-plugin/src/client/toolRowFinalizer.ts:280–305,347–363`).
Finalizers receive post-row state, an update's pre-row `prior`, and a callback that synchronously re-enters the reducer (`packages/dashboard-plugin-runtime/src/session-event-reducers.ts:42–79`).
The subagents finalizer uses that callback and can return a separately copied map or delete a revived entry (`packages/subagents-plugin/src/client/toolRowFinalizer.ts:105–133,294–305`).
Reducer slices must remain pure and own only their designated fields (`packages/dashboard-plugin-runtime/src/session-event-reducers.ts:27–38`; `openspec/specs/dashboard-plugin-loader/spec.md`, “Plugins register session event reducer slices”).
Backfill separately seeds server-reported open tool calls (`packages/client/src/hooks/useMessageHandler.ts:1215–1231`).

## Goals / Non-Goals

Remove the event-by-historical-tool-count map-copy cost for events that do not write tool-call state.
Do not change the `SessionState` shape, introduce persistent collections, alter tool lifecycle rules, change plugin signatures, or redesign other reducer fields.
No public identity promise is introduced for either the state object or its map.
Sharing unchanged `toolCalls` is the internal mechanism used to establish removal of map-copy work, not an API consumers may newly depend on.

## Decisions

### D1. Local copy-on-write, not an event-type allowlist

Start a reduction sharing the input map.
Before a core writer calls `set`, `delete`, or `clear`, establish ownership by copying if the current map is shared.
Subsequent writes in the same uninterrupted ownership period reuse that owned map.
Keep read-only events on the no-copy path without scanning or comparing all map entries to discover whether a copy was needed.

Prefer a small local write-ownership helper and explicit writer calls over a Proxy, a new collection library, or an event-type whitelist.
An event name alone cannot determine whether nested, revive, heal, or plugin work writes the map.
The exact helper name is not a contract; ownership and coverage are.

### D2. Publication ends exclusive ownership

A map becomes shared when its containing state escapes to a callback, a nested reducer, a saved `prior` snapshot, or the caller.
A local boolean must not keep treating that map as exclusively writable after publication.
Before further core writes, reacquire ownership from the current map, including maps returned by a plugin or nested reduction.
Neither the outer input map nor a map observed by an earlier callback may change later in the same outer reduction.
Do not cache ownership globally or on `SessionState`.

For example, `subagent_completed` reaches the Agent finalizer, which passes a running tool map to `opts.reduce` with a synthesized `tool_execution_end` (`packages/client/src/lib/chat/event-reducer.ts:3115–3118`; `packages/subagents-plugin/src/client/toolRowFinalizer.ts:108–134,157–191`).
The nested reduction must copy before marking that tool complete; the outer input and the callback's retained map must still show it running.
Current outer paths do not write the map after the finalizer returns; the ownership rule does not require adding such a path.

### D3. Audit every map writer, preserve entry immutability

Route direct switch writes and helper writes through the same ownership rule.
Cover top-level start/update/end, nested root updates and record merges, session-ended reopen, seed/revive, and generic orphan heals.
A shallow map copy does not make entries or nested arrays writable: replace changed entries and nested records rather than mutating anything reachable from a prior state.
Keep `seedRunningToolCall`'s existing no-op identity and its independently called backfill behavior.
Do not force backfill or plugins to adopt a new API.

### D4. Preserve extension behavior, do not add defensive copies on reads

Retain callback order, enabled-plugin filtering, decline behavior, `opts.isLive`, pre-event `prior`, synchronous `opts.reduce`, and returned state selection.
Treat returned maps as shared before any subsequent outer write.
Slices retain their existing pure, field-owned contract; arbitrary plugin mutation of input is not newly supported.
Callbacks that only read the map do not justify an eager copy.
A finalizer that writes through its existing immutable return path can still allocate its own map.

### D5. Verify work removal without unstable timing assertions

At historical map sizes 0, 100, 1,000, and 10,000, fold a fixed 1,000-event mix of pure text updates, thinking updates, and no-op events.
Run this no-write fixture with plugins absent or returning their input; exercise independently allocating callbacks separately under D4.
Require the same map reference across every fixture event and zero map-copy or full-map-enumeration operations attributable to core tool-map ownership.
Use scoped instrumentation of the map copy/iteration path without replacing unrelated global Map behavior.
For a write-heavy comparison, report copies and elapsed time separately; it is not required to become copy-free.
Record before/after reducer timings on the same workload and environment, but do not invent a phone-latency or p95 threshold.
Require the shared [four-way comparison](../../streaming-performance-comparison.md#shared-four-way-comparison-p2) before closing either optimization's performance acceptance.
It compares baseline, collapse-only, copy-on-write-only, and both using both source candidates without requiring either to merge first.

## Alternatives

- Keep eager cloning: simplest ownership but preserves the identified cost for text-only catch-up.
- Mutate the input map: removes copies by breaking prior snapshots and plugin purity.
- Clone selected event types: misses indirect helper and extension writes as behavior evolves.
- Proxy or persistent-map library: larger type/runtime/dependency surface than the existing map and explicit write sites require.

## Risks / Trade-offs

- A missed indirect writer corrupts prior state → audit writers and retain saved input, callback, and nested-reducer states in regression tests.
- A stale ownership flag survives callback publication → end exclusive ownership explicitly at every escape boundary.
- A shallow copy still shares mutable entries → assert old entries and nested arrays remain unchanged after writes.
- Correct write-heavy events can still copy more than once → measure no-write elimination, not an unsafe one-copy-per-event ceiling.

## Verification Baseline

This optimization preserves the reducer's pre-change event behavior and existing tests; it does not claim whole-capability specification conformance.
Use concrete expected states for text/thinking/tool/nested/revive/settle sequences and retain input, callback, and re-entrant snapshots to check isolation.
Include text updates with `streamingTextFlushed` both false and true: the latter must continue ignoring replacement text (`packages/client/src/lib/chat/event-reducer.ts:2244–2262`).
For allocation tests, choose events whose actual paths do not write or replace the tool map; do not infer that classification solely from a requirement's prose.
Add generated lifecycle and callback/re-entry checks, not only fixed examples.
Reuse the dependency-free seeded Vitest approach from `packages/electron/src/lib/__tests__/peer-address-properties.test.ts`; [test-plan.md](test-plan.md#generated-case-contract-e7e8) defines the generator and independent checks.

Independent review identified existing specification drift that this refactor must not silently repair:

- `session_compact` is specified to clear state, but the current reducer appends a compaction row (`openspec/specs/event-reducer/spec.md:199–205`; `packages/client/src/lib/chat/event-reducer.ts:2891–2926`).
- The content-order requirement moves all unclaimed rows, whereas the reducer preserves unclaimed assistant/tool/thinking rows (`openspec/specs/event-reducer/spec.md:261–282`; `packages/client/src/lib/chat/event-reducer.ts:1040–1077`).
- The truncation requirement says retain 200 lines, but its final-result scenario lists lines 201–1000; the reducer retains 801–1000 (`openspec/specs/event-reducer/spec.md:598–619`; `packages/client/src/lib/chat/event-reducer.ts:1246–1262`).

These discrepancies are outside the requested allocation change.
Do not change reset, row-order, or truncation policy to resolve them here.
The existing requirements remain in force; their separate reconciliation is not a new dependency of the no-copy mechanism.

## Migration Plan

No migration or server upgrade is required.
A later authorized implementation can ship as a client rebuild; rollback restores eager cloning without changing persisted state or protocol.
This planning change does not implement, rebuild, or deploy anything.
