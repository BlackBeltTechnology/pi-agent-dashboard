# TasksPopover.tsx — index

Modal popover listing parseable tasks from an attached change's `tasks.md`, grouped by heading, native checkboxes. Optimistic toggle (`apiToggleTask`) with `LineMismatchError` 409 refetch. Esc/↑/↓ keyboard nav. Via `DialogPortal`. Uses `fetchTasks`/`toggleTask` from `openspec-tasks-api`. Exports `TasksPopover`.
