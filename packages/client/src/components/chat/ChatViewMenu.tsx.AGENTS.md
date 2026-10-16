# ChatViewMenu.tsx — index

Discord-style ⚙ View popover mounted in chat toolbar. Edits per-session `displayPrefsOverride` via `setSessionDisplayPrefs` WS. "Use global settings" button sends `override: null`. Shows "modified" pill when override non-empty. See change: configurable-chat-display. See change: fix-popover-viewport-flip — adopts usePopoverFlip; swaps top-full mt-1 ⇄ bottom-full mb-1 on flipUp; adds overflow-y-auto + inline maxHeight; popover gains data-testid chat-view-popover. See change: fix-popover-horizontal-flip — passes estimatedWidth:256 (w-64); swaps hard-coded right-0 for anchorRight ? right-0 : left-0; adds inline maxWidth; fixes slim-panel left-edge clip. See change: keep-reasoning-open-until-turn-ends — adds "Keep reasoning open until turn ends" Row toggling `keepReasoningOpenUntilTurnEnds` override. See change: enhance-tool-call-grouping — adds "Keep tool groups collapsed" Row toggling `toolGroupDefaultCollapsed` override.

See change: opt-in-out-of-cwd-session-diffs — adds "Show out-of-workspace diffs" Row toggling `showOutOfCwdSessionDiffs` override.

See change: fix-popover-container-clip — reads `usePopoverBoundary()`, passes `boundaryRef` (chat pane) to usePopoverFlip so the `right-0` popover measures the offset pane, not the viewport (no left-clip).

## fix-popover-pane-bounded-height

- Applies BOTH `minHeight` and `maxHeight` (`style={{ maxHeight, minHeight, maxWidth }}`). Keeps the default 120 floor — its ~20-row content always exceeds it, so the floor is a no-op here.

## gate-notify-rows-by-level

- Adds the popover's FIRST non-boolean control: `SelectRow` for `notifyMinLevel` (4 stops from `NOTIFY_MIN_LEVELS`, `data-testid="notify-min-level"`, row `data-testid="notify-min-level-row"` + `data-overridden`).
- Reuses the existing override plumbing unchanged — same `patch()` / `clearOverride()` / `isOverridden()`, so it accumulates with sibling overrides and participates in "Use global settings".
- Selecting the global's own value still RECORDS an explicit override (a later global change must not move the session).
- `min-h-[44px]` hit area (matches `ThinkingLevelSelector`) rather than the ~26px `py-1` boolean rows; restyling those siblings is deliberately out of scope.

## os-add-set-global-view

- Popover = flex column: `chat-view-list` (scrolls, `overflow-y-auto`) + pinned `chat-view-footer` (never scrolls away).
- One sameness rule `differs(value, global)` drives row dots, footer `N changed` (`countChanged`), trigger dot, and Reset / Set as global enabled state (`hasChanges`). Value toggled back to global = stored (explicit override kept, see gate-notify-rows-by-level) but NOT changed. · `chat-view-reset` (sends `override: null`; replaces "Use global settings") · `chat-view-set-global`.
- Set as global: `PATCH /api/preferences/display` with effective `prefs`, then clears override. PATCH failure → `chat-view-set-global-error`, override kept.
- Placement: `usePopoverFlip({ threshold: Infinity })` → opens toward the side with more room (composer strip trigger → up). Old rule only flipped when below-space < 200px → squeezed downward sliver.
- Phone (`max-sm`): fixed bottom sheet (`max-h-[75vh]!`, inline flip bounds overridden) + `chat-view-scrim` (`sm:hidden`, click closes); rows `max-sm:min-h-[44px]`; desktop row rhythm unchanged.
- Trigger "modified" pill → amber dot (same `chat-view-modified-pill` testid, `aria-label`).
- i18n: `session.setAsGlobal`, `session.setAsGlobalFailed`, `session.viewChangedCount` (hu, zh-CN).
