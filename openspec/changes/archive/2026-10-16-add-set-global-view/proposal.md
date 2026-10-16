## Why

The per-session `⚙ View` popover (`ChatViewMenu`) was hard to use:

- It opened DOWNWARD from the composer strip whenever more than 200px was free below the button, squeezing ~30 rows into a short scrolling sliver.
- Its only action, "Use global settings", sat at the bottom of the scroll list and could scroll out of reach.
- The Notifications `<select>` (longest option "Outcomes and problems") overflowed the 256px popover, adding a horizontal scrollbar.
- A session's tuned view could not be promoted to the global default; the user had to redo it in Settings ▸ General ▸ Chat display.
- On phones it rendered as a small floating box with ~26px tap targets.

## What Changes

- Popover opens toward the side with MORE room (`usePopoverFlip` `threshold: Infinity`); from the composer strip that is always up.
- Layout = scrolling list + pinned footer: `N changed · Reset · Set as global`. Reset replaces "Use global settings" (same `override: null`).
- New **Set as global**: `PATCH /api/preferences/display` with the session's effective prefs, then clear the session override. PATCH failure → inline error, override kept.
- Width 288px (`w-72`) so the notify select fits; list clips `overflow-x`; select `min-w-0` shrinks only in a slim pane.
- Phone (`max-sm`): fixed bottom sheet (≤75vh) + click-to-close scrim; rows ≥44px.
- Trigger "modified" pill → small amber dot (same `chat-view-modified-pill` testid).
- `ChatViewMenu` lazy-loaded from `App.tsx` (own chunk) so the entry stays under the `mdi-chunk-size` 580 KiB gzip cap.
- No server, protocol, or storage change: reuses existing `PATCH /api/preferences/display` and `setSessionDisplayPrefs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-display-preferences`: View popover direction rule, pinned footer with Reset / Set as global, phone bottom sheet.

## Impact

- Client only: `packages/client/src/components/chat/ChatViewMenu.tsx`, `packages/client/src/App.tsx` (lazy mount), i18n `hu` / `zh-CN`.
- Tests: new `ChatViewMenu.footer.test.tsx`; `ChatViewMenu.flip.test.tsx`, `ChatViewMenu.notify-level.test.tsx` updated.
- Rollback: revert the commit; no persisted data changes shape.

## Discipline Skills

None apply. Client-only UI change. No auth, untrusted input, secrets, new endpoint, latency budget, or irreversible step. It reuses the existing `networkGuard`-protected `PATCH /api/preferences/display`.
