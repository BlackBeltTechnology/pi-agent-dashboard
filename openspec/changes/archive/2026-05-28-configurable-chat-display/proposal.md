## Why

The chat / stream view shows a lot of surface: token usage bar, context window bar, reasoning blocks, tool call cards, tool result bodies, turn metadata. Power users need it. Non-technical users open the dashboard, see token graphs and a `Bash` tool dumping 500 lines of stdout, and bounce.

There is already prior art for hiding one class of noise (`useDebugToolsVisible` + `show-debug-tools` localStorage key). We need to generalize that pattern: let users control which chat-view elements render, globally and per-session, without forcing them to learn what "thinking" or "tool result" means before they can hide either.

## What Changes

- **NEW**: Global display preferences in `preferences.json` under a new `displayPrefs` field. Boolean per element + a `toolCalls` sub-object keyed by tool type (read, bash, edit, agent, generic).
- **NEW**: Per-session sparse override in `<session>.meta.json` under `displayPrefsOverride: Partial<DisplayPrefs>`. Effective prefs = `{ ...global, ...override }`.
- **NEW**: Settings ▸ General ▸ Display section in `SettingsPanel.tsx` — checkboxes mapped 1:1 to schema fields.
- **NEW**: Discord-style "⚙ View ▾" popover in the ChatView toolbar — writes/clears per-session overrides; offers "Use global settings" reset.
- **NEW**: First-launch modal: 3 radio choices ("Simple" / "Standard" / "Show everything") that seed global prefs. Skippable = Standard.
- **NEW**: REST `GET /api/preferences/display` + `PATCH /api/preferences/display`. WS broadcast on change so every open browser re-renders.
- **NEW**: Per-session WS message `setSessionDisplayPrefs` writing the sparse override.
- **MODIFIED**: `ChatView`, `App` (TokenStatsBar mount), `SessionCard` (ContextUsageBar mount), `ThinkingBlock`, `ToolCallStep`, `CollapsedToolGroup` — gate render on effective prefs.
- **MODIFIED**: existing `show-debug-tools` localStorage → migrated once into `displayPrefs.debugTools` on first load, then read from server.
- **NON-HIDABLE**: `askUser` tool calls are never gated. A hidden ask-user dialog would silently stall the session.

## Capabilities

### New Capabilities

- `chat-display-preferences`: hides/shows chat-view elements via global + per-session preferences.

## Impact

- `packages/server/src/preferences-store.ts` — extend `PreferencesData` with `displayPrefs`; add getter/setter; reuse debounced write path.
- `packages/server/src/routes/` — new `preferences-display-routes.ts` for REST + WS broadcast.
- `packages/shared/src/session-meta.ts` — add `displayPrefsOverride?: Partial<DisplayPrefs>` to `SessionMeta`.
- `packages/shared/src/browser-protocol.ts` — new `setSessionDisplayPrefs` + `display_prefs_updated` messages; ship `DisplayPrefs` type.
- `packages/client/src/components/ChatView.tsx` — gate `ThinkingBlock`, `ToolCallStep`, `CollapsedToolGroup`, tool-result body via effective prefs.
- `packages/client/src/components/SettingsPanel.tsx` — new Display section.
- `packages/client/src/components/ChatViewMenu.tsx` (new) — popover for per-session overrides.
- `packages/client/src/components/FirstLaunchDisplayModal.tsx` (new) — one-shot preset picker.
- `packages/client/src/hooks/useDisplayPrefs.ts` (new) — subscribes to global + session override, returns effective prefs; replaces `useDebugToolsVisible`.
- Migration: one-time read of `localStorage.show-debug-tools` → PATCH global prefs → remove key.
