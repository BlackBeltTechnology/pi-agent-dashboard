# Test Plan — fix-kb-parent-link-and-section-miss

Stage: design   Generated: 2026-11-20

No clarifications needed: every Triple below fills from the delta specs and design.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-markdown-chunking / Siblings share the enclosing parent | EP | L1 | automated | `# Title`, `## A`, `## B`, each with a 120-char trimmed body, no frontmatter | `chunkMarkdown` | `A.parentChunkId === B.parentChunkId === Title.chunkId`; neither equals its own or the sibling's chunk id |
| E2 | kb-markdown-chunking / Parent survives a blank preamble (judo regression) | EP (reported shape) | L1 | automated | judo `extension-points.md` shape: frontmatter, blank line, `# Frontend Extension Points` with a 98-char intro, then 12 `##` sections each ≥ 200 chars, last one with a nested `###` | `chunkMarkdown` | every `##` chunk's `parentChunkId` is the `# Frontend Extension Points` chunk id (`:0`); the `###` points at its `##`; no chunk's `parentChunkId` equals its own `chunkId` |
| E3 | kb-markdown-chunking / Chunkless enclosing section yields a null parent (empty) | EP | L1 | automated | `# Title` (120 chars), `## P` with no body, `### C` (120 chars) | `chunkMarkdown` | `C.parentChunkId === null`; C's `headingPath` is `Title > P > C` |
| E4 | kb-markdown-chunking / Chunkless enclosing section (tiny-merge boundary) | BVA | L1 | automated | same as E3 but `## P` trimmed body of 99, then 100 chars | `chunkMarkdown` for each | 99 → P merged away, `C.parentChunkId === null`; 100 → P is its own chunk, `C.parentChunkId === P.chunkId` |
| E5 | kb-markdown-chunking / Children of an oversize-split parent reference its first piece | EP | L1 | automated | `## Big` with two blank-line-separated paragraphs of 2600 chars each (≥ 5000 total), then `### Kid` (120 chars) | `chunkMarkdown` | `Big` yields ≥ 2 chunks with the same `headingPath`; `Kid.parentChunkId` is the first `Big` piece's `chunkId` |
| E6 | kb-markdown-chunking / no whitespace-only split piece (tasks 1.1) | BVA | L1 | automated | `## Big` whose body starts with `\n\n\n` followed by a 4500-char paragraph and a 600-char paragraph | `chunkMarkdown` | no emitted chunk has an empty trimmed body; `Big`'s first piece body starts with the 4500-char paragraph |
| E7 | kb-markdown-chunking / Parent chunk reference (skipped heading level) | EP | L1 | automated | `# T` (120 chars) directly followed by `### C` (120 chars) | `chunkMarkdown` | `C.headingPath === "T > C"`, `C.parentChunkId === T.chunkId` |
| E8 | markdown-knowledge-base / Attached parent is an enclosing heading of the hit (invariant) | property / invariant | L1 | automated | every `.md` under the repo's `docs/` and `openspec/specs/` | `chunkMarkdown` each file | for every chunk with a non-null `parentChunkId`: the id exists among the file's chunk ids, is not the chunk's own id, and (titles without ` > `) the parent's `headingPath` equals the chunk's `headingPath` minus its last segment |
| E9 | kb-markdown-chunking / child_of edges follow the parent | EP | L1 | automated | E3 fixture indexed into `SqliteFtsStore` | `indexSource` then read edges | `### C` node has `child_of` → the file node; `## A`-style children edge to their parent heading node; no `child_of` self-loop |
| E10 | markdown-knowledge-base / Parent context + No parent reference, no parent | EP | L1 | automated | E1 + E3 fixtures indexed | `store.search` with `expandParent: true` for a term only in `## A`, then a term only in `### C` | A's hit `parent.headingPath === "Title"`; C's hit has no `parent` field |
| E11 | markdown-knowledge-base / Unknown section | EP | L1 | automated | indexed `guide.md` with `# Guide`, `## Setup`, `## Config` (each ≥ 120 chars) | `resolveFetch` + `renderFetch` with section `Guide > Nope` | text is exactly `(section not found: Guide > Nope in guide.md — sections:)\nGuide\nGuide > Setup\nGuide > Config`; `found === false`; no `(not found: guide.md)`; no body text |
| E12 | markdown-knowledge-base / Section list is capped | BVA | L1 | automated | indexed files with 50, 51 and 60 distinct `##` sections (each ≥ 120 chars) | unknown section on each | 50 → 50 lines, no count line; 51 → 50 lines + `(+1 more section)`; 60 → 50 lines + `(+10 more sections)`; listed lines are the first 50 in document order |
| E13 | markdown-knowledge-base / each listed once, meta excluded | EP | L1 | automated | file with frontmatter `title: Other Title`, `# Guide`, an oversize-split `## Big` (E5 shape) | unknown section | `Guide > Big` appears exactly once; `Other Title` does not appear |
| E14 | markdown-knowledge-base / File without body sections | EP | L1 | automated | file with frontmatter (`title`, `description`) and no body | `resolveFetch` with section `Nope` | text is exactly `(section not found: Nope in <path> — no sections)`; `found === false` |
| E15 | markdown-knowledge-base / Listed heading path round-trips | invariant | L1 | automated | E13 + E6 fixtures | for each listed path, `resolveFetch(path, section=listed)` | every result is `kind: "hit"` with a non-empty trimmed body |
| E16 | markdown-knowledge-base / Unknown path still reports the path not-found marker | EP | L1 | automated | no `nope.md` indexed | `resolveFetch("nope.md", "Anything")` | text is exactly `(not found: nope.md)`; no section list |
| E17 | markdown-knowledge-base / marker names the path as passed | EP | L1 | automated | `guide.md` in root `docs` | unknown section with arg `docs:guide.md` | marker reads `… in docs:guide.md — sections:)` |
| E18 | design D1 / bare leaf of a chunkless child still resolves | EP | L1 | automated | E3 fixture indexed | `resolveFetch(path, "C")` | `kind: "hit"`, body is C's body (last-heading fallback) |

### Performance

None: the specs set no latency or size budget; the only new query runs on the error path (design D3).

### Frontend-quirk

None: no client surface changes.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D2 / stale index re-chunks | state-transition (stale → current) | L1 | automated | DB at `user_version = SCHEMA_VERSION - 1` holding the E2 file indexed with a self-referential `parent_chunk_id` row | one index pass through the legacy global gate (no per-source gate) | every stored `parent_chunk_id` for that file equals the E2 expectation; `getUserVersion() === SCHEMA_VERSION` |
| X2 | markdown-knowledge-base / CLI and tool agree on an unknown section | EP (two surfaces) | L1 | automated | same indexed `guide.md` | `kb get guide.md --section "Guide > Nope"` as a subprocess and the `kb_get` query-worker path | both outputs byte-identical to E11's text |

---

## Coverage summary

- Requirements covered: 3/3 (Breadcrumb and Parent Linkage; Parent and graph context expansion; Section argument falls back to the last heading), plus design D1 fallback and D2 migration
- Scenarios by class: edge 18 · perf 0 · frontend 0 · error 2
- Scenarios by level: L1 20 · L2 0 · L3 0
- Scenarios by disposition: automated 20 · manual-only 0

## New infra needed

- none
