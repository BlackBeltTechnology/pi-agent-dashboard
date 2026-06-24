# File Index — Knowledge base

> Part of [pi-agent-dashboard file index](./file-index.md). Loaded on demand.
>
> **Change-history annotations** (e.g. *"See change: foo-bar"*) → OpenSpec changes archived under `openspec/changes/archive/`.
>
> **Update protocol**: see `AGENTS.md` → "Documentation Update Protocol".

> Wired into project via `.pi/settings.json` extensions list as `+packages/kb-extension/src/index.ts`.

| File | Purpose |
|------|---------|
| `packages/kb-extension/package.json` | npm manifest. name @blackbelt-technology/pi-dashboard-kb-extension. peer deps pi-coding-agent. |
| `packages/kb-extension/src/__tests__/reindex.test.ts` | vitest suite for reindex logic. |
| `packages/kb-extension/src/extension.ts` | Extension entry. Registers kb_search/kb_neighbors/kb_get native tools. tool_result hook: Job 1 md write→debounced hash-gated reindex; Job 2 opt-in doxEnforcement nudge (default OFF, KB_DOX_ENFORCEMENT=1 forces on). Isolated standalone extension, not in bridge.ts. |
| `packages/kb-extension/src/index.ts` | Barrel. Re-exports extension default + reindex. |
| `packages/kb-extension/src/reindex.ts` | Pure reindex + DOX-nudge logic. No pi imports. Testable without running pi. |
| `packages/kb/eval/golden.doc-example.json` | Golden query→expected-path-substring set. Scores retrieval. |
| `packages/kb/eval/golden.doc-example.paraphrase.json` | Paraphrase golden set. Tracks paraphrase retrieval quality. |
| `packages/kb/package.json` | npm manifest. name @blackbelt-technology/pi-dashboard-kb. exports ./src/index.ts. type module. |
| `packages/kb/skill/kb-search/` | Skill dir. kb-search usage docs. |
| `packages/kb/skill/kb-setup/` | Skill dir. kb-setup usage docs. |
| `packages/kb/src/__tests__/kb.test.ts` | vitest suite for kb package. |
| `packages/kb/src/chunker.ts` | Structural heading chunker. Fence-safe, breadcrumb-aware. Line-based fenced-code state machine. |
| `packages/kb/src/cli.ts` | kb CLI. Commands index\|search\|neighbors\|backlinks\|get\|config. Dev run NODE_OPTIONS=--experimental-sqlite tsx src/cli.ts. |
| `packages/kb/src/config.ts` | Config layering. project .pi/dashboard/knowledge_base.json → global ~/.pi/dashboard/knowledge_base.json → defaults. No file-count cap default. |
| `packages/kb/src/dox.ts` | DOX tree. Directory-level AGENTS.md scaffold + audit. kb agents <path> nearest-applicable chain. Detect-don't-write: dox init/--fix fill PATH columns + prune orphans only. |
| `packages/kb/src/eval.ts` | Retrieval-quality eval. Scores search against golden set. Gates ranking changes. |
| `packages/kb/src/index.ts` | Public API barrel for @blackbelt-technology/pi-dashboard-kb. |
| `packages/kb/src/indexer.ts` | Indexer. Walks source, mtime→sha256 change detection, structural chunking, Tier-1 graph extraction, transactional upsert. |
| `packages/kb/src/init.ts` | kb init. Scaffolds + validates knowledge_base.json. --global writes global file. --force, --dry-run flags. gitignores dbPath. |
| `packages/kb/src/sources.ts` | Pluggable source resolvers. fs/npm/git/https → local dir. KB reads markdown only, never executes source. |
| `packages/kb/src/sqlite-store.ts` | Default KbStore backend over node:sqlite. FTS5. Zero runtime deps. Requires --experimental-sqlite. better-sqlite3 drop-in fallback. |
| `packages/kb/src/trust.ts` | TOFU trust store for remote sources. fs sources skip trust. npm/git/https confirm on first fetch. Keyed by sha256(canonical(SourceSpec)). |
| `packages/kb/src/types.ts` | KbStore interface + chunk types. Storage accessed only through KbStore. |
| `packages/kb/verify.ts` | verify script. NODE_OPTIONS=--experimental-sqlite tsx verify.ts. |
| `packages/kb/vitest.config.ts` | vitest config for kb package. |
