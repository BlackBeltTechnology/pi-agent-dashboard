# SessionHeader.tsx — index

Session chat header (desktop + mobile). Renders name/rename (`InlineRenameInput`), model, thinking level, pi version, `FooterSegmentSlot`, OpenSpec attach/detach (`SearchableSelectDialog`), changed-files, Resume/Fork pill pair (ended + `sessionFile`), refresh. Mobile path delegates to `MobileHeader` + `MobileActionMenu`. Exports `SessionHeader`. Changed-files summary chip `ChangedFilesChip` calls `openChanges()` (Changes rail); `/session/:id/diff` takeover retained as fallback. See change: add-change-summary-table.

Desktop header renders the editable `<TagEditor tags={session.tags} allTags onChange={onSetTags}>` + read-only phase `<TagChip variant=exec>` before the `flex-1` spacer (D5: detail-header primary). Props `allTags?`, `onSetTags?`. See change: add-session-tags.

Refresh-chat button carries `data-testid="refresh-chat"` (mapped as `TESTIDS.refreshChat`) so the L3 reset-path specs can drive the durable replay-cache purge. See change: purge-replay-cache-on-reset-paths.

Desktop (after `FooterSegmentSlot`) and mobile (below the chip row) render `YoloSessionIndicator cwd={session.cwd}`: active-YOLO peer signal when cwd in scope, visible without the sidebar. See change: add-access-grant-dialog (tasks 8b.7).
