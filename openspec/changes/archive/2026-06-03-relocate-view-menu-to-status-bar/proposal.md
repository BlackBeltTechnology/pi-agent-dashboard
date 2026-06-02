## Why

The per-session display-preferences popover (`ChatViewMenu` — the "⚙ View" button that toggles which chat elements render) currently mounts in its own full-width toolbar row at the top of `ChatView` (`ChatView.tsx:307`). That `<div className="flex items-center justify-end px-2 py-1 border-b …">` consumes an entire horizontal band just to right-align one button, wedged between the `TokenStatsBar` context bar and the first chat message.

The user wants that wasted slot reclaimed: move the single `⚙ View` button **down** into the bottom `StatusBar` (the model-selector row above the composer textarea), sitting between the reload button (`StatusBar` `leading` slot) and the `ModelSelector`.

## What Changes

- **Delete the dedicated `ChatView` toolbar row.** Remove the full-width wrapper `<div>` and its `<ChatViewMenu>` mount at `ChatView.tsx:307`. The chat scroll area becomes the first thing under `TokenStatsBar`.
- **Mount `⚙ View` in the `StatusBar`.** `App.tsx` already renders `<StatusBar leading={<StatusBarRefreshButton …/>}>`. The `leading` slot gains `<ChatViewMenu>` immediately after the refresh button, so the bottom bar reads: `⟳ reload · ⚙ View │ [model ▾] [thinking ▾] │ <session actions>`.
- **Re-wire the two props the menu needs.** `ChatViewMenu` needs `sessionId`, `currentOverride`, and a `send` closure. These are already in scope at the `StatusBar` call site in `App.tsx` (`selectedId`, `selectedSession?.displayPrefsOverride`, `send({ type: "setSessionDisplayPrefs", … })`).
- **Drop now-orphaned `ChatView` props.** `onSetDisplayPrefs` and `displayPrefsOverride` were consumed only by the deleted toolbar row; remove them from `ChatView`'s props and its `App.tsx` call site (surgical cleanup — no other consumer).

No change to display-preference semantics, the WS protocol, persistence, or the popover's internals — this is purely where the trigger button lives.

## Capabilities

### Modified Capabilities

- `chat-display-preferences`: Adds a requirement pinning the display-prefs menu's mount location to the composer `StatusBar` (between reload and model selector) instead of a standalone `ChatView` toolbar row.

## Impact

**Code touched:**
- `packages/client/src/components/ChatView.tsx` — remove the `{sessionId && onSetDisplayPrefs && (<div …><ChatViewMenu/></div>)}` block (line ~307); drop `onSetDisplayPrefs` + `displayPrefsOverride` from `Props` and the destructure; remove the now-unused `ChatViewMenu` import.
- `packages/client/src/App.tsx` — extend the `StatusBar` `leading` prop (line ~1329) to render `<StatusBarRefreshButton>` followed by `<ChatViewMenu sessionId={selectedId} currentOverride={selectedSession?.displayPrefsOverride} send={(msg) => send({ type: "setSessionDisplayPrefs", sessionId: selectedId, override: msg.override })}/>`; remove `onSetDisplayPrefs`/`displayPrefsOverride` from the `<ChatView>` mount (line ~1292); add the `ChatViewMenu` import.
- Tests: update any `ChatView` test asserting the toolbar row; add/adjust a test asserting `ChatViewMenu` renders within `status-bar` (`StatusBar` `data-testid="status-bar"`).

**Not touched:**
- `ChatViewMenu.tsx` internals, `DisplayPrefs` schema, `setSessionDisplayPrefs` WS message, server-side persistence.
- `TokenStatsBar`, `ContextUsageBar`, `SessionHeader`.

**Open question (verify during implementation):** confirm `StatusBar` renders on mobile composer; if a separate mobile composer path bypasses `StatusBar`, ensure the `⚙ View` affordance remains reachable on mobile (e.g. via the existing mobile action menu) rather than being dropped.
