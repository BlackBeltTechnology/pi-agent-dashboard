# DOX — packages/kb

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. SQLite/FTS5 markdown knowledge base. `kb search` / `kb agents` / `kb dox lint` examples; points at `pi-dashboard-kb-extension` for the pi tools. |
| `skill/kb-search/SKILL.md` | kb-search skill. Frontmatter `name: kb-search`. Retrieve-before-answer: search local FTS5 markdown KB before answering project questions from memory/guessing. Pull retrieval (agent calls, nothing auto-injected), sub-second, zero model tokens. |
| `skill/kb-setup/SKILL.md` | kb-setup skill. Frontmatter `name: kb-setup`. One-time KB bring-up wrapping `kb init`: detect config → choose scope + sources → `kb init` → trust remote source → `kb index` → smoke `kb search` to verify. |
| `eval/golden.doc-example.json` | Example golden set (bare array form) shipped as a `kb eval --golden` sample. |
| `eval/golden.doc-example.paraphrase.json` | Paraphrase variant of the example golden set — tracks robustness to reworded queries. |
| `eval/golden.markdown-intent.json` | Bundled golden set, markdown targets (n=108). Mined from implicit click feedback in session transcripts. Carries `$provenance` + the stated sampling bias (only searches that produced an opened file are represented). See change: fix-kb-search-retrieval-quality. |
| `eval/golden.source-intent.json` | Bundled golden set, source targets (n=104). `expect` = the AGENTS.md record documenting the opened file (sidecar, else nearest ancestor naming it) — a source file can never appear in kb results since the KB indexes markdown; `openedFile` records what the agent actually opened. See change: fix-kb-search-retrieval-quality. |
| `eval/golden.provenance.json` | Mining parameters + corpus counts for both bundled fixtures (window, min query terms, click/refine/abandon split). Makes a re-mine auditable against quoted numbers. See change: fix-kb-search-retrieval-quality. |
| `eval/measure-render.ts` | Render repricing: mean tokens + distinct sources per page, legacy render vs shipped. Exits non-zero if a page grew. Needs the cached index from `run-fixtures.ts --fresh`. See change: fix-kb-search-retrieval-quality. |
| `eval/measure-search-latency.ts` | Search + verdict-enrichment latency over the bundled fixture index (reuses `run-fixtures.ts` cache; `--fresh` rebuilds). `--enrich` adds the ADDITIVE enrichment median/p95 vs the advisory 15 ms target; `--json`. See change: add-kb-trust-verdicts-and-search-guard. |
| `eval/mine-golden-sets.mjs` | Re-mines both golden sets from `~/.pi/agent/sessions/**.jsonl` via implicit relevance feedback (file opened within N tool calls of a `kb_search`). `--sessions/--out/--window/--repo`. Markdown pairs require the file to have appeared in that search's own results; source pairs resolve to the documenting AGENTS.md record. See change: fix-kb-search-retrieval-quality. |
| `eval/run-fixtures.ts` | Scores every ranking variant (baseline → dedup → quota → coverage rerank → PRF) over both fixtures against a real index of this repo. `--fresh` rebuilds the tmp index (minutes), else reuses it; `--sweep` walks the lane-quota share on the dedup-only base; `--json`. See change: fix-kb-search-retrieval-quality. |
| `verify.ts` | verify script. NODE_OPTIONS=--experimental-sqlite tsx verify.ts. |
| `vitest.config.ts` | vitest config for kb package. `pool:"forks"` + `maxWorkers:"50%"` matches the repo-wide project convention — required for the root runner to group this project (added to `vitest.config.ts` projects so kb tests finally gate CI). See change: fix-kb-search-retrieval-quality. |
