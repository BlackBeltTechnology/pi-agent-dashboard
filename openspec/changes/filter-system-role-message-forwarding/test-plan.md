# Test Plan — filter-system-role-message-forwarding

Stage: design   Generated: 2026-02-09

Clarifications C1 and C2 were resolved at the gate before this file was written:

- **C1** — The resolved pi dependency is 0.85.1 and never emits `role:"system"`,
  so every automated row drives **synthetic** events shaped like pi 0.86's emit
  (`agent-loop.js:52-54`). Real-runtime confirmation is one `manual-only` row
  (M1) against the global pi 0.86.1. No dependency bump in this change.
- **C2** — The compaction divider is verified at L1 on the reducer. No L3 row;
  see "New infra needed".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | system-role msgs not forwarded | decision-table (role × event-type) | L1 | automated | enriched events for each role ∈ {system, assistant, user, custom, toolResult} × each of {message_start, message_end} | each pair dispatched through the reduced bridge model | `event_forward` sent for every role except `system` and `custom`; zero sends for `system` on BOTH event types |
| E2 | system-role msgs not forwarded | data-leak assert | L1 | automated | system message whose `sections` embed marker `SYSPROMPT-MARKER` and a 150 KB filler, plus 40 `toolsAdded` entries | `message_start` then `message_end` dispatched | serialized wire output contains no occurrence of `SYSPROMPT-MARKER` and no `toolsAdded` name |
| E3 | role-only scope; subscription unchanged | EP (role partitions) | L1 | automated | assistant `message_start`/`message_end` pair immediately after a dropped system pair | dispatch in emit order system→assistant | both assistant events forwarded, in order, unchanged from the pre-change golden |
| E4 | custom handling preserved | state-transition (legal edge) | L1 | automated | `message_start` with `role:"custom"` | dispatch | barrier still runs before the custom early-return; no `event_forward` for the custom start (existing behaviour byte-identical) |
| E5 | after-barrier placement (D2) | source-contract (`region()`/`at()`) | L1 | automated | text of `packages/extension/src/bridge.ts` | read `message_start` branch region | index of `assistantMessageGen += 1` < index of `coalescer.messageStart(` < index of the `role === "system"` return; same ordering asserted in the `message_end` branch for `coalescer.messageEnd(` < system return |
| E6 | entry-level flush not bypassed (D2) | source-contract | L1 | automated | text of `packages/extension/src/bridge.ts` | read handler region above all branches | `flushesParkedText(eventType)` guard appears once, before the `message_start` branch opens — i.e. the system return cannot precede it |
| E7 | `compactionEntry` redacted | data-leak assert | L1 | automated | `session_compact` whose `compactionEntry.systemMessage.sections` embed `SYSPROMPT-MARKER` and whose `compactionEntry.summary` is a 64 KB string containing `SUMMARY-MARKER` | event forwarded | forwarded payload has no `compactionEntry` key and contains neither marker as a substring |
| E8 | consumer fields survive redaction | decision-table (field presence) | L1 | automated | `session_compact` with `reason:"threshold"`, `willRetry:false`, `fromExtension:false`, plus a `compactionEntry` | event forwarded | forwarded payload retains `reason`, `willRetry`, `fromExtension`; `eventType` is `session_compact` |
| E9 | redaction on absent field | BVA (empty partition) | L1 | automated | `session_compact` with no `compactionEntry` key at all | event forwarded | forwarded payload equals the input's serializable form; no `compactionEntry` key fabricated; no throw |
| E10 | divider + badge unaffected | state-transition (reducer) | L1 | automated | the **redacted** payload from E8 fed to the client reducer | reduce a `session_compact` event | a compaction divider message is appended AND `state.compaction` carries `reason:"threshold"`, `willRetry:false` |
| E11 | status flag still cleared | decision-table | L1 | automated | the redacted payload from E8 | `extractSessionUpdates` called | returns the `compacting`-clearing update identical to the pre-change result |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | parked snapshot not stranded | state-transition (REAL coalescer) | L1 | automated | a parked `message_update` text snapshot for assistant identity A | system `message_start` dispatched through the reduced model while A's snapshot is parked | the parked snapshot reaches the wire, ordered before any later forwarded event; no `event_forward` for the system message; converges to the same wire order as when the system message is absent |
| F2 | no empty streaming identity | state-transition (illegal edge) | L1 | automated | system `message_start` then `message_end`, then assistant `message_start`/`message_update`/`message_end` | dispatch in that order | the assistant message's updates are forwarded and attributed to the assistant identity; no update is dropped as belonging to the system key |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | redaction must not mutate pi's object | aliasing / shared-state | L1 | automated | a `session_compact` event object held by a second reference (standing in for another subscribed extension) | bridge redacts and forwards | the original object still owns `compactionEntry` with `systemMessage` and `summary` intact; the forwarded payload is a different object |
| X2 | malformed system message | fault-injection (bad input) | L1 | automated | `message_start` where `message` is `null`, then one where `message` is `{}` with no `role` | dispatch each | no throw; the no-role event follows the pre-change path (forwarded), the null-message event behaves byte-identically to pre-change |
| X3 | malformed compaction entry | fault-injection (bad input) | L1 | automated | `session_compact` where `compactionEntry` is `null`, and one where it is a string | event forwarded | no throw; no `compactionEntry` key on the forwarded payload in either case |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | real pi 0.86 runtime behaviour | exploratory on live runtime | — | manual-only | a dashboard-spawned session on the global pi 0.86.1 runtime, after `npm run reload` | start a fresh session, let it run one turn, then trigger a `/compact` | no stored event carries a system prompt section or `toolsAdded` list; no stored `session_compact` carries `compactionEntry`; the first assistant message renders normally and the compaction divider still appears |

---

## Coverage summary

- Requirements covered: 8/8 (both ADDED requirements' clauses, plus the MODIFIED
  requirement's exception enumeration via E1/E3/E4)
- Scenarios by class: edge 11 · perf 0 · frontend 2 · error 3 · manual 1
- Scenarios by level: L1 16 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 16 · manual-only 1

No performance rows: the change only removes payload, and the byte reduction is
asserted structurally by the leak rows (E2, E7) rather than by a threshold. The
measurement that motivates the change lives in `proposal.md`.

## New infra needed

- **None.** All 16 automated rows extend existing L1 vitest infrastructure in
  `packages/extension/src/__tests__/` (reduced-model + source-contract pattern
  per `bridge-coalesced-chat-order.test.ts`), plus the existing client reducer
  and server status-extraction suites for E10/E11.
- **No L3 row, deliberately** (C2): the compaction divider is derived from the
  event's presence, which E10 pins precisely at the reducer. An L3 row would
  require deterministically forcing a real compaction inside the docker harness
  for no additional signal.
- **No L2 row**: nothing in this change is process-, install- or OS-dependent.
- Note for authoring: the existing reduced model is a **partial** mirror — its
  `message_end` branch has no `custom` early return and its `messageStart` is
  called without the message argument (so `bindGeneration`/`generationOf` are
  not exercised). E1/E3/E4/F1/F2 must not be read as covering the nonce/generation
  correlation path.
- Note for authoring: per design D2, **no row may assert that the barrier causes
  a parked-snapshot flush** — that is the entry choke point's job (E6) and such
  an assertion would pass regardless of placement.
