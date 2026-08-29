# Test Plan — fix-kb-search-lane-composition

Stage: design   Generated: 2026-08-28

No clarification gaps: every Triple resolves from the spec delta + design (D1–D6). HARD gate passes with zero open questions.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 schema-discoverable | decision-table | L1 | automated | registered `kb_search` tool schema | inspect `params.doc_type.description` | non-empty string that names both lanes (contains `agents` AND an unset/default-lane hint) and does not unconditionally recommend one value |
| E2 | R1 guideline | decision-table | L1 | automated | `promptGuidelines` array | scan entries for `doc_type` guidance | ≥1 entry states file/symbol → `agents` and conceptual/how-does-X → leave unset (both halves present) |
| E3 | R2/D3 config gate | BVA | L1 | automated | `ranking.laneLeadMargin` values `-0.1, 0, 1, 1.1, "x"` | `validateConfig`/`loadConfig` | `-0.1`, `1.1`, `"x"` rejected with the laneQuota-style error; `0` and `1` accepted |
| E4 | R2 disabled ⇒ as-before | equivalence (gate off) | L1 | automated | seeded corpus fixture; margin `0` | `store.search` vs pre-change interleaving snapshot | identical path order, scores, and hit count (ordering byte-identity; rendered text may differ via D5 marks) |
| E5 | R2 competitive lead | equivalence (gate on, fires) | L1 | automated | fixture where best `agents` score is within margin of best main score; margin `0.2` | `store.search` | `hits[0].docType === "agents"`, and under source dedup the led source appears exactly once |
| E6 | R2 non-competitive stays | equivalence (gate on, no-fire) | L1 | automated | fixture where best `agents` score trails beyond margin; margin `0.2` | `store.search` | `hits[0].docType === "doc"`; page order identical to margin `0` |
| E7 | R2 explicit doc_type wins | decision-table | L1 | automated | `doc_type: "agents"` with margin `0` vs `0.5` | two searches, same query | hit lists identical (laneShare `0` ⇒ `interleaveLanes`, and the lead rule, never runs) |
| E8 | D3 laneQuota=0 coupling | decision-table | L1 | automated | `laneQuota: 0` with margin `0` vs `0.5` | two searches, same query | hit lists identical (no reserved lane ⇒ knob inert, documented) |
| E9 | D2 raw-score comparison | state/decision | L1 | automated | `diversity.enabled` + `coverageRerank: true`; corpus case where coverage re-sort moves the main head | `store.search` with margin `0.2` | slot-1 decision matches the raw BM25(+proximity) best-score comparison, not the re-sorted head |
| E10 | D1 lead bookkeeping | state-transition | L1 | automated | lead fires at `laneQuota: 0.5`, source dedup on | inspect page after lead pick | slot 2 comes from the main lane (running share `2/2 = 1 > 0.5`); led source not duplicated |
| E11 | D2 endpoint semantics | BVA (degenerate endpoint) | L1 | automated | all-negative-score corpus; margin `1.0` | `store.search` | reserved lane leads unconditionally (documented degenerate; pins endpoint behaviour) |
| E12 | D5 record-type marks | decision-table | L1 | automated | `renderHits` with `agents`, `source-md`, `doc` hits incl. `(+N dup)`/`(+N more sections)` | render condensed + CLI forms | `[agents]`/`[source-md]` marks present on non-doc hits, `doc` unmarked, marks compose with existing marks; CLI exact-string expectations updated |
| E13 | R3 paired-fixture reporting | invariant | L1 | automated | sweep report builder with margin grid | build rows | every margin row carries BOTH source-intent and markdown-intent metric groups; a row missing one fixture is a harness error, never a silent cell |

### Manual verification

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | R3 default selection | judgment on evidence | — | manual-only | `measurements.md` paired sweep table | apply the D6 bar (+0.03 / −0.01, smallest clearing margin) | recorded default decision with rationale; `ship-change` defers if post-merge |
| M2 | D4 deployed surface | runtime spot-check | — | manual-only | rebuilt extension after `npm run reload` | inspect the live `kb_search` schema | `doc_type` description shows the new trade-off wording (investigate the second registration path if not) |

## Coverage summary

- Requirements covered: 3/3 (R1: E1–E2 · R2: E3–E11 · R3: E13, M1)
- Scenarios by class: edge 13 · perf 0 · frontend 0 · error 0 (config-validation errors land in E3; the change adds no async/network/fault surface and no perf requirement — the lead rule is an O(1) comparison)
- Scenarios by level: L1 13 · L2 0 · L3 0 (pure engine logic + text renderer; no rendered-UI assertions exist in this change)
- Scenarios by disposition: automated 13 · manual-only 2

## New infra needed

- none (all automated rows land in existing `packages/kb/src/__tests__/` vitest tier; E13 reuses `run-fixtures.ts` logic)
