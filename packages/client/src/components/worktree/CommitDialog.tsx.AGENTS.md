# CommitDialog.tsx — index

Placement-agnostic commit dialog (`cwd` + `sessionId`). File picker (checkbox + `+/−`, select-all/none), subject+body, AI-draft button (empty draft → "unavailable" note), Commit gated on ≥1 file + subject. Exports `CommitDialog`, `CommitDialogProvider`, `useCommitDialog`. Provider mounts ONE instance at app root; surfaces call `open(cwd, sessionId)`. `onCommitted(shortHash, cwd)` → toast + `refreshGitStatus`. Calls `commitFiles`/`draftCommitMessage`/`fetchChangedFiles` (git-api). See change: add-session-uncommitted-indicator-and-commit.
