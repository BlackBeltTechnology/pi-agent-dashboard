## 1. Shared — prefs + replay (packages/shared)

- [ ] 1.1 Test-first: extend `packages/shared/src/__tests__/display-prefs.test.ts` (exemplar) for `reasoningInlineFlow` (default `false` in all three presets) and `customEntryFallback` (default `true`), plus `mergeDisplayPrefs` override/global arms — verify they fail (test-plan #E3, #E5)
- [ ] 1.2 Add `reasoningInlineFlow: boolean` and `customEntryFallback: boolean` to `DisplayPrefs`, preset values, and `mergeDisplayPrefs` in `packages/shared/src/display-prefs.ts` — verify 1.1 passes
- [ ] 1.3 Test-first: extend `packages/shared/src/__tests__/state-replay-flow-events.test.ts` (exemplar) — `custom_message` entry with `display: true` synthesizes `message_end` (`role: "custom"`); `display: false` synthesizes nothing; `display` absent synthesizes the event (exact `=== false` check); non-`flow-event` `type: "custom"` entry synthesizes `custom_entry` `{customType, data, entryId}`; `flow-event` still takes its seq-sorted path and emits no `custom_entry` — verify they fail (test-plan #E6)
- [ ] 1.4 Implement the replay arms in `packages/shared/src/state-replay.ts` (flow-event check stays BEFORE the generic `custom_entry` arm) — verify 1.3 passes
- [ ] 1.5 Test-first: server preferences-store test — a legacy persisted `displayPrefs` object without the new fields backfills to `customEntryFallback: true` / `reasoningInlineFlow: false` via `backfillDisplayPrefs`; `setDisplayPrefs` base/merged literals carry the defaults (harness exemplar: `packages/server/src/__tests__/migrate-persistence.test.ts`) — verify it fails (test-plan #E4)
- [ ] 1.6 Add the backfill arms + `DisplayPrefs` construction literals in `packages/server/src/persistence/preferences-store.ts` — verify 1.5 passes (missing this task silently inverts the `customEntryFallback` default for existing users)

## 2. Extension bridge (packages/extension)

- [ ] 2.1 Test-first: bridge tests in `packages/extension/src/__tests__/` (exemplar: `bridge-queue-update-forward.test.ts`) asserting (a) a pi `entry_appended` event for `type: "custom"` forwards a `custom_entry` protocol event with `sessionReady`/`isActive` guards honored, mapping only `customType`/`data`/`entryId`, and (b) a `customType: "flow-event"` entry is NOT forwarded (pi-flows appends those live — forwarding would double-render) — verify they fail (test-plan #E7)
- [ ] 2.2 Add the dedicated `pi.on("entry_appended")` subscription in `packages/extension/src/bridge.ts` (sibling of the enriched/pass-through loops) with the `customType !== "flow-event"` guard — verify 2.1 passes

## 3. Client — reducer + rows (packages/client)

- [ ] 3.1 Test-first: reducer tests — `message_end` with `role: "custom"`, `display: true` appends a `role: "custom"` row (`customType`, extracted body); `display: false` appends nothing; `display` undefined renders (exact `=== false` check); `custom_entry` event appends the same row shape and ignores `customType: "flow-event"` (defense-in-depth); 200-line boundary truncation with `«N earlier lines hidden»` marker; 10,000-line payload truncates; circular-ref data falls back to `String()` without throwing; image-only content arrays emit `[image]` notes; `custom` NOT in `TURN_BOUNDARY_ROLES` — verify they fail (test-plan #E1, #E2, #E8, #X1, #X2, #X3)
- [ ] 3.2 Add `role: "custom"` to the `ChatMessage` union, record its non-boundary classification at the `TURN_BOUNDARY_ROLES` comment, and implement both reducer branches (payload extraction per design D4; live rows do NOT stamp `entryId` — bridge id resolution is unreliable for custom messages) in `packages/client/src/lib/chat/event-reducer.ts` — verify 3.1 passes
- [ ] 3.3 Test-first: component test for the new `CustomEntryCard` — plain-text body (no markdown), `customType` label, visible body, truncated long payload — verify it fails
- [ ] 3.4 Create `packages/client/src/components/chat/CustomEntryCard.tsx` (plain-text `<pre>` treatment per `RawEventCard`, bounded body region) plus an explicit `baseRowSize` arm for the `custom` row in `chat-virtual-rows.ts` > the 120px default (exemplar: `packages/client/src/lib/__tests__/chat-virtual-rows.test.ts`) — verify 3.3 passes (test-plan #P2)
- [ ] 3.5 Wire the `role: "custom"` render branch into `ChatView.tsx` gated by `prefs.customEntryFallback` (render-time gate only)

## 4. Client — inline reasoning flow

- [ ] 4.1 Test-first: `ThinkingBlock` test — `inlineFlow` present renders the body without `max-h-[400px]`/`overflow-y-auto`; absent renders today's exact classes; collapse-timer behavior unchanged in both modes — verify it fails (test-plan #E9)
- [ ] 4.2 Add the `inlineFlow?: boolean` prop to `ThinkingBlock.tsx` (HEIGHT ONLY; keep `overflow-x-auto`) — verify 4.1 passes
- [ ] 4.3 Thread `prefs.reasoningInlineFlow` into all three first-party mount sites: ChatView message rows, streaming-thinking tail, `ToolBurstGroup` absorbed-thinking block (plugin `ThinkingBlockPrimitive` out of scope per design D6)

## 5. Client — settings controls

- [ ] 5.1 Test-first: SettingsPanel View-page component test (exemplar: `packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx`) — inline-flow toggle inside the reasoning `GatedGroup`, visible+disabled when `reasoning` off, enabled when on; custom-entry-fallback toggle adjacent to the extension-notifications control (DOM order) — verify it fails (test-plan #E10)
- [ ] 5.2 Add both controls to `packages/client/src/components/settings/SettingsPanel.tsx` (i18n `t()`/`i18nT` defaults per `ui-i18n-coverage`) — verify 5.1 passes

## 6. Browser E2E (L3 — docker harness, `npm run test:e2e`)

- [ ] 6.1 Author `tests/e2e/custom-entry-fallback.spec.ts` (exemplar: `tests/e2e/notify-min-level.spec.ts` — pref-gated extension rows through the settings UI): harness-seeded custom entry visible → toggle `customEntryFallback` off → row disappears → re-enable → row visible again without reload. Triple: seeded custom entry · settings toggle in live view · row visibility flips without replay (test-plan #E11)
- [ ] 6.2 Author `tests/e2e/reasoning-inline-flow.spec.ts` (exemplar: `tests/e2e/reasoning-auto-collapse.spec.ts`): long reasoning block, `reasoningInlineFlow` on via settings UI → expanded body has no vertical height cap and no inner vertical scrollbar; collapse toggle still works. Triple: long reasoning block · pref on + expand · body element lacks max-height/overflow-y constraint (test-plan #E12)
- [ ] 6.3 Author an L3 assertion that a live flow run renders exactly ONE card per flow event (exemplar: `tests/e2e/flow-roundtrip.spec.ts`): during a live flow, zero generic custom cards appear for `flow-event` customType. Triple: live pi-flows flow · observe chat during run · dedicated flow card only (test-plan #F1)
- [ ] 6.4 Author an L3 replay-parity assertion (exemplar: `tests/e2e/reasoning-auto-collapse.spec.ts` — replayed-vs-live mechanics): session JSONL with custom messages + custom entries in known order → reload → same custom rows in the same relative order with the same truncation form. Triple: seeded session file · cold reload · row order + truncation match live (test-plan #F2)

## 7. Full suite + perf gates

- [ ] 7.1 Run `npm test` (pipe to tmp + grep per AGENTS.md); fix fallout from the `ChatMessage` union change
- [ ] 7.2 Perf check (`performance-optimization` discipline): run `tests/e2e/chat-transcript-virtualization.spec.ts` / `chat-render-perf.spec.ts` gates with (a) a very long reasoning block, `reasoningInlineFlow` off vs on, and (b) a large 200-line custom row — record before/after numbers against the existing gate thresholds; investigate if regression (test-plan #P1)
- [ ] 7.3 Security pass (`security-hardening` discipline) on the custom-payload path: plain-text-only rendering, truncation, exact `display === false` exclusion, `customEntryFallback` kill switch

## 8. Manual verification (deferred post-merge by ship-change)

- [ ] 8.1 Human review: custom card reads as part of the chat, RawEventCard-family styling looks right (test-plan: manual-only — #F3)
- [ ] 8.2 Human review: long inline-flow reasoning reads naturally while steering a live turn; no nested-scroll disorientation (test-plan: manual-only — #F4)

## 9. Docs + discipline

- [ ] 9.1 Update directory `AGENTS.md` rows: `CustomEntryCard.tsx` (new `packages/client/src/components/chat/AGENTS.md` row), shared/extension/client `See change:` notes
- [ ] 9.2 Run `review-code` discipline on the full diff once green; land per the implement-skill rebuild matrix (shared/server → restart, extension → reload, client → build + restart)
