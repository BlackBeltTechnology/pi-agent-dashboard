# Proposal

## Why

The session header is 37.75 px tall with 10 px labels, even on a 2,000 px screen. Its Chat / Split / Editor switch is under 20 px tall and shrinks to a 1 px sliver when a long title wraps. It also repeats what the composer and the session card already show: Attach, an unlabelled clock next to the card's different clock, and a full-width context bar row. Some icons mean two things: the Seek crosshair looks like the Focus-mode and Goals icons, and the header ⟳ (reload the transcript) looks the same as the composer ⟳ (reload OpenSpec data). On a 390 px phone the title gets 76 px (`Reorgani…`), and a 46 px info strip repeats the model, thinking level and current tool from the composer.

The redesign was reviewed on an as-built vs proposed mockup board and approved on 2026-10-21 (decisions D1–D10 in the board's `ui-plan.md`).

## What Changes

- **Desktop header becomes a 48 px row with three zones.**
  - **Leading:** back, title (16 px semibold) as a menu button, and a **Reveal in sidebar** icon button (`mdiDockLeft`).
  - **Middle:** plugin footer segments and the vault chip, unchanged.
  - **Trailing:** Modules, Changed files, Resume / Fork, then a larger **Chat / Split / Editor** switch on the right edge (32 px segments, 12 px labels), then the **View** menu.
  - When the row is full, the meta line wraps under the title and the title truncates; trailing controls are never clipped.
- **Title menu:** Rename (also F2), Reveal in sidebar, Edit tags, **Reload transcript**.
  - The ✎ button and double-click-to-rename are retired.
  - The Seek chip (`mdiCrosshairsGps`) is replaced by the Reveal icon and menu item. The reveal behaviour does not change.
  - The header ⟳ button becomes the **Reload transcript** menu item (`mdiHistory`). The mobile ⋯ item "Refresh Chat" gets the same label and icon. Reload behaviour does not change.
- **Meta line next to or under the title:**
  - Tags editor and phase chip.
  - `pi <version>`, which the pi-below-floor warning replaces when present.
  - A labelled clock: `running 5m 32s` while live, `ended · ran 42m` once ended (`lastActivityAt − startedAt`; plain `ended` when `lastActivityAt` is absent). Today a non-resumable ended session keeps ticking from `startedAt`.
  - A **context ring** (`role=meter`, ring + `13%`, tooltip `127.0k of 1.0M tokens`).
  - The clock ticks inside its own leaf component, not by re-rendering the whole header every second.
- **BREAKING (spec): the context-usage bar row under the header is removed.**
  - The ring replaces it. It is the only context indicator in the session view; the sidebar session card keeps its own bar.
  - The `contextUsageBar` display preference keeps gating the card bar and now gates the ring instead of the header bar.
  - `TokenStatsBar` keeps only the opt-in turn chart and stats.
- **BREAKING (spec): Attach leaves the header.**
  - Removed from the desktop header: the Attach button, the attached-change chip with its artifact letters, task counter and detach.
  - Removed from the mobile header: the paperclip and the attached-chip row.
  - Attach stays on the session card and in the composer.
- **Narrow content (container below 760 px):**
  - The `pi` version text hides first; tags and `+ tag` stay.
  - View and the switch become icon-only, each with an accessible name and a tooltip.
  - The title truncates to one line with the full name in its tooltip.
- **Mobile header becomes one 48 px row:** back · title · context ring button · current-layout icon menu (three `menuitemradio` items; Split described as "Chat above, editor below") · View · ⋯.
  - Tapping the ring shows `13% · 127.0k of 1.0M tokens · $0.99` (cost only when above zero).
  - The pi-below-floor warning and the vault chip still render under the row when present.
  - **BREAKING (spec): the info strip is removed.** The model and the current tool are in the composer. On phones the thinking level is reachable only through the composer's model control (⋯ overflow today, the model chip with `add-composer-dock`), so it is no longer visible at a glance. Cost moves into the ring's popover.
  - The mobile ring follows the `contextUsageBar` preference like the desktop ring; today's mobile strip bar ignored it.
- **View menu moves into the header, immediately after the layout switch,** on desktop and mobile (on phones it still opens as the bottom sheet).
  - `add-composer-dock` makes the same move in its own `chat-display-preferences` delta, and its proposal says whichever change lands first does it.
  - This change carries an identical delta and drops it if `add-composer-dock` archives first.
- Mockup: mockups/session-header-reorg (in this change)

## Non-goals

- **Anything inside the composer.** `add-composer-dock` owns the composer strip, its OpenSpec ⟳, composer Attach, and the dock.
- **The Focus-mode / Goals icon collision.** Both use `mdiTarget`; this is a follow-up.
- **Session card layout.**

## Capabilities

### New Capabilities
- `session-header`: layout, zones and responsive priority of the session chat header (desktop and mobile), the title menu, the meta line with the labelled clock, and the context ring.

### Modified Capabilities
- `chat-refresh`: the refresh affordance becomes the "Reload transcript" title-menu item on desktop and a renamed ⋯ item on mobile.
- `session-rename`: rename opens from the title menu or F2; the pencil and double-click entry points are removed.
- `session-card-seek`: the Seek chip becomes the icon-only "Reveal in sidebar" button plus a menu item.
- `session-resume`: ended sessions show `ended · ran <duration>`; the mobile layout no longer lists Attach.
- `split-editor-workspace`: the switch sits at the header's right edge on desktop; on mobile it is an icon menu rather than a segmented control.
- `token-stats-bar`: the context progress bar leaves the content header; visibility gating now covers the ring.
- `proposal-attachment`: the header artifact summary and the header artifact-reader callback are removed.
- `openspec-attach-combo`: the header PDST button and the mobile attached-chip row are removed; the archived-attachment trace stays on the card and composer.
- `openspec-attachment-resolution`: the desktop session header is no longer a reader of the attached change.
- `mobile-resilience`: the separate mobile attach/detach icon is removed.
- `mdi-icon-system`: the "Attach button has icon and text" scenario goes with the header Attach button.
- `play-stop-controls`: the mobile working label moves from the info strip to the composer status line; the "Mobile info strip agrees with the composer" scenario keeps its name and now checks that line.
- `chat-display-preferences`: the View menu mounts in the session header, immediately after the layout switch (same delta as `add-composer-dock`).

## Discipline Skills

- `performance-optimization`: the per-second clock moves from a whole-header `setInterval` re-render into a leaf component. Measure header renders per second before and after.
- `doubt-driven-review`: removing the header Attach and the context bar is a user-visible removal across 13 capabilities. Review it before it stands.
- `review-code`: a non-trivial client change, reviewed before commit.

## Impact

- **Code:**
  - `packages/client/src/components/session/SessionHeader.tsx` (desktop + `MobileHeader`, `MobileAttachButton` removed).
  - `packages/client/src/components/split/LayoutModeSwitch.tsx` (size, icon-only mode, mobile menu variant).
  - `packages/client/src/components/session/TokenStatsBar.tsx` (context bar removed).
  - New context ring and clock leaf components.
  - `packages/client/src/App.tsx`: mobile info strip removed; the `ChatViewMenu` and `StatusBarRefreshButton` wiring is shared with `add-composer-dock`.
  - `packages/client/src/components/shell/MobileActionMenu.tsx` (label).
- **Tests:**
  - Unit and e2e tests that drive `data-testid` `refresh-chat`, `session-header-seek-card`, `mobile-attach-btn`, `mobile-header-attached-chip`, and the context bar.
  - `refresh-chat` moves to the title-menu item; `session-header-seek-card` stays on the Reveal button. `mobile-attach-btn` and `mobile-header-attached-chip` are retired.
- **Coordinates with:**
  - `add-composer-dock`: shares the View-menu move (byte-identical `chat-display-preferences` delta). **Blocking conflict:** its proposal and `chat-view` delta keep a composer context ring "at every width", while this change puts the single ring in the header (approved). Implementation of this change is gated on that ring leaving `add-composer-dock` (task 1.3). Its Changes lane and the header Changed files chip both stay.
  - The shared `chat-display-preferences` delta is owned by `add-composer-dock` and copied byte for byte. Its Reason sentence assumes the dock has landed and its popover text has no phone carve-out; both are for that change's owner to adjust, and this copy follows.
  - `add-welcome-tutorial`: its anatomy chapter labels a "context bar". With this change that label must become the header's context ring (task 5.4).
- **Unaffected despite the name:** `openspec-attach-combo` "Attached session header shows one primary action and an overflow menu" governs the session OpenSpec block on the card and in the composer, not `SessionHeader`.
- **New strings** (title menu items and descriptions, Reveal, clock words, layout menu, ring labels and popover) need i18n keys in every locale (task 2.7).
- **Supersedes:** the header order of the archived `redesign-split-layout-controls` (`name ✎ [switch] Seek`).
