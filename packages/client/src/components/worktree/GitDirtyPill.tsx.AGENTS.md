# GitDirtyPill.tsx — index

Shared dirty/drift indicator on both git surfaces (`GitInfo` card, `GroupGitInfo` header). `● N` filled `--severity-warning-bg/-fg/-border` capsule (AA; replaces undefined `--status-warning` + `#d97706`) = uncommitted files, last element of the header git row (`flex-shrink-0` via `className`); `↑A`/`↓B` chips when non-zero. Whole pill is a button → opens commit dialog. Hidden when clean + in sync AND when `status` absent. Exports `GitDirtyPill`. See change: add-session-uncommitted-indicator-and-commit. See change: compact-session-card-header.
