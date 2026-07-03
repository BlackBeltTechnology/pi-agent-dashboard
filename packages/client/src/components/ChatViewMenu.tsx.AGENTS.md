# ChatViewMenu.tsx — index

Discord-style ⚙ View popover mounted in chat toolbar. Edits per-session `displayPrefsOverride` via `setSessionDisplayPrefs` WS. "Use global settings" button sends `override: null`. Shows "modified" pill when override non-empty. See change: configurable-chat-display. See change: fix-popover-viewport-flip — adopts usePopoverFlip; swaps top-full mt-1 ⇄ bottom-full mb-1 on flipUp; adds overflow-y-auto + inline maxHeight; popover gains data-testid chat-view-popover.
