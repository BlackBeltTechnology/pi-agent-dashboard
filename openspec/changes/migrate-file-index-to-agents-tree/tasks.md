# Tasks — migrate-file-index-to-agents-tree

## 1. Source-aware `kb dox init` (packages/kb/src/dox.ts)
- [x] 1.1 Delta ①: switch `walkMd` target from `/\.(md|mdx)$/i` to source globs (`.ts/.tsx/.js/.jsx`), skipping `.d.ts`, `__tests__`, `*.test.*`. Make the extension set a parameter (default source) so `dox lint` can still walk md if needed. → verify: unit test — walk of a fixture returns `.tsx` not `.md`
- [x] 1.2 Delta ②: extend `DEFAULT_EXCLUDE` with `.worktrees`, `openspec`, `doc-example`. → verify: dry-run over a fixture with a `.worktrees/` dir yields zero rows under it
- [x] 1.3 Delta ③: `areaFiles` groups by `dirname(rel)` (full parent dir), not the first path segment. → verify: `src/client/components/*.tsx` → group key `src/client/components`; a nested fixture yields one group per real leaf dir
- [x] 1.4 Delta ④: remove the `part-N` pseudo-dir chunking loop in `doxInit`; over-cap real dirs either stay or note an `over-threshold` lint issue (no invented dirs). → verify: no `AGENTS.md` planned under a non-existent path
- [x] 1.5 Delta ⑤: `buildRows` emits paths relative to each `AGENTS.md`'s own directory. → verify: row in `src/client/AGENTS.md` reads `components/Foo.tsx`, not `src/client/components/Foo.tsx`
- [x] 1.6 `--dry-run` from repo root now plans a source tree with **no** `.worktrees`/`openspec`/`part-N` entries. → verify: manual dry-run; assert planned count is dominated by real `src/`+`packages/` dirs

## 2. Migration orchestrator + file-index parser
- [x] 2.1 Parse every `docs/file-index-<area>.md` into a `Map<path, { purpose, seeChange }>`. Row schema `| \`<path>\` | <purpose> |`; capture `See change:` annotations. → verify: parser test round-trips a sample split, preserves annotations verbatim
- [x] 2.2 Enumerate source files (reusing delta ①② walk) grouped by target directory (delta ③), anchored at source roots (`src/`, `packages/*/`) — never repo root. The hand-authored root `AGENTS.md` is protected (Rule 0); repo-root config files excluded. → verify: grouping matches `dox init` dry-run buckets; no plan appends to root `AGENTS.md`
- [x] 2.3 Join: mark each file `hit` (has file-index row) or `miss` (none); classify each directory `tier-0` (all hits) or `tier-1` (≥1 miss). → verify: counts sum to total; a known-covered file is `hit`; an all-hit dir is `tier-0`

## 3. Tiered migration (deterministic Tier 0 + parallel `@fast` Tier 1)
- [x] 3.1 Tier 0 (design §4a): for all-hit directories the orchestrator emits rows verbatim itself — no subagent. → verify: a `tier-0` dir's `AGENTS.md` equals the file-index purposes byte-for-byte; zero subagents spawned for it
- [x] 3.2 Tier 1 fan-out (design §4b): bounded pool (default 6 concurrent), work unit = one directory (atomic), coalesce sibling leaf dirs (~8 dirs / ~20 miss files per call), ~20-miss cap per subagent (split into sequential same-`AGENTS.md` sub-batches, never `part-N`). → verify: two `tier-1` dirs process concurrently; a 30-miss dir splits into 2 sub-batches appending one file
- [x] 3.3 Subagent contract (design §4c): input `{ dirRelPath, files:[{path,status,purpose?,seeChange?}] }` + caveman rule verbatim + row schema; output rows only — `hit` echoed byte-identical, `miss` authored from source (read-only, no invented `See change:`). → verify: `hit`-only input round-trips exactly; `miss` input yields non-empty purposes; subagent performs no writes
- [x] 3.4 Orchestrator owns writes + structural validation: exactly one row per input file, every purpose non-empty, hit purposes byte-identical; mismatch → retry once → record dir in `migration-gaps.json`. Writes via idempotent `ensure()`. → verify: malformed subagent output triggers one retry then a gap record; re-run tops up gaps without churning authored rows
- [x] 3.5 Tier-1 review gate (design §4c, semantic): each authored `miss` row routes through a second `@fast` reviewer (source + proposed row); flagged → one re-author → still-flagged recorded in `migration-gaps.json`, row kept + `<!-- review -->`. Tier-0 hit rows skip review. → verify: a deliberately-wrong authored purpose is flagged; a correct one passes; hit rows never enter review
- [x] 3.6 Resumability: checkpoint completed dirs; a re-run skips finished dirs and re-spawns only the unfinished/gap set. → verify: abort mid-run, re-run processes only remaining dirs
- [x] 3.7 Run the big-bang migration over `src/` + `packages/`; commit the generated per-directory `AGENTS.md` tree. → verify: tree present on disk, every source file has exactly one covering row, `migration-gaps.json` residuals triaged

## 4. Enable searchability + retrieval
- [x] 4.1 Flip `indexAgentsFiles: true`; reindex; confirm `kb search --doc-type agents` returns tree rows. → verify: a query that was buried in a monolith now returns the per-dir `AGENTS.md` chunk with higher rank
- [x] 4.2 Enable `directoryLevelAgents` pull mode; `kb agents <path>` returns the root→nearest chain for a deep source path. → verify: `kb agents src/client/components/<X>.tsx` returns root + nearest AGENTS.md
- [ ] 4.3 Decide file-index fate (design §4a): implement **(B)** generated rollup — `kb dox export` concatenates tree rows into `docs/file-index-<area>.md` (marked generated). → verify: rollup equals union of tree rows; a `kb get` of the rollup still works

## 5. Docs + protocol update (delegate every docs/ write to a subagent, caveman style)
- [x] 5.1 Update AGENTS.md Investigation Protocol + Documentation Update Protocol: point at `kb agents <path>` / directory `AGENTS.md` as the per-file record; file-index splits become generated rollups, not the source of truth. → verify: protocol text names the tree, no stale "add a row to the split" as primary path
- [x] 5.2 Add `docs/file-index-<area>.md` rows (or tree rows) for the new migration script + `dox.ts` deltas. → verify: new files have a purpose row

## 6. Context-cost spike (design §5) — gate before push mode
- [x] 6.1 Measure per-turn `AGENTS.md` injection with the tree present: cwd=root vs cwd deep in `src/`. → verify: root-cwd load stays ~root-only; document the deep-cwd cost
- [x] 6.2 Keep `directoryLevelAgents` in **pull** mode until the spike clears push. → verify: default config ships pull, not push

## 7. Validate
- [x] 7.1 `openspec validate migrate-file-index-to-agents-tree --strict` passes. → verify: exit 0
- [x] 7.2 `npm test` green (dox unit tests updated for deltas ①–⑤). → verify: kb suite passes
