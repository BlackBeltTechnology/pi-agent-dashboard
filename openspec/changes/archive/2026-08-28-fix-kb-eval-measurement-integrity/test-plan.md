# Test Plan — fix-kb-eval-measurement-integrity

Stage: design   Generated: 2026-08-28

No clarification markers — the design resolved the open questions (fixture shapes,
unreachable semantics, guard contract); every Triple slot is concrete.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 eval=tool options | equivalence (behavioural parity) | L1 | automated | resolved default config + sources | `searchOptsFromConfig` with extension overrides `{expandGraph:false, rerank:false}` | output deep-equals the exact option object `extension.ts:95` passes today, field-by-field (all 12 keys) |
| E2 | R1 shared helper | decision table | L1 | automated | all-knobs-flipped config; each CLI flag one at a time (`--no-source-dedup`, `--no-lane-quota`, `--no-coverage-rerank`, `--no-expand-parent`, `--expand-parent`, `--expand-query`, `--expand-graph`, `--rerank`) | helper called with each override | exactly the overridden field changes value; the other 11 stay at config values; eval path (extension overrides) ignores CLI-only flags |
| E3 | R1 no-drift invariant | structural key-coverage | L1 | automated | the canonical ranking-key list (fieldWeights, proximityBoost, diversity, sourceDedup, laneQuota, coverageRerank, queryExpansion, prf, expandParent, expandGraph, rerank, rootPriority) | assert `Object.keys(helper(cfg, src))` | covers every canonical key — a new SearchOpts ranking field unmapped by the helper fails this test |
| E4 | R2 fixture shapes | equivalence partitioning | L1 | automated | bare array file; `{items:[...]}` object file (bundled `golden.source-intent.json` shape) | `loadGolden` | both return the item array; provenance header (`intent`, `minedAt`) goes to stderr, stdout untouched |
| E5 | R2 malformed rejection | negative partition | L1 | automated | a JSON string, `{}`, `{items:"x"}`, and the real `eval/golden.provenance.json` | `loadGolden` | each throws naming BOTH accepted shapes + the file path |
| E6 | R2 item validation | negative partition | L1 | automated | `{items:[{q:1,expect:"a"}]}`, item missing `expect` | `loadGolden` | throws with file name + array index (today: silent zero via `includes("undefined")`) |
| E7 | R3 root normalization | spec scenario | L1 | automated | roots `[{relPrefix:"packages"}]`; expect `packages/foo/AGENTS.md`; indexed path `foo/AGENTS.md` | score with stripped candidate | first-hit rank 1 recorded (spec scenario verbatim) |
| E8 | R3 separator boundary | BVA (boundary) | L1 | automated | roots `[{relPrefix:"packages"}]`; expect `packages-x/foo.md` | strip attempt | prefix NOT stripped (`packages` + separator check); raw candidate still matched — item scored, not unreachable |
| E9 | R3 longest prefix | BVA (nested roots) | L1 | automated | roots `[{relPrefix:"packages"},{relPrefix:"packages/client"}]`; expect `packages/client/src/a.md` | strip | strips against `packages/client` → candidate `src/a.md`, not `client/src/a.md` |
| E10 | R3 reachability | decision table | L1 | automated | expects: `faq.md`, `changes/specs/x.md`, `tests/foo.md`, `Documents/Projektek/a.md`, root with `relPrefix:""` | classify each | bare → scored; `changes` (top-level entry of openspec root) → scored; `tests`, `Documents` → unreachable; empty-relPrefix root → only rule (b) can mark unreachable. Unreachable: excluded from all 5 rank metrics AND `distinctSourcesAtK`/`duplicateSlotShare`/`singleSourcePageRate`/`avgLatencyMs`; `n + unreachable === total`; no search call made for them |
| E11 | R3 no-shrink invariant | regression equivalence | L1 | automated | real `golden.markdown-intent.json` (108 items) + mock store with known paths | new matcher vs old `path.includes(expect)` matcher, reachable items only | identical first-hit ranks for all reachable items (104/4 classification: 60 strippable + 32 root-relative + 12 bare reachable) |
| E12 | R5 fingerprint determinism | equivalence + BVA | L1 | automated | same tree hashed twice; file with CRLF vs LF; same files in different order; edited `tsconfig.json` | shared fingerprint lib recompute | identical hash for identical/LF-normalized/reordered input; different hash after tsconfig or src change |
| E13 | R5 bin shim branch table | decision table | L1 | automated | sandbox package dir: (a) all hashes match; (b) srcHash mismatch + tsconfig resolvable; (c) mismatch, no tsconfig; (d) `dist/cli.js` missing, no tsconfig | spawn `bin/kb.mjs` per branch | (a) imports dist, exit 0, silent; (b) rebuilds (dist mtime advances), imports, exit 0; (c) stderr warning, imports stale dist, exit 0; (d) non-zero exit naming the divergence |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R4 vacuous guard | fault-injection (empty set) | L1 | automated | fixture with `items: []`; fixture where every item is unreachable (fictional-corpus shape) | `kb eval` run | diagnostic on stderr naming fixture shape + root normalization; metrics JSON still on stdout; exit non-zero; `--allow-zero` → exit 0 with metrics |
| X2 | R4 zero recall | fault-injection (degenerate result) | L1 | automated | store mocked to return zero hits; n>0 fixture | `kb eval` run | exit non-zero with same diagnostic class; `--allow-zero` → exit 0, `Recall@K: 0` printed |

### Packaging / workflow (ci level)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | R5 stale dist rejected | fault-injection | ci | automated | checkout where `src` edited after last build (committed fingerprint stale) | `node scripts/check-kb-dist-fresh.mjs` (ci.yml step) | non-zero exit printing "the `kb` bin and the extension would run different engines"; clean tree → exit 0 |
| C2 | R5 packaging completeness | packaging assertion | ci | automated | `npm pack --dry-run` of `packages/kb` | parse tarball listing | contains `bin/kb.mjs`, `engine-fingerprint.json`, `dist/cli.js`, `src/`; no `__tests__` |

## Coverage summary

- Requirements covered: 5/5 (R1: E1-E3 · R2: E4-E6 · R3: E7-E11 · R4: X1-X2 · R5: E12-E13, C1-C2)
- Scenarios by class: edge 13 · error 2 · ci 2
- Scenarios by level: L1 15 · ci 2
- Scenarios by disposition: automated 17 · manual-only 0

## New infra needed

- none — L1 uses existing vitest setups (`packages/kb/src/__tests__/` runs with `NODE_OPTIONS=--experimental-sqlite`; sandbox dirs via `fs` fixtures), ci rows follow the existing `node scripts/*.mjs` step pattern in `.github/workflows/ci.yml` (exemplar: `verify-published-imports.mjs`).
