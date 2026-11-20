# Tasks

## 1. Markdown parent linkage

- [ ] 1.1 In `packages/kb/src/chunker.ts`, carry each raw section's `ordinal` and `parentOrdinal` through flush, tiny-merge and oversize-split, then resolve `parentChunkId` through an `ordinal → first final index` map, null when absent (design D1, mirroring `adoc-chunker.ts:261-292`); also skip a whitespace-only split piece in the oversize split (`chunker.ts:145-155`) so every listed heading path round-trips to a non-empty body; verify the folded chunker tests pass and the existing `packages/kb` vitest suite stays green
- [ ] 1.2 Bump `SCHEMA_VERSION` in `packages/kb/src/sqlite-store.ts` from 3 to 4 and update the literal in `packages/kb/src/__tests__/index-integrity-install.test.ts:229`; verify `npx vitest run packages/kb` passes
- [ ] 1.3 Update the `SCHEMA_VERSION` note in `packages/kb/src/sqlite-store.ts.AGENTS.md` and the `chunker.ts` row in `packages/kb/src/AGENTS.md` (parent = direct enclosing section's first chunk, else null); verify with `grep -n "SCHEMA_VERSION" packages/kb/src/sqlite-store.ts.AGENTS.md`

## 2. Section-not-found marker

- [ ] 2.1 In `packages/kb/src/fetch-resolve.ts`, make `getChunks(root, path)` a required `FetchStore` member, add the `section-missing` `FetchResult` kind carrying distinct body-chunk heading paths in document order (`:meta` excluded, design D4), and render `(section not found: <section> in <arg> — sections:)` + at most 50 paths + `(+K more section[s])`, or `— no sections)` when the list is empty, with `found: false`; keep `(not found: <arg>)` for unresolved paths (design D3); change the unknown-section assertions in `fetch-resolve.test.ts` (`:165-166`) from `missing` to `section-missing`; verify the folded fetch tests pass
- [ ] 2.2 Add one sentence on the section-not-found retry list to the `kb_get` tool description in `packages/kb-extension/src/extension.ts`; verify the kb-extension vitest suite passes
- [ ] 2.3 Update the `fetch-resolve.ts` row in `packages/kb/src/AGENTS.md` (`hit | ambiguous | section-missing | missing`) and the `kb get` section in `packages/kb/README.md`; add a CHANGELOG `## [Unreleased]` entry naming the `FetchResult` variant and required `FetchStore.getChunks`; verify with `grep -n "section-missing" packages/kb/src/AGENTS.md CHANGELOG.md`
- [ ] 2.4 Delegate the `docs/architecture.md` `kb_get` resolution update (near the `0 → (not found: <arg>)` line) to DocScribe with the caveman-style rule; verify `grep -n "section not found" docs/architecture.md` returns the new line

## 4. Tests (folded from test-plan.md; write each first and see it fail before the matching group-1/2 task)

- [ ] 4.1 Add a chunker parent-linkage test file `packages/kb/src/__tests__/chunker-parent.test.ts` (harness exemplar: `packages/kb/src/__tests__/chunker-links.test.ts`) covering test-plan #E1 (input `# Title`, `## A`, `## B` each 120 chars · trigger `chunkMarkdown` · observable both siblings' `parentChunkId` is the Title chunk id, neither self nor sibling)
- [ ] 4.2 In `chunker-parent.test.ts`, cover test-plan #E2 (input judo `extension-points.md` shape: frontmatter, blank line, `# Frontend Extension Points` with a 98-char intro, 12 `##` sections, one nested `###` · trigger `chunkMarkdown` · observable every `##` parent is `:0`, the `###` parent is its `##`, no self-reference)
- [ ] 4.3 In `chunker-parent.test.ts`, cover test-plan #E3 (input `# Title` 120, empty `## P`, `### C` 120 · trigger `chunkMarkdown` · observable `C.parentChunkId === null`, headingPath `Title > P > C`)
- [ ] 4.4 In `chunker-parent.test.ts`, cover test-plan #E4 (input E3 shape with `## P` trimmed body 99 then 100 chars · trigger `chunkMarkdown` · observable 99 → C parent null; 100 → C parent is P's chunk id)
- [ ] 4.5 In `chunker-parent.test.ts`, cover test-plan #E5 (input `## Big` of two 2600-char paragraphs + `### Kid` 120 · trigger `chunkMarkdown` · observable Big yields ≥ 2 pieces, Kid's parent is the first piece's chunk id)
- [ ] 4.6 In `chunker-parent.test.ts`, cover test-plan #E6 (input `## Big` body `\n\n\n` + 4500-char + 600-char paragraphs · trigger `chunkMarkdown` · observable no chunk has an empty trimmed body; first Big piece starts with the 4500-char paragraph)
- [ ] 4.7 In `chunker-parent.test.ts`, cover test-plan #E7 (input `# T` 120 then `### C` 120 · trigger `chunkMarkdown` · observable C headingPath `T > C`, parent T's chunk id)
- [ ] 4.8 In `chunker-parent.test.ts`, cover test-plan #E8 (input every `.md` under `docs/` and `openspec/specs/` · trigger `chunkMarkdown` each · observable each non-null parent id exists, is not self, and for titles without ` > ` its headingPath is the child's minus the last segment)
- [ ] 4.9 In `packages/kb/src/__tests__/index-integrity-graph.test.ts` (harness exemplar: its "E7 same heading text in two files" case at `:75`), cover test-plan #E9 (input E3 fixture · trigger `indexSource` then read edges · observable `### C` `child_of` → file node, nested children → their parent heading node, no self-loop)
- [ ] 4.10 In `packages/kb/src/__tests__/kb.test.ts` (harness exemplar: the `expandParent` case at `:265`), cover test-plan #E10 (input E1 + E3 fixtures indexed · trigger `store.search` with `expandParent: true` for an A-only then a C-only term · observable A's `parent.headingPath === "Title"`, C's hit has no `parent`)
- [ ] 4.11 In `packages/kb/src/__tests__/fetch-resolve.test.ts` (harness exemplar: its "section argument" describe block at `:123`), cover test-plan #E11 (input `guide.md` with `# Guide`, `## Setup`, `## Config` · trigger `resolveFetch`+`renderFetch` section `Guide > Nope` · observable exact text `(section not found: Guide > Nope in guide.md — sections:)` + `Guide`, `Guide > Setup`, `Guide > Config` lines, `found === false`, no body)
- [ ] 4.12 In `fetch-resolve.test.ts`, cover test-plan #E12 (input files with 50, 51, 60 distinct `##` sections · trigger unknown section · observable 50 → no count line; 51 → `(+1 more section)`; 60 → `(+10 more sections)`; first 50 in document order)
- [ ] 4.13 In `fetch-resolve.test.ts`, cover test-plan #E13 (input frontmatter `title: Other Title`, `# Guide`, oversize-split `## Big` · trigger unknown section · observable `Guide > Big` listed once, `Other Title` absent)
- [ ] 4.14 In `fetch-resolve.test.ts`, cover test-plan #E14 (input frontmatter-only file · trigger section `Nope` · observable exact `(section not found: Nope in <path> — no sections)`, `found === false`)
- [ ] 4.15 In `fetch-resolve.test.ts`, cover test-plan #E15 (input E13 + E6 fixtures · trigger fetch each listed path as section · observable every result is a hit with a non-empty trimmed body)
- [ ] 4.16 In `fetch-resolve.test.ts`, cover test-plan #E16 (input no `nope.md` indexed · trigger `resolveFetch("nope.md", "Anything")` · observable exact `(not found: nope.md)`, no list)
- [ ] 4.17 In `fetch-resolve.test.ts`, cover test-plan #E17 (input `guide.md` in root `docs` · trigger unknown section with arg `docs:guide.md` · observable marker reads `in docs:guide.md — sections:)`)
- [ ] 4.18 In `fetch-resolve.test.ts`, cover test-plan #E18 (input E3 fixture indexed · trigger `resolveFetch(path, "C")` · observable hit with C's body via last-heading fallback)
- [ ] 4.19 In `packages/kb/src/__tests__/frontmatter-indexing.test.ts` (harness exemplar: the stale `user_version` case at `:258`), cover test-plan #X1 (input DB at `SCHEMA_VERSION - 1` holding the E2 file with a self-referential `parent_chunk_id` · trigger one legacy-gate index pass · observable stored parents match E2, `getUserVersion() === SCHEMA_VERSION`)
- [ ] 4.20 In `packages/kb-extension/src/__tests__/query-worker-tools.test.ts` (harness exemplar: subprocess CLI pattern in `packages/kb/src/__tests__/eval-guard.test.ts:9`), cover test-plan #X2 (input indexed `guide.md` · trigger `kb get guide.md --section "Guide > Nope"` subprocess and the `kb_get` worker path · observable both outputs byte-identical to E11's text)

## 5. Build and integration

- [ ] 5.1 Run `npm run build -w @blackbelt-technology/pi-dashboard-kb` and commit the regenerated `packages/kb/engine-fingerprint.json`; verify `node scripts/check-kb-dist-fresh.mjs` exits 0
- [ ] 5.2 Run `npm test` (pipefail + tee per AGENTS.md) and confirm no new failures; then `npm run reload` and `npx tsx .pi/skills/implement/scripts/restart-server.ts`; verify `curl -s http://localhost:8000/api/health` responds
