# SessionHeader.tsx — index

Session chat header (desktop + mobile). Desktop = 48 px row of three zones (leading: back + `SessionTitleMenu` + Reveal + meta line; middle: `FooterSegmentSlot` + vault chip; trailing: Modules · Changed Files · Resume/Fork · `LayoutModeSwitch` · View via `renderViewMenu`). Root is a CSS `@container relative z-popover`; below 760 px meta drops under the title and labels go icon-only. Mobile path = `MobileHeader` one 48 px row (back, title, `ContextRingButton`, `LayoutModeSwitch variant="menu"`, View icon, `MobileActionMenu`). Exports `SessionHeader`. Props `contextUsage`, `showContextRing`, `renderViewMenu`. No Attach UI, no `now` state (clock = `SessionClock` leaf). Exports `SessionHeader`. Changed-files summary chip `ChangedFilesChip` calls `openChanges()` (Changes rail); `/session/:id/diff` takeover retained as fallback. See change: add-change-summary-table.

Desktop header renders the editable `<TagEditor tags={session.tags} allTags onChange={onSetTags}>` + read-only phase `<TagChip variant=exec>` before the `flex-1` spacer (D5: detail-header primary). Props `allTags?`, `onSetTags?`. See change: add-session-tags.

`refresh-chat` testid now sits on the title-menu "Reload transcript" item (e2e: `reloadTranscript(page)` opens the menu first). See changes: purge-replay-cache-on-reset-paths, reorganize-session-header.

Carries no YOLO signal: `YoloSessionIndicator` removed; remaining time is on the composer strip. See change: fix-yolo-indicator-overflow.

Mounts `<PiBelowFloorWarning>` next to `pi <version>` (desktop) and as a row in `MobileHeader`, guarded on `session.piBelowFloor`. See change: update-pi-core-1-0-adopt-apis.

- Mounts `VaultBindingsChip` (desktop + mobile). See change: add-credential-vault.

F2 (while header has focus, not in an input) opens `InlineRenameInput`; double-click rename + pencil retired; Enter/Escape return focus to the title button. `onSeekToCard` → Reveal icon button (`mdiDockLeft`, testid `session-header-seek-card`) + menu item. See change: reorganize-session-header.
