# Design: reorganize-session-header

Approved board: `mockups/session-header-reorg/index.html` (as-built crops from live :8000 + proposed states; `ui-plan.md` holds the D1–D10 decision log and probe results). Implementation MUST match the approved "A" states; B and C on the board are rejected alternatives kept for comparison.

## Context (as-built, cited)

- The desktop header is one `flex items-center gap-4 text-sm` row (`packages/client/src/components/session/SessionHeader.tsx:423`).
- **Header order today:**
  - Back.
  - Name + ✎.
  - `<LayoutModeSwitch />` (`:464`).
  - Seek chip `session-header-seek-card` (`:471`).
  - `pi <version>`, `FooterSegmentSlot`, vault chip, tags.
  - Spacer.
  - Attach / attached chip.
  - Modules (`:543`).
  - `ChangedFilesChip` (`:556`).
  - Resume/Fork, or `formatDuration(now − startedAt)` text (`:579`, computed at `:378` for every status, so a non-resumable ended session keeps ticking).
  - `refresh-chat` ⟳ (`:583`).
- Labels are `text-[10px]`.
- **Whole-header re-render:** `useEffect` runs `setInterval(() => setNow(Date.now()), 1000)` (`:366`), so the entire header (TagEditor, attach chip, resolution hook) re-renders every second.
- **Mobile header:**
  - `MobileHeader` (`:191`): back, name, `MobileAttachButton` (`:82`, `mobile-attach-btn`), `<LayoutModeSwitch />` (`:248`), `MobileActionMenu`.
  - An optional row 2 holds the attached chip; `PiBelowFloorWarning` (`:314`) and `VaultBindingsChip` (`:319`) render under it.
  - `App.tsx` adds a separate "Mobile info strip" (`packages/client/src/App.tsx:2428`) with model, thinking, current tool, cost and a context bar.
- **Context bar:**
  - Desktop renders `TokenStatsBar` under the header (`App.tsx:2476`).
  - Its context bar is the `showContextBar &&` block (`packages/client/src/components/session/TokenStatsBar.tsx:135`).
- **The second ⟳:**
  - The composer context strip (`App.tsx:2638`) starts with `StatusBarRefreshButton` (used at `App.tsx:2642`, defined at `:3635`), which only refreshes OpenSpec data, then `ChatViewMenu` (`App.tsx:2645`).
  - That strip renders on desktop and mobile, so today `ChatViewMenu` (trigger text "View", `ChatViewMenu.tsx:164`) is reachable on phones from there.
  - Both ⟳ buttons are `mdiRefresh`.
- `MobileActionMenu` labels the chat refresh "Refresh Chat" with `mdiRefresh` (`packages/client/src/components/shell/MobileActionMenu.tsx:259`, i18n key `session.refreshChat2`). It offers Detach but no Attach (`:253`).
- **Measured on live :8000:**
  - At 1,100 × 800 with a 66-character title, the title wraps word by word, the header grows to about 170 px, and the switch collapses to a sliver (board `asbuilt/narrow-long-title.png`).
  - At 390 × 844 the mobile title gets 76 px, and header + info strip take 99 px.

## Decisions

### D1 Layout switch on the trailing edge, larger
Split and Editor open the right-hand pane, so the control sits over the region it changes. The leading zone is identity (back, title).
- Segments: 32 px tall, 12 px semibold labels, 16 px icons. Selected segment uses the `--tint-blue-{bg,fg}` triple (ui-contract: selected toggle).
- The radiogroup keyboard model stays (WAI-ARIA APG radio group).
- Precedent:
  - Cursor 2.0 shipped a top-left Agent/Editor switch, drew misclick complaints, and removed it by 2.3.
  - Zed keeps the classic/agentic layout in the right-hand title-bar user menu.
  - VS Code puts its layout toggles at the right of the title bar.
- Rejected:
  - Tabs under the title: an extra 36 px row.
  - Leading corner: pushes the title right and crowds it in narrow panes.

### D2 Title as a menu button; Reveal in sidebar replaces Seek
- **Title menu** (ui-contract menu/flyout recipe): Rename, Reveal in sidebar, Edit tags, separator, Reload transcript with a one-line description.
- **Reveal button:** an icon-only `mdiDockLeft` with `aria-label`/`title` "Reveal in sidebar" sits after the title. It keeps `data-testid="session-header-seek-card"` and calls the existing `onSeekToCard`.
  - Approved: both the icon and the menu item.
  - The crosshair is gone because it collided with Focus mode and Goals (`mdiTarget`).
- **Rename:**
  - The inline `InlineRenameInput` stays, and opens from the menu item or F2 while the header has focus.
  - Double-click on the title is retired because the title is now a menu button; double-click would race the menu.
- Desktop-only for Reveal, as before; the title menu exists only on desktop.
- Assistive-tech note: the control's name changes from "Seek to this session's card in the sidebar" to "Reveal in sidebar"; the testid is kept so existing tests keep driving it.

### D3 Reload transcript
- The `refresh-chat` header button becomes the title-menu item "Reload transcript", with `mdiHistory` and the description "Re-fetch every event from the server. Use it when the chat looks stale."
- It keeps `data-testid="refresh-chat"` on the menu item, and the behaviour is unchanged (purge replay cache, re-subscribe, pending-prompt resync).
- Mobile: the ⋯ item changes from "Refresh Chat" + `mdiRefresh` to "Reload transcript" + `mdiHistory`.
- The 500 ms spinning ⟳ goes away with the button; the menu closes and the transcript's own loading state is the signal.
- One icon, one meaning: the composer ⟳ remains OpenSpec-only; `add-composer-dock` moves it into the OpenSpec lane.

### D4 Meta line and the clock leaf
- **Contents:** tags editor, `+ tag`, phase chip, `pi <version>` (the `PiBelowFloorWarning` pill replaces this text when `piBelowFloor` is set), the clock, the context ring.
- **Clock text:**
  - `running <formatDuration(now − startedAt)>` while live, clamped at 0 when `startedAt` is ahead of the browser clock.
  - `ended · ran <duration>` once ended, where the duration is `lastActivityAt − startedAt` (`lastActivityAt?: number`, `packages/shared/src/types.ts:256`), clamped at 0 (`ended · ran 0s`). When `lastActivityAt` is absent, show `ended` alone.
- **The tick moves into a `SessionClock` leaf component** that owns its own 1 s interval. `SessionHeader` no longer holds `now` state.
  - Measure: React Profiler commits of `SessionHeader` per second, before ≈ 1/s, after 0/s while idle.
  - Hidden tabs keep the existing behaviour; no new visibility handling.

### D5 Attach leaves the header
- The desktop Attach button, the attached chip (artifact letters, task counter, detach, `AttachmentTrace`), `MobileAttachButton` and the mobile chip row are removed. The desktop `onReadArtifact` prop on `SessionHeader` goes with them. `mobileActions.onReadArtifact` stays: it feeds the mobile ⋯ "Read" items (`App.tsx:2414` → `MobileActionMenu`).
- Attach and detach remain:
  - on the session card;
  - in the composer: `ComposerSessionActions` today, the `add-composer-dock` OpenSpec lane later.
- **This is a spec-visible removal** (5 capabilities) and was explicitly approved.

### D6 Context: one ring, in the header
- **Removed:**
  - `TokenStatsBar`'s context bar block and the mobile info strip's bar.
  - The `contextUsageBar` preference keeps its key, default and label. It already gates the session card's `ContextUsageBar` (`packages/client/src/components/session/SessionCard.tsx:1253`); it now also gates the header ring instead of the header bar.
- **New `ContextRing`:**
  - Renders a 16 px SVG arc on a `--border-secondary` track. Arc colour by the rounded percentage shown (user-set scale): `--text-secondary` 0–30%, `--accent-blue-text` 31–50%, `--accent-green-text` 51–70%, `--accent-orange-text` 71–90%, `--accent-red-text` 91%+.
  - Percentage = `round(tokens / window × 100)`, capped at 100; above the window the arc is red and the tooltip shows the real count (`1.02M of 1.0M tokens`).
  - Measured against both the page and the track in all 9 palettes of `THEMES` × dark/light with a throwaway bun script over `themes.ts` + `index.css` (not committed; the L1 palette test folded from `test-plan.md` makes it permanent), all five arc colours are at least 3:1 (WCAG 1.4.11). Base dark / light / nord dark: neutral 5.83 / 6.06 / 6.39:1 against the track; the weakest accent pair is light orange at 3.71:1.
  - The composer-dock tokens (`--border-strong` track) measured 1.82–2.92:1 and were not reused.
- **Desktop:**
  - A `role="meter"` span with `aria-valuenow`, `aria-valuemax="100"` and an `aria-label` of "Context used".
  - It shows `<pct>%` as text and a tooltip `<used> of <window> tokens`.
  - Data is the same `selectedContextUsage` value `TokenStatsBar` used.
- **Mobile:**
  - Gated by the same `contextUsageBar` preference as desktop. Today's mobile strip bar ignored the preference (`App.tsx:2446`); this is a declared behaviour change.
  - A 44 px button (arc only) with `aria-label="Context: <pct>% used, <used> of <window> tokens"`.
  - It opens a non-modal popover (ui-contract a11y #5 exception: `role="dialog"`, `aria-modal="false"`, `aria-label`, outside tap / Escape closes and returns focus) with `<pct>% · <used> of <window> tokens`, plus ` · $<cost>` only when cost is above zero (the strip showed cost only when `> 0`, `App.tsx:2440`).
- **Unavailable usage** (no window or tokens): render nothing.
- **Ring vs. `add-composer-dock`:** that change's proposal currently keeps a composer ring "at every width". Two rings would repeat this change's problem. The user approved the header ring with no composer ring (board `ui-plan.md` D8, option R2), so the dock must drop its ring. This is listed under Coordinates with and gated by task 1.3: implementation does not start until the dock drops its ring; if the dock has already archived with it, this change first adds a `chat-view` delta removing it.

### D7 Narrow containers
- The header is a CSS container (`container-type: inline-size`). Below 760 px:
  - meta moves under the title;
  - the `pi` version text hides; tags and `+ tag` stay (`session-tags` keeps the editable strip in the detail header);
  - View and the switch become icon-only with accessible names and tooltips;
  - Changed Files hides its word and keeps its counts; "Changed Files" stays its accessible name and tooltip.
- The title is one line with `min-width: 6ch`, ellipsis, and the full name in `title`. This follows the ui-contract "row overflow" recipe: text truncates first, chips are never clipped.
- At any width, when the row is full, the meta line wraps under the title and the title truncates first; trailing controls are never clipped. The board renders A at 560 px (including a 66-character name) without overflow.
- The mobile layout stays a separate render path (`useMobile()`), as today.

### D8 Mobile header
- One 48 px row: back, title, `ContextRing` button, layout button, View (the existing `ChatViewMenu` trigger icon `mdiCog`, icon-only; opens the existing phone bottom sheet), ⋯. Every target is 44 px; the title keeps about 160 px at 390 px.
- `PiBelowFloorWarning` and `VaultBindingsChip` keep rendering under the row when present.
- **Layout button:**
  - Shows the current mode's icon (Split = `mdiViewSplitHorizontal`, because the mobile split stacks) plus a down caret.
  - It opens an APG menu of three `menuitemradio` items with a check on the current one; Split carries "Chat above, editor below".
  - It keeps `data-testid="layout-mode-switch"` on the trigger and `layout-mode-{closed,split,full}` on the items.
- **Info strip:** removed (`App.tsx:2428`). Cost moves into the ring popover; model and current tool are in the composer. On phones the thinking level is reachable only through the composer's model control (⋯ overflow today; the model chip popover once `add-composer-dock` lands, which hides the level from the chip face below 420 px), so it loses its at-a-glance spot; accepted with the approval of dropping the strip.

### D9 View menu placement (shared)
- `ChatViewMenu` renders immediately after the layout switch on desktop and after the layout button on mobile, identical to the `add-composer-dock` `chat-display-preferences` delta. The phone bottom-sheet requirement is mount-agnostic and unchanged.
- This change carries a byte-identical copy of that delta. If `add-composer-dock` archives first, delete this change's copy before archiving; a task enforces it.

### D10 Changed files stays
- The `ChangedFilesChip` keeps its behaviour (prefers `openChanges()`) and its label "Changed Files" (`file-diff-view` pins it), and moves to 12 px.
- The `add-composer-dock` Changes lane (Review) is a different entry point and both stay.

## Risks / trade-offs

- **Losing double-click rename** surprises existing users. Mitigation: F2 and the title menu; the menu item shows the F2 hint.
- **Removing the header Attach** removes a one-click path on desktop. The composer and card still offer it; approved.
- **Mobile users lose an always-visible cost.** It is one tap away in the ring popover.
- **Concurrent change `add-composer-dock`** touches `App.tsx` around the same composer-strip lines (`StatusBarRefreshButton`, `ChatViewMenu`). The second change to land rebases; the View move is the only shared edit.
- **Composer ring conflict:** `add-composer-dock` currently specifies a composer ring at every width. Shipping both as written shows two rings. Task 1.3 blocks implementation until that ring leaves `add-composer-dock`; if it has already archived with the ring, this change adds a `chat-view` delta removing it.

## Migration / rollback

Client-only; no server, protocol or persisted-data change. The `contextUsageBar` preference keeps its key, so stored overrides still apply to the card bar and the header ring. Rollback = revert the client commit.
