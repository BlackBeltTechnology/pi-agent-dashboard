# Tasks — Reasoning Auto-Collapse Timer

## 1. Preference schema
- [ ] 1.1 Add `reasoningAutoCollapseMs: number` to `DisplayPrefs` in
      `packages/shared/src/display-prefs.ts` → verify: type compiles.
- [ ] 1.2 Set `reasoningAutoCollapseMs: 30000` in all three `DISPLAY_PRESETS`
      (`simple`, `standard`, `everything`) → verify: presets typecheck.
- [ ] 1.3 Add `override.reasoningAutoCollapseMs ?? global.reasoningAutoCollapseMs` to
      `mergeDisplayPrefs` → verify: new merge unit test passes.
- [ ] 1.4 Unit test in `display-prefs.test.ts`: default is `30000`; override precedence;
      `0` survives merge (not coerced to default) → verify: `npm test` green.

## 1b. Server persistence + legacy backfill (REQUIRED — not server-free)
- [ ] 1b.1 `preferences-store.ts::setDisplayPrefs` (`:465`): add
      `reasoningAutoCollapseMs: partial.reasoningAutoCollapseMs ?? base.reasoningAutoCollapseMs`
      to `merged`, and `reasoningAutoCollapseMs: 30000` to the all-false `base` literal
      (`:216`) → verify: a PATCH omitting the field preserves the stored value (unit test).
- [ ] 1b.2 Load path (`:218`): when `data.displayPrefs` exists but lacks
      `reasoningAutoCollapseMs`, backfill `30000` → verify: legacy-file load test yields
      `30000`, not `undefined`.
- [ ] 1b.3 Confirm `display_prefs_updated` broadcast (`routes/preferences-display-routes.ts`)
      carries the new field end-to-end → verify: client `global` has a number after PATCH.

## 2. Provenance flag in the reducer
- [ ] 2.1 Add optional `isLive` param to `reduceEvent` (default `false`) in
      `event-reducer.ts` → verify: existing callers still compile.
- [ ] 2.2 At `thinking_end`, set `streamedLive: isLive === true` on the new thinking
      message → verify: unit test asserts flag true when `isLive:true`.
- [ ] 2.3 Add `streamedLive?: boolean` to the thinking `ChatMessage` shape → verify:
      typecheck.
- [ ] 2.4 Live dispatch (`useMessageHandler.ts` `case "event"`) calls
      `reduceEvent(current, msg.event, { isLive: true })` → verify: test.
- [ ] 2.5 Replay dispatch (`case "event_replay"`) calls `reduceEvent` with `isLive` unset/
      `false` → verify: replayed thinking message has `streamedLive` falsy.
- [ ] 2.6 Replay-idempotency test: re-replay of a historical thinking block keeps
      `streamedLive` falsy → verify: `event-reducer.replay-idempotency.test.ts` extended.
- [ ] 2.7 Third call site `rehydrate-session.ts:33` left at default (`isLive=false`);
      confirm cold-load rehydrated thinking blocks have `streamedLive` falsy → verify:
      rehydrate test. Do NOT thread `isLive:true` here — rehydrate is a replay path.

## 3. ThinkingBlock timer
- [ ] 3.1 Add props `streamedLive?: boolean`, `autoCollapseMs?: number` to `ThinkingBlock`
      → verify: typecheck.
- [ ] 3.2 Initial expanded = `streamedLive` ALONE (NOT gated on `!== 0`); replayed blocks
      start collapsed → verify: RTL renders live block expanded even when `autoCollapseMs=0`,
      replayed collapsed.
- [ ] 3.3 Arm `setTimeout(collapse, msRef.current)` via a **ref-held handle** when
      `streamedLive && msRef.current > 0 && !touchedRef.current`; effect deps `[streamedLive]`
      ONLY (NOT `touched`, NOT `autoCollapseMs` — captured in `msRef` at mount); clear on
      unmount and at the top of every effect run → verify: fake-timer test collapses after
      delay; StrictMode double-invoke leaks no second timer.
- [ ] 3.4 `0` renders expanded and never arms the timer → verify: fake-timer test, block
      stays open past any advance.
- [ ] 3.5 Manual toggle sets `touchedRef.current=true` and clears the timer handle in the
      click handler → verify: click before expiry then advance timers → stays as user left
      it (no re-arm).
- [ ] 3.6 No-remount check: across a normal streaming→commit→next-block turn the persisted
      block keeps its instance (touched/timer survive) → verify: RTL test asserts the
      committed block is not remounted (positional `key` stability).
- [ ] 3.7 **Demotion (C2):** when `streamedLive` prop transitions true→false on a mounted
      instance (reconnect re-replay), the block collapses and clears its timer instead of
      staying stuck open → verify: RTL test flips the prop, asserts collapsed + no pending
      timer. If `touchedRef` is set, the user state is preserved (no forced collapse).
- [ ] 3.8 **Mid-window pref change (W1):** changing `autoCollapseMs` while a block is
      counting down does NOT restart the timer → verify: fake-timer test advances partway,
      re-renders with a larger `autoCollapseMs`, asserts collapse still fires on the
      ORIGINAL schedule.

## 3c. C1 — preserve collapse-during-streaming (DECIDED: lift into state)
- [ ] 3c.1 Add `streamingThinkingCollapsed: boolean` to `SessionState`; reset to `false` on
      `thinking_start` → verify: reducer unit test.
- [ ] 3c.2 Wire `onUserCollapse` on the streaming `<ThinkingBlock>` (`ChatView.tsx:555`);
      on collapse, set `streamingThinkingCollapsed = true` via a client-only session-state
      update (no server round-trip) → verify: RTL test flips the flag.
- [ ] 3c.3 At `thinking_end`, when `streamingThinkingCollapsed` is true, create the committed
      message with `streamedLive: false` (else `streamedLive: isLive`); reset the flag after
      flush → verify: collapsing the streaming block yields a committed block that stays
      collapsed with NO timer; not collapsing keeps hold-open behavior.

## 4. Wire ChatView
- [ ] 4.1 Pass `streamedLive={msg.streamedLive}` and
      `autoCollapseMs={prefs.reasoningAutoCollapseMs}` to the persisted
      `<ThinkingBlock>` (role==="thinking") in `ChatView.tsx` → verify: typecheck.
- [ ] 4.2 Confirm the streaming `<ThinkingBlock isStreaming defaultExpanded>` path is
      unchanged and does NOT receive `streamedLive`/`autoCollapseMs` (invariant) → verify:
      streaming still renders expanded; no auto-collapse props leak onto the streaming fiber.

## 5. Settings UI
- [ ] 5.1 Add a numeric (seconds) field for `reasoningAutoCollapseMs` in `SettingsPanel.tsx`
      next to the `reasoning` toggle; store milliseconds → verify: change persists via
      REST + WS broadcast.
- [ ] 5.2 (Optional) Surface in the per-session `ChatViewMenu.tsx` popover → verify: value
      overrides per session.
- [ ] 5.3 i18n label keys added → verify: no missing-key fallback in UI.

## 6. Verify
- [ ] 6.1 `npm run quality:changed` (biome + tsc + test) green.
- [ ] 6.2 Manual: live turn → reasoning holds open ~30s then collapses; reload/reconnect →
      historical reasoning collapsed immediately, no flash; set pref `0` → live reasoning
      stays open until clicked; click during window → stays under manual control.
- [ ] 6.3 Persistence regression: set the pref, PATCH an UNRELATED display field (e.g.
      toggle `reasoning`), confirm `reasoningAutoCollapseMs` is NOT reset to `undefined`
      (guards finding #2).
