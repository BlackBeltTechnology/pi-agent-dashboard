# Test Plan — slim-kb-search-output

Stage: design   Generated: 2025-05-27

No clarifications needed: the change is deterministic output-formatting; after
two doubt-review cycles every scenario Triple fills from the spec + design. No
spec gap → HARD gate has nothing to ask.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | condensed default | EP (valid) | L1 | automated | 3 ranked hits | `kb_search(query="x")`, no `format` | output is condensed text; first entry starts `1  <path>  ::  <headingPath>`; contains no BM25 float |
| E2 | json opt-in retains score | EP (valid) | L1 | automated | 3 ranked hits | `format:"json"` | output is compact JSON (no `\n  ` indent); each hit has numeric `score` AND integer `rank`; `parent` is `{headingPath}` |
| E3 | unknown format → condensed | EP (invalid) | L1 | automated | 3 hits | `format:"xml"` | renders condensed; no throw / no error return |
| E4 | exact-match allowlist | EP (invalid) | L1 | automated | 3 hits | `format:"JSON"` (wrong case) | falls back to condensed (only lowercase `"json"` selects JSON) |
| E5 | akaPaths surfaced | decision-table | L1 | automated | hit with `akaPaths:["a","b"]` | condensed render | entry contains `(+2 dup)` |
| E6 | no dup marker when absent | decision-table | L1 | automated | hit with `akaPaths` undefined | condensed render | entry contains no `(+` substring |
| E7 | parent continuation | decision-table | L1 | automated | hit with `parent:{headingPath:"P"}` | condensed render | output contains `⤷ P` |
| E8 | no parent line when absent | decision-table | L1 | automated | hit with `parent:null` | condensed render | output contains no `⤷` |
| E9 | rank is 1-based ordinal | BVA | L1 | automated | N hits (N=1 and N=3) | condensed render | ranks are exactly `1` (N=1) and `1,2,3` in order (N=3) — ordinal over post-limit survivors |
| E10 | empty query, condensed | EP (boundary) | L1 | automated | `query:"   "` (whitespace) | `kb_search`, no format | returns a non-empty explicit marker (`(no query)`), NOT an empty string |
| E11 | empty query, json | EP (boundary) | L1 | automated | `query:""` | `format:"json"` | returns `[]` |
| E12 | parent collapse at source | decision-table | L1 | automated | doc with nested headings | `store.search({expandParent:true})` | `hit.parent` has key `headingPath` ONLY — no `root`/`path`/`docType`/`chunkId`/`score`/`snippet` |
| E13 | description is accurate | assertion | L1 | automated | registered `kb_search` tool def | inspect `.description` | does NOT contain the stale `{path, headingPath, score, snippet, akaPaths, parent}` sentence; mentions condensed default + `format` |
| E14 | parent is non-recursive | type-assertion | L1 | automated | narrowed `KbHit` type | `tsc --noEmit` on a `hit.parent.parent` access | compiler error (`@ts-expect-error` holds) |

### Performance

none — the change reduces payload but the spec asserts no latency/throughput/size
threshold, so there is no measurable perf requirement to falsify (forcing one
would invent a threshold).

### Frontend-quirk

none — `kb_search` output is agent-consumed text, not a rendered UI surface; no
WebSocket/convergence behavior.

### Error-handling

covered under edge-case: the only failure path is `format` validation (E3/E4),
which must degrade to condensed rather than throw. No external dependency to
fault-inject (pure in-process rendering over already-fetched hits).

---

## Coverage summary

- Requirements covered: 12/12 testable requirements (the "output not auto-parsed"
  invariant is a codebase constraint verified by regression grep, not a Triple).
- Scenarios by class: edge 14 · perf 0 · frontend 0 · error 0 (folded into edge)
- Scenarios by level: L1 14 · L2 0 · L3 0
- Scenarios by disposition: automated 14 · manual-only 0

## New infra needed

none — all scenarios author into the existing vitest tier
(`packages/kb/src/__tests__/`, `packages/kb-extension/src/__tests__/`).
