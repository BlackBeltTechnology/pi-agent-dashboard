# Chat display preferences

See change: configurable-chat-display, fix-first-launch-display-modal-stuck-on-mobile, gate-notify-rows-by-level.

## What

Global + per-session `DisplayPrefs` gate chat-view chrome (thinking blocks, tool-call cards per kind, tool-result bodies, turn separators, debug tools, token-stats bar, context-usage bar, notify rows by severity floor, etc.). Users edit globals in Settings ▸ General ▸ Chat display; per-session overrides via ⚙ View popover in chat toolbar.

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
| `display_prefs_updated` (on WS connect) | server → browser | Snapshot on connect, parity with pinned_dirs/favorite_models/workspaces. Sent ONLY when `getDisplayPrefs()` defined. Guarded by `typeof preferencesStore.getDisplayPrefs === "function"`. Seedless install sends nothing; first-launch modal opens exactly once. |
| `setSessionDisplayPrefs` | browser → server | `{ sessionId, override: Partial<DisplayPrefs> | null }`. `null` clears override (revert to global). |

## Non-hidable

- `ask_user` tool calls always render. `toolCallPrefKey("ask_user")` returns `null`.
- Blocking interactive dialogs always render at EVERY `notifyMinLevel`, including `errors`: `confirm` / `select` / `input` / `ask_user`. Never gated by `toolCalls.*` or `notifyMinLevel`.
- Notify rows are the ONE interactive-UI kind that IS gated — by `notifyMinLevel`, never by `toolCalls.*`.

## Notify rows

`notifyMinLevel` gates interactive notify rows by severity floor.

- `NotifyMinLevel = "all" | "success" | "warnings" | "errors"`. `NOTIFY_MIN_LEVELS` exports the four stops in ladder order (settings controls iterate it).
- Ladder: `info < success < warning < error`. `success` deliberately outranks `info`.
- No `"off"` value. `errors` is the strictest floor; `error` notify rows ALWAYS render.
- Default `"all"` in all three presets (`simple` / `standard` / `everything`). Zero visibility change on upgrade.
- Server `backfillDisplayPrefs` defaults legacy files to `"all"`.
- Single shared predicate `isNotifyRowVisible(row, minLevel)` in `packages/shared/src/display-prefs.ts`. Applied at BOTH `ChatView` gate sites: `isRowVisible` filter + `interactiveUi` render branch.
- Fails open on BOTH inputs:
  - Row not positively identified as notify renders. Discriminator requires BOTH `content === "notify"` AND `args.method === "notify"`.
  - Unrecognized floor degrades to `"all"`. Prevents NaN comparison hiding `error`.
- Control: Settings ▸ General ▸ Chat display (`SelectField`).
- Control: per-session ⚙ View popover (`ChatViewMenu`, first non-boolean row).
- `NotifyRenderer` renders through the shared `InlineMessage` primitive. Colour from `--severity-*` tokens; four `text-{blue,green,yellow,red}-400` literals gone.
- Level survives without colour: accent bar + per-level icon + level word.
- `InlineMessage.Severity` gained `"success"`.

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

### Dismissal contract (optimistic close)

- `FirstLaunchDisplayModal.seed(key)` applies `DISPLAY_PRESETS[key]` locally. Calls `onClose(prefs)` on EVERY path: PATCH 200, non-2xx, thrown fetch.
- Modal closes from local state. Independent of WS broadcast or PATCH success.
- PATCH 200 body `{ displayPrefs }`, when readable, refines applied value.
- App.tsx `onClose` seeds `displayPrefs` via `setDisplayPrefs(prefs)`. No longer no-op.
- Render gate: `displayPrefsSeedless && displayPrefs === undefined`.
- `displayPrefsSeedless` set true ONLY when mount GET `r.ok && body.displayPrefs === undefined`. Distinct from `loaded && undefined` — `setDisplayPrefsLoaded(true)` runs in fetch `finally` even on failed GET.
- Failed/denied GET (403/flap) no longer opens modal.
- Modal renders in BOTH mobile and desktop returns. Single `firstLaunchModal` element. Not gated on `isMobile`.
- Failed-PATCH dismiss = current-session only. Server stays seedless; reload/new-tab re-opens modal. Deliberate trade-off, self-correcting.

## Key files

- `packages/shared/src/display-prefs.ts` — `DisplayPrefs`, `DISPLAY_PRESETS`, `mergeDisplayPrefs`, `toolCallPrefKey`.
- `packages/server/src/routes/preferences-display-routes.ts` — REST.
- `packages/server/src/preferences-store.ts` — `getDisplayPrefs` / `setDisplayPrefs`.
- `packages/server/src/meta-persistence.ts` — `setDisplayPrefsOverride`.
- `packages/client/src/lib/DisplayPrefsContext.tsx` + `hooks/useDisplayPrefs.ts` — client read path.
- `packages/client/src/components/chat/ChatViewMenu.tsx` — per-session toolbar popover; hosts `notifyMinLevel` row.
- `packages/client/src/components/FirstLaunchDisplayModal.tsx` — onboarding preset picker.
- `packages/client/src/components/chat/ChatView.tsx` — both `isNotifyRowVisible` gate sites (filter + render branch).
- `packages/client/src/components/interactive-renderers/NotifyRenderer.tsx` + `primitives/InlineMessage.tsx` — notify row presentation; `Severity` includes `"success"`.
