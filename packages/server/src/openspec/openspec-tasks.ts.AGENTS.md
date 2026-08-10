# openspec-tasks.ts — index

Parser + writer for an OpenSpec change's `tasks.md`. Exports `OpenSpecTask`, `NotFoundError`, `LineMismatchError`, `NotACheckboxError`, `parseTasksMarkdown`, `readTasks`, `toggleTask`. Handles id-ed (`1.1`) + id-less (`L<line>` synthesized, never written) checkboxes; byte-for-byte atomic toggle via write-then-rename with optimistic-concurrency `line` token.
