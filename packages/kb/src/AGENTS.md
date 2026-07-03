# DOX — packages/kb/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `chunker.ts` | Structural heading chunker. Fence-safe, breadcrumb-aware. Line-based fenced-code state machine. |
| `cli.ts` | kb CLI. Commands index\|search\|neighbors\|backlinks\|get\|config. Dev run NODE_OPTIONS=--experimental-sqlite tsx src/cli.ts. |
| `config.ts` | Config layering. project .pi/dashboard/knowledge_base.json → global ~/.pi/dashboard/knowledge_base.json → defaults. No file-count cap default. |
| `dox.ts` | DOX tree. Directory-level AGENTS.md scaffold + audit. kb agents <path> nearest-applicable chain. Detect-don't-write: dox init/--fix fill PATH columns + prune orphans only. `over-threshold` lint fires on row count > `ROW_CAP` (40) OR bytes > `AGENTS_BYTE_CAP` (30 KB) → split file-based. `isMdFile` excludes `*.AGENTS.md` sidecars. See change: split-components-agents-dedup-rollup. |
| `eval.ts` | Retrieval-quality eval. Scores search against golden set. Gates ranking changes. |
| `index.ts` | Public API barrel for @blackbelt-technology/pi-dashboard-kb. |
| `indexer.ts` | Indexer. Walks source, mtime→sha256 change detection, structural chunking, Tier-1 graph extraction, transactional upsert. `docTypeOf` classifies `*.AGENTS.md` per-file index sidecars as `agents` doc_type (searchable; name != `AGENTS.md` so pi never auto-injects them). See change: split-components-agents-dedup-rollup. |
| `init.ts` | kb init. Scaffolds + validates knowledge_base.json. --global writes global file. --force, --dry-run flags. gitignores dbPath. |
| `migrate-file-index.ts` | One-time migration core. Re-homes `docs/file-index-<area>.md` purposes into per-dir `AGENTS.md` tree. Pure + testable. Exports `parseFileIndex`, `mergeIndex`, `planDirs`, `tier0Rows`, `renderAgentsMd`, `validateAuthored`, `finalRows`, types `IndexRow`, `FileEntry`, `DirPlan`, `AuthoredRow`. Classifies dirs tier 0 (all hits, deterministic) vs tier 1 (≥1 miss, needs subagent). |
| `migrate-runner.ts` | Big-bang resumable runner for file-index → AGENTS.md migration. Owns plan, batching, grounding gate, idempotent per-dir write, checkpoint persistence. Exports `loadSplitTexts`, `buildDirPlans`, `groundingCheck`, `knownStems`, `makeBatches`, `subagentPrompt`, `parseAuthoredBatch`, `recordAuthored`, `writeDir`, `loadState`, `saveState`, plus `exportRollup` + `treeRows` (task 4.3: add-only rollup syncing tree source rows back into `docs/file-index-<area>.md`, byte-preserving curated + non-source rows). `exportRollup` now drops cross-split duplicate rows, keeping each path only in its canonical owner split; `treeRows` resolves `→ see <File>.AGENTS.md` pointer rows back to full detail from the sidecar so rollups stay complete across re-runs. Drives `@fast` subagent fan-out for Tier-1 authoring. `treeRows` walks `TREE_ROOTS` (packages + non-source areas .github, .pi/skills, docker, public, qa, tests), `existsSync`-guarded; `SPLIT_AREAS` includes `docker` so `exportRollup` loads + re-syncs that split. See change: split-components-agents-dedup-rollup. See change: migrate-file-index-to-agents-tree. |
| `sources.ts` | Pluggable source resolvers. fs/npm/git/https → local dir. KB reads markdown only, never executes source. |
| `sqlite-store.ts` | Default KbStore backend over node:sqlite. FTS5. Zero runtime deps. Requires --experimental-sqlite. better-sqlite3 drop-in fallback. |
| `trust.ts` | TOFU trust store for remote sources. fs sources skip trust. npm/git/https confirm on first fetch. Keyed by sha256(canonical(SourceSpec)). |
| `types.ts` | KbStore interface + chunk types. Storage accessed only through KbStore. |
