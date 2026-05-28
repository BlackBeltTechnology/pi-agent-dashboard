# Chat display preferences

See change: configurable-chat-display.

## What

Global + per-session `DisplayPrefs` gate chat-view chrome (thinking blocks, tool-call cards per kind, tool-result bodies, turn separators, debug tools, token-stats bar, context-usage bar, etc.). Users edit globals in Settings ▸ General ▸ Chat display; per-session overrides via ⚙ View popover in chat toolbar.

## Storage

- Global: `~/.pi/dashboard/preferences.json#displayPrefs` (full `DisplayPrefs`). Undefined until first PATCH.
- Per-session: `<session>.meta.json#displayPrefsOverride` (sparse `Partial<DisplayPrefs>`). Absent = use global.

## Merge rule

`effective = mergeDisplayPrefs(global, override)`.

- `toolCalls` deep-merged (per-kind override wins over per-kind global).
- Every other key: `override[k] ?? global[k]`.
- `undefined` override falls back to global.
- Global `undefined` (pre-first-launch) → client uses `DISPLAY_PRESETS.standard`.

## Transport

| Endpoint / message | Direction | Purpose |
|---|---|---|
| `GET /api/preferences/display` | client → server | Returns `{ global, sessionOverrides }`. `global: undefined` triggers `FirstLaunchDisplayModal`. |
| `PATCH /api/preferences/display` | client → server | Deep-merges body into global `displayPrefs`. Broadcasts `display_prefs_updated`. |
| `display_prefs_updated` | server → browser | Full `{ global, sessionOverrides }` snapshot on every change. |
| `setSessionDisplayPrefs` | browser → server | `{ sessionId, override: Partial<DisplayPrefs> | null }`. `null` clears override (revert to global). |

## Non-hidable

- `ask_user` tool calls always render. `toolCallPrefKey("ask_user")` returns `null`.
- Inline ask-user / interactive-UI dialogs always render regardless of `toolCalls.*` toggles.

## Migration

First client load runs once:

1. Read `localStorage["show-debug-tools"]`.
2. If present: PATCH `{ debugTools: <bool> }`.
3. `localStorage.removeItem("show-debug-tools")`.

Idempotent. Safe across reloads.

## First-launch

When `GET /api/preferences/display` returns `global === undefined`:

- `FirstLaunchDisplayModal` opens.
- User picks preset: `simple` | `standard` | `everything`. PATCH sends `DISPLAY_PRESETS[pick]`.
- Esc / Skip → PATCH `DISPLAY_PRESETS.standard`.

After first PATCH, modal never re-opens (global now defined).

## Key files

- `packages/shared/src/display-prefs.ts` — `DisplayPrefs`, `DISPLAY_PRESETS`, `mergeDisplayPrefs`, `toolCallPrefKey`.
- `packages/server/src/routes/preferences-display-routes.ts` — REST.
- `packages/server/src/preferences-store.ts` — `getDisplayPrefs` / `setDisplayPrefs`.
- `packages/server/src/meta-persistence.ts` — `setDisplayPrefsOverride`.
- `packages/client/src/lib/DisplayPrefsContext.tsx` + `hooks/useDisplayPrefs.ts` — client read path.
- `packages/client/src/components/ChatViewMenu.tsx` — per-session toolbar popover.
- `packages/client/src/components/FirstLaunchDisplayModal.tsx` — onboarding preset picker.
