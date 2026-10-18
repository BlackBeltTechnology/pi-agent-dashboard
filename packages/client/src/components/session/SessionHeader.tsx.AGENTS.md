# SessionHeader.tsx — index

Session chat header (desktop + mobile). Renders name/rename (`InlineRenameInput`), model, thinking level, pi version, `FooterSegmentSlot`, OpenSpec attach/detach (`SearchableSelectDialog`), changed-files, Resume/Fork pill pair (ended + `sessionFile`), refresh. Mobile path delegates to `MobileHeader` + `MobileActionMenu`. Exports `SessionHeader`. Changed-files summary chip `ChangedFilesChip` calls `openChanges()` (Changes rail); `/session/:id/diff` takeover retained as fallback. See change: add-change-summary-table.

Desktop header renders the editable `<TagEditor tags={session.tags} allTags onChange={onSetTags}>` + read-only phase `<TagChip variant=exec>` before the `flex-1` spacer (D5: detail-header primary). Props `allTags?`, `onSetTags?`. See change: add-session-tags.

Refresh-chat button carries `data-testid="refresh-chat"` (mapped as `TESTIDS.refreshChat`) so the L3 reset-path specs can drive the durable replay-cache purge. See change: purge-replay-cache-on-reset-paths.

Carries no YOLO signal: `YoloSessionIndicator` removed; remaining time is on the composer strip. See change: fix-yolo-indicator-overflow.

Mounts `<PiBelowFloorWarning>` next to `pi <version>` (desktop) and as a row in `MobileHeader`, guarded on `session.piBelowFloor`. See change: update-pi-core-1-0-adopt-apis.

Mobile attached chip shows `AttachmentTrace` (archived/missing/main-checkout), read-only. See change: resolve-archived-attached-proposal.

- Mounts `VaultBindingsChip` (desktop + mobile). See change: add-credential-vault.
