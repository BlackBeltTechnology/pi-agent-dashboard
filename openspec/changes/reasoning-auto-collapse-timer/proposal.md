# Reasoning Auto-Collapse Timer

## Why

The reasoning-display capability (archived `2026-03-24-reasoning-display`) renders a
finished reasoning block **collapsed the instant it finishes**. This is not a timer —
it is a mount swap. While the model streams thinking, `ChatView` renders the live
`<ThinkingBlock isStreaming defaultExpanded>` (open). On `thinking_end` the reducer
moves the text into a persisted `role:"thinking"` message, which renders
`<ThinkingBlock>` with no `defaultExpanded` → `useState(false)` → collapsed.

That swap collapses the reasoning **at the exact moment it becomes readable**: during
streaming the text scrolls and is a moving target; the instant it settles and is
finally readable, it disappears. Users lose the reasoning right when they could read it.

The fix: after a **live-streamed** reasoning block finishes, keep it open for a
configurable window (default 30s), then collapse. This must apply **only** to reasoning
streamed live in the current view — never to blocks that arrive via replay (cold load,
reconnect, history), which must stay collapsed on arrival exactly as today.

## What Changes

- **Provenance flag.** The reducer marks a `thinking` message as live-streamed only when
  it is produced by the live event path (`case "event"`), not the batch replay path
  (`case "event_replay"`). Replayed thinking messages carry no live flag.
- **Per-block auto-collapse timer.** Every live-streamed reasoning block mounts expanded
  and arms its own timer from its own `thinking_end`. On expiry it collapses. Uniform
  rule — no "latest block only" special case; multi-step turns collapse each block on its
  own staggered timer. Reasoning that is the last thing in a turn collapses too (no
  "stay open because it's the main content" exception).
- **Manual click freezes the block.** The first time the user toggles a live block
  (expand or collapse), its timer is cancelled permanently; the block is under manual
  control from then on.
- **Setting.** New `reasoningAutoCollapseMs` display preference (default `30000`).
  `0` = never auto-collapse (live block stays open until clicked). Exposed as a field in
  `SettingsPanel` alongside the existing `reasoning` toggle.
- **Replay untouched.** Replayed / reconnected / cold-loaded reasoning blocks render
  collapsed with no timer — identical to today.

## Impact

- Affected specs: `reasoning-display` (MODIFIED), `chat-display-preferences` (MODIFIED —
  new numeric pref + persistence/backfill).
- Affected code:
  - `packages/shared/src/display-prefs.ts` — add `reasoningAutoCollapseMs` to
    `DisplayPrefs`, presets, and `mergeDisplayPrefs`.
  - `packages/server/src/preferences-store.ts` — **required server edit** (the plan is
    NOT server-free): `setDisplayPrefs` hand-builds its merged object field-by-field
    (`preferences-store.ts:465`) and would otherwise strip the new field on every
    `PATCH /api/preferences/display`; the load path (`:218`) reads `data.displayPrefs`
    verbatim with no backfill, so legacy `preferences.json` files must be defaulted to
    `30000` on load.
  - `packages/client/src/lib/event-reducer.ts` — set a live-streamed flag on the
    `thinking` message at `thinking_end` on the live path only.
  - `packages/client/src/hooks/useMessageHandler.ts` — ensure the `event_replay` path
    does not set the live flag (provenance boundary).
  - `packages/client/src/components/ThinkingBlock.tsx` — accept `autoCollapseMs` +
    `streamedLive`; mount expanded when live, arm timer, cancel on manual toggle.
  - `packages/client/src/components/ChatView.tsx` — pass the live flag + pref to the
    persisted `<ThinkingBlock>`.
  - `packages/client/src/hooks/useDisplayPrefs.ts` — `mergeDisplayPrefs(global ??
    DISPLAY_PRESETS.standard, …)` only substitutes the preset when `global` is wholly
    absent; a legacy `global` object missing the field yields `undefined`. Backfill must
    happen at the server load chokepoint (above) so the client always receives a number.
  - `packages/client/src/lib/rehydrate-session.ts` — third `reduceEvent` call site
    (`:33`); relies on the default `isLive=false` (replay-safe, no timer).
  - `packages/client/src/components/SettingsPanel.tsx` + `ChatViewMenu.tsx` — surface the
    new pref.
- **One server edit required** (persistence merge + legacy backfill, above). No protocol
  change; the `DisplayPrefs` shape gains one numeric field carried by the existing
  `display_prefs_updated` broadcast.
