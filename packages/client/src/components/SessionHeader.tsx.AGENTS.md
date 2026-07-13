# SessionHeader.tsx — index

Session chat header (desktop + mobile). Renders name/rename (`InlineRenameInput`), model, thinking level, pi version, `FooterSegmentSlot`, OpenSpec attach/detach (`SearchableSelectDialog`), changed-files, Resume/Fork pill pair (ended + `sessionFile`), refresh. Mobile path delegates to `MobileHeader` + `MobileActionMenu`. Exports `SessionHeader`. Changed-files summary chip `ChangedFilesChip` calls `openChanges()` (Changes rail); `/session/:id/diff` takeover retained as fallback. See change: add-change-summary-table.
