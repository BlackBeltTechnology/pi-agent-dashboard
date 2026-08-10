# openspec-change-watcher.ts — index

Per-cwd recursive `fs.watch` on `<cwd>/openspec/changes/`. Exports `matchesOpenSpecArtifact`, `OpenSpecChangeWatcher`, `createOpenSpecChangeWatcher(deps)`. Debounced `onChange(cwd)` trigger only (does NOT bypass mtime-gate/poll). Filters to `tasks.md`/`proposal.md`/`design.md`/`specs/**/*.md`. Silent degrade on ENOENT/EMFILE.
