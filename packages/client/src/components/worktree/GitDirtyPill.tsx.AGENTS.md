# GitDirtyPill.tsx — index

Shared dirty/drift indicator on both git surfaces (`GitInfo` card, `GroupGitInfo` header). `● N` amber pill = uncommitted files; `↑A`/`↓B` chips when non-zero. Whole pill is a button → opens commit dialog. Hidden when clean + in sync AND when `status` absent. Exports `GitDirtyPill`. See change: add-session-uncommitted-indicator-and-commit.
