# openspec-change-watcher.ts — index

Per-cwd recursive `fs.watch` on `<cwd>/openspec/changes/`. Exports `matchesOpenSpecArtifact`, `OpenSpecChangeWatcher`, `createOpenSpecChangeWatcher(deps)`. Debounced `onChange(cwd)` trigger only (does NOT bypass mtime-gate/poll). Filters to `tasks.md`/`proposal.md`/`design.md`/`specs/**/*.md`. Silent degrade on ENOENT/EMFILE.

Also watches `openspec/` (non-recursive: `config.yaml`, `schemas` appearing) and `openspec/schemas/` (recursive); never `openspec/specs/`. `matchesOpenSpecArtifact(rel, outputsByChange?, eventType?)`: change-dir create/rename (bare dot-free segment, `rename` only, not `archive`), legacy names + `.openspec.yaml`, schema-declared outputs (`getOutputPatterns(cwd)`, glob-aware). `matchesOpenSpecRootEvent`. Each attach opens up to 3 watchers; `attach` returns true iff the `changes/` watcher attached. See change: use-openspec-status-all.

`FILTER_RE` matches `<change>/dependencies.yaml` (spec-driven changes do not declare it as an artifact). See change: add-openspec-change-dependencies.
