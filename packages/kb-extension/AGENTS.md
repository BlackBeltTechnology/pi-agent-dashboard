# DOX — packages/kb-extension

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Isolated pi extension for markdown KB; not part of dashboard bridge. Registers native tools `kb_search`/`kb_neighbors`/`kb_get` (pull retrieval over SQLite/FTS5). `tool_result` hook Job 1 (always on): `.md` write/edit → debounced hash-gated incremental reindex. Job 2 (opt-in `doxEnforcement` OFF): non-md source write → nudge to update nearest `AGENTS.md`. `tool_call` push mode (opt-in) surfaces nearest `AGENTS.md`. |
| `vitest.config.ts` | Package vitest config. include `src/**/__tests__/**/*.test.ts`, node env, `pool: forks`, `maxWorkers: 1` (serial — tests share reindex state) + `sequence.groupOrder: 1`, which is REQUIRED once this project joined the root `vitest.config.ts` list: the root runner refuses to group two projects that disagree on `maxWorkers` under the same order. See change: add-markdown-knowledge-base; fix-kb-search-retrieval-quality. |
