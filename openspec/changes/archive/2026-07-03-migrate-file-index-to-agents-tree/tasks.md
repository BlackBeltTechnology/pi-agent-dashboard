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
- [x] 4.3 Decide file-index fate (design §4d): SUPERSEDED — first implemented **(B)** generated rollup, then RETIRED to **(A)**. Deleted all 11 `docs/file-index*.md`; removed `exportRollup`/`treeRows`/`SPLIT_AREAS`/`TREE_ROOTS` from `migrate-runner.ts` (+ tests); re-homed `docs/` topic docs + 3 root-config files to new `docs/AGENTS.md` tree node. → verify: no `docs/file-index*.md` remain; kb suite green; `docs/AGENTS.md` has 20 rows

## 5. Docs + protocol update (delegate every docs/ write to a subagent, caveman style)
- [x] 5.1 Update AGENTS.md Investigation Protocol + Documentation Update Protocol: point at `kb agents <path>` / directory `AGENTS.md` as the per-file record; file-index splits become generated rollups, not the source of truth. → verify: protocol text names the tree, no stale "add a row to the split" as primary path
- [x] 5.2 Add `docs/file-index-<area>.md` rows (or tree rows) for the new migration script + `dox.ts` deltas. → verify: new files have a purpose row

## 6. Context-cost spike (design §5) — gate before push mode
- [x] 6.1 Measure per-turn `AGENTS.md` injection with the tree present: cwd=root vs cwd deep in `src/`. → verify: root-cwd load stays ~root-only; document the deep-cwd cost
- [x] 6.2 Keep `directoryLevelAgents` in **pull** mode until the spike clears push. → verify: default config ships pull, not push

## 7. Validate
- [x] 7.1 `openspec validate migrate-file-index-to-agents-tree --strict` passes. → verify: exit 0
- [x] 7.2 `npm test` green (dox unit tests updated for deltas ①–⑤). → verify: kb suite passes

## 8. Mega-file mitigation (design §5 residual) + rollup dedup
- [x] 8.1 Support `<File>.AGENTS.md` per-file index sidecars: `indexer.ts docTypeOf` classifies `*.AGENTS.md` as `agents` doc_type (searchable) while pi's native up-walk (name = `AGENTS.md` only) never auto-injects them; `dox.ts isMdFile` excludes sidecars from the md walk. → verify: kb suite green; sidecar returns from `kb search --doc-type agents`
- [x] 8.2 `dox.ts` over-threshold lint gains a byte trigger (`AGENTS_BYTE_CAP` 30 KB) alongside the row-count cap; detail names the fix (promote heaviest rows to `<File>.AGENTS.md`). → verify: a > 30 KB dir AGENTS.md reports `over-threshold`
- [x] 8.3 Split the 60 KB `packages/client/src/components/AGENTS.md` file-based via `scripts/split-large-agents.mjs` — rows > 200 chars → per-file sidecar (full detail + `See change:`), ≤ 200 stay verbatim; dir → ~26 KB, 111 sidecars. → verify: dir shrunk, every source file still has one row, no history lost
- [x] 8.4 De-dupe cross-split paths in the rollup: `exportRollup` drops each path from every non-canonical-owner split (was add-only) — 27 stale rows across 3 overlap clusters (kb↔extension, plugin-runtime↔server, roles-plugin↔client/plugins/server) removed. → verify: zero paths in > 1 `docs/file-index-*.md`
- [x] 8.5 `treeRows` resolves `→ see <File>.AGENTS.md` pointer rows back to full detail from the sidecar so `kb dox export` re-runs keep the rollup complete. → verify: rollup ChatView.tsx row = full reconstructed detail, no `→ see` leak
- [x] 8.6 Docs: root `AGENTS.md` Documentation Update Protocol Rule 3 gains the "large AGENTS.md not supported → split file-based" rule; project-init `project-profiles` spec's DOX doctrine requirement carries the same size rule (WRITE discipline + scenario). → verify: rule present in both, `openspec validate` green

## 9. Extend the tree to non-source areas (docker/, scripts/, .pi/skills/, public/, qa/, tests/e2e/, .github/workflows/)
- [x] 9.1 Generate per-directory `AGENTS.md` for the seven non-source areas, copying the curated split rows verbatim (paths rewritten relative to each `AGENTS.md`). Root-level config files (`biome.json`, `playwright.config.ts`, `.pi-test-harness.json`) + `docs/` files keep no directory owner → stay hand-maintained in splits. → verify: 78 rows migrated byte-identical; `kb agents docker/entrypoint.sh` returns root + `docker/AGENTS.md`
- [x] 9.2 Extend `treeRows` to walk `TREE_ROOTS` (packages + .github, .pi/skills, docker, public, qa, tests), guarded by `existsSync`; add `"docker"` to `SPLIT_AREAS` so the rollup loads the docker split. → verify: `treeRows` returns 78 non-packages rows; `exportRollup` unassigned=0; docker split re-synced (row count preserved)
- [x] 9.3 Regression test: `treeRows` picks up a non-packages (docker) `AGENTS.md` and `exportRollup` routes it to the docker split (not unassigned). → verify: kb suite green (61 passed)
- [x] 9.4 Root `AGENTS.md` protocol update: per-file record = tree for ANY file in a directory; only root-level config + `docs/` files use the splits (otherwise generated rollups). Removes "other areas pending" language. → verify: no stale "other areas → split" primary path; grep clean
- [x] 9.5 Tier-1 sync to current source: 155 miss files across the 7 areas authored from source via parallel `@fast` subagents (11 batches, deterministic merge, add-only — existing 78 curated rows byte-preserved). 4 binaries authored inline. → verify: every file in each area has exactly one row (miss=0, no dups); grounding pass flagged 21 rows, all false positives (config `key=val` formatting), zero fabrication
- [x] 9.6 `exportRollup` gains `nonSourceAreaOwner` structural map (docker/→docker; .github|.pi/skills|public|qa|scripts|tests→skills-misc) so brand-new non-source dirs with no existing split rows route correctly. → verify: unassigned=0 after sync; regression test for a fresh `.pi/skills/<skill>/` dir
- [x] 9.7 `.pi/skills/AGENTS.md` exceeded `AGENTS_BYTE_CAP` (30958 B) post-sync → split file-based via `scripts/split-large-agents.mjs` (46 inline rows ≤200 chars, 53 rows promoted to `<File>.AGENTS.md` sidecars). dir → 18.7 KB; `treeRows` reconstructs full detail from sidecars (0 `→ see` leaks in rollup). → verify: all 7 area AGENTS.md < 30 KB; kb suite green
