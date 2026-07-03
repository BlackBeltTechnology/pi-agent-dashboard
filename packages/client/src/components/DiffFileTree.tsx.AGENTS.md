# DiffFileTree.tsx — index

Two-level file tree of changed files. Exports `DiffFileTree`, `FileSelection`. Builds tree via `buildFileTree` (`lib/diff-tree`). Dir nodes expand/collapse; file nodes show modified(●)/added(+) indicator, expand to per-change events when `changes.length > 1`. Selects via `onSelect({ filePath, changeIndex })`.
