# DOX — packages/kb-extension/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `extension.ts` | Extension entry. Registers kb_search/kb_neighbors/kb_get native tools. tool_result hook: Job 1 md write→debounced hash-gated reindex; Job 2 opt-in doxEnforcement nudge (default OFF, KB_DOX_ENFORCEMENT=1 forces on). Isolated standalone extension, not in bridge.ts. Re-exports `closeKbForCwd`. See change: sweep-worktree-residual-on-remove. |
| `index.ts` | Barrel. Re-exports extension default + reindex. |
| `reindex.ts` | Pure reindex + DOX-nudge logic. No pi imports. Testable without running pi. `reindexNow` is ASYNC now (awaits `indexSource`); debounce timer fire-and-forgets via `.catch`, `extension.ts` `kb_search` freshness `await`s it. See change: fix-kb-index-feedback. `acknowledgeRows`/`decideNudge` resolve DOX rows relative to their AGENTS.md dir (+ repo-root fallback via local `resolveRowPath` mirror), key staleness cwd-relative. Fixes always-"missing" nudge on basename rows. See change: fix-dox-lint-false-positives. `getKb`/`reindexNow` self-heal on cwd removal: if `cwd` gone, `getKb` throws (refuses fresh `new SqliteFtsStore` whose `mkdirSync` would recreate `<cwd>/.pi/dashboard/kb` = husk), `reindexNow` evicts + no-ops `{changed:0,chunks:0}`. Adds `closeKbForCwd(state,cwd)`: close+evict one cwd's store (WAL checkpoint drops `-wal`/`-shm`), cancel its timer. See change: sweep-worktree-residual-on-remove. |
