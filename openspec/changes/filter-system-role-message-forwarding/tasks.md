# Tasks — filter-system-role-message-forwarding

Test tasks are folded from `test-plan.md`; that manifest is the source of truth
for which scenarios are automated and which are manual. Write the tests first,
watch them fail, then implement.

## 1. Tests — bridge message arms (L1, vitest)

Harness exemplar for every task in this section: `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`
(reduced model driving the REAL coalescer + `region()`/`at()` source-contract asserts).
Note it is a partial mirror: its `message_end` branch has no `custom` early return and its
`messageStart` is called without the message argument.

- [ ] 1.1 Role × event-type decision table (test-plan #E1): input = enriched events for each role in {system, assistant, user, custom, toolResult} × each of {message_start, message_end} · trigger = each pair dispatched through the reduced bridge model · observable = `event_forward` sent for every role except `system` and `custom`, zero sends for `system` on both event types. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.2 System payload leaks nothing (test-plan #E2): input = system message whose `sections` embed marker `SYSPROMPT-MARKER` plus a 150 KB filler and 40 `toolsAdded` entries · trigger = `message_start` then `message_end` dispatched · observable = serialized wire output contains no occurrence of `SYSPROMPT-MARKER` and no `toolsAdded` name. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.3 Assistant pair after a dropped system pair (test-plan #E3): input = assistant `message_start`/`message_end` immediately after a dropped system pair · trigger = dispatch in emit order system→assistant · observable = both assistant events forwarded, in order, unchanged from the pre-change golden. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.4 Custom handling preserved (test-plan #E4): input = `message_start` with `role:"custom"` · trigger = dispatch · observable = barrier still runs before the custom early-return, no `event_forward` for the custom start, existing behaviour byte-identical. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.5 After-barrier placement source contract (test-plan #E5): input = text of `packages/extension/src/bridge.ts` · trigger = read the `message_start` branch region · observable = index of `assistantMessageGen += 1` < index of `coalescer.messageStart(` < index of the `role === "system"` return, and in the `message_end` branch `coalescer.messageEnd(` < the system return. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.6 Entry-level flush not bypassed (test-plan #E6): input = text of `packages/extension/src/bridge.ts` · trigger = read the handler region above all branches · observable = the `flushesParkedText(eventType)` guard appears once, before the `message_start` branch opens, so the system return cannot precede it. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.7 Parked snapshot not stranded (test-plan #F1): input = a parked `message_update` text snapshot for assistant identity A · trigger = system `message_start` dispatched through the reduced model while A's snapshot is parked · observable = the parked snapshot reaches the wire ordered before any later forwarded event, no `event_forward` for the system message, wire order converges to the system-message-absent case. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.8 No empty streaming identity (test-plan #F2): input = system `message_start`/`message_end`, then assistant `message_start`/`message_update`/`message_end` · trigger = dispatch in that order · observable = the assistant message's updates are forwarded and attributed to the assistant identity, none dropped as belonging to the system key. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.
- [ ] 1.9 Malformed system message (test-plan #X2): input = `message_start` where `message` is `null`, then one where `message` is `{}` with no `role` · trigger = dispatch each · observable = no throw, the no-role event follows the pre-change path (forwarded), the null-message event behaves byte-identically to pre-change. See `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`.

## 2. Tests — session_compact redaction (L1, vitest)

Harness exemplar for this section: `packages/extension/src/__tests__/event-forwarder.test.ts`
(direct `mapEventToProtocol` mapping asserts); pair it with the reduced-model file above
for the bridge-side redaction site.

- [ ] 2.1 compactionEntry stripped, no leak (test-plan #E7): input = `session_compact` whose `compactionEntry.systemMessage.sections` embed `SYSPROMPT-MARKER` and whose `compactionEntry.summary` is a 64 KB string containing `SUMMARY-MARKER` · trigger = event forwarded · observable = forwarded payload has no `compactionEntry` key and contains neither marker as a substring. See `packages/extension/src/__tests__/event-forwarder.test.ts`.
- [ ] 2.2 Consumer fields survive redaction (test-plan #E8): input = `session_compact` with `reason:"threshold"`, `willRetry:false`, `fromExtension:false`, plus a `compactionEntry` · trigger = event forwarded · observable = forwarded payload retains `reason`, `willRetry`, `fromExtension`, and `eventType` is `session_compact`. See `packages/extension/src/__tests__/event-forwarder.test.ts`.
- [ ] 2.3 Absent compactionEntry (test-plan #E9): input = `session_compact` with no `compactionEntry` key at all · trigger = event forwarded · observable = forwarded payload equals the input's serializable form, no `compactionEntry` key fabricated, no throw. See `packages/extension/src/__tests__/event-forwarder.test.ts`.
- [ ] 2.4 Redaction does not mutate pi's event object (test-plan #X1): input = a `session_compact` event object held by a second reference, standing in for another subscribed extension · trigger = bridge redacts and forwards · observable = the original object still owns `compactionEntry` with `systemMessage` and `summary` intact, and the forwarded payload is a different object. See `packages/extension/src/__tests__/event-forwarder.test.ts`.
- [ ] 2.5 Malformed compaction entry (test-plan #X3): input = `session_compact` where `compactionEntry` is `null`, and one where it is a string · trigger = event forwarded · observable = no throw, and no `compactionEntry` key on the forwarded payload in either case. See `packages/extension/src/__tests__/event-forwarder.test.ts`.

## 3. Tests — downstream consumers unaffected (L1, vitest)

- [ ] 3.1 Compaction divider and badge still render (test-plan #E10): input = the redacted payload from scenario E8 fed to the client reducer · trigger = reduce a `session_compact` event · observable = a compaction divider message is appended AND `state.compaction` carries `reason:"threshold"` and `willRetry:false`. See `packages/client/src/lib/__tests__/event-reducer-compaction.test.ts`.
- [ ] 3.2 Compacting status flag still cleared (test-plan #E11): input = the redacted payload from scenario E8 · trigger = `extractSessionUpdates` called · observable = returns the `compacting`-clearing update identical to the pre-change result. See `packages/server/src/__tests__/event-status-extraction.test.ts`.

## 4. Verify the tests fail

- [ ] 4.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — confirm the new tests from sections 1–3 FAIL before any implementation, and that the failures are the asserted observables rather than setup errors.

## 5. Implement — bridge

- [ ] 5.1 `packages/extension/src/bridge.ts` `message_start` arm: early-return when `event.message?.role === "system"`, placed immediately after the existing `role === "custom"` return so the coalescer barrier still runs first (design D2).
- [ ] 5.2 `packages/extension/src/bridge.ts` `message_end` arm: early-return on `role === "system"` next to the existing `custom` return, same placement rule.
- [ ] 5.3 `packages/extension/src/bridge.ts`: redact `compactionEntry` from `session_compact` before forwarding, building a shallow COPY and leaving pi's event object untouched (design D7 — pi hands the same object to every subscribed extension).
- [ ] 5.4 Comment all three sites: pi >= 0.86.0 transcript-backed system prompt/tool loadout; ~150 KB per message paid on both `message_start` and `message_end`; no version gate; the redaction must never mutate pi's object.
- [ ] 5.5 Update the `assistantMessageGen` comment at `packages/extension/src/bridge.ts:452-453` — it enumerates "(user and assistant)" and now also sees `system` (design D2).

## 6. Verify the tests pass

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — all new tests green; `bridge-coalesced-chat-order`, `replay-compaction-equivalence`, `event-reducer-compaction` and the coalescer suites unchanged.
- [ ] 6.2 `npm run quality:changed` — no new Biome findings on the touched files.

## 7. Manual verification (deferred post-merge)

- [ ] 7.1 (test-plan: manual-only) Verify on the real pi 0.86.1 runtime: after `npm run reload`, start a fresh dashboard-spawned session, let it run one turn, then trigger a `/compact`. Confirm no stored event carries a system prompt section or `toolsAdded` list, no stored `session_compact` carries `compactionEntry`, the first assistant message renders normally, and the compaction divider still appears. Cannot be automated — the repo's resolved pi dependency is 0.85.1 and never emits the role.

## 8. Docs

- [ ] 8.1 `packages/extension/src/bridge.ts.AGENTS.md` — add the system-role exclusion and the `session_compact` redaction to the event-subscription paragraph (main agent edits directly; source-tree row).
- [ ] 8.2 `docs/architecture.md` bridge event-forwarding section — note the pi 0.86 system-role drop and the `compactionEntry` redaction, via DocScribe in caveman style.
