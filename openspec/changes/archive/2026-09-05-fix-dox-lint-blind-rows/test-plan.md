# Test Plan — fix-dox-lint-blind-rows

Stage: design   Generated: 2026-08-28

No clarification markers — every Triple resolved from the spec delta + design
(D1 grammar, D2 scanner/write-paths, D3 gitignore anchoring, D4 coverage).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | spec §row-recognition | decision-table | L1 | automated | AGENTS.md: `# DOX`, then `## Files`, then `| File | Purpose |` table whose row targets a nonexistent path | `doxLint` | ≥1 `orphan` finding for that row path (subheading row IS scanned) |
| E2 | spec §row-recognition | decision-table | L1 | automated | AGENTS.md with `| File | Purpose |` table + orphan row and NO `# DOX` heading anywhere | `doxLint` | `orphan` finding for that row (no-heading file IS scanned) |
| E3 | spec §row-recognition (Defect B) | decision-table | L1 | automated | AGENTS.md: `# DOX` + file table with a real row, then `## Subagent Routing` + `| Agent | Use |` + `` | `Explore` | search | `` (no such file) | `doxLint` | zero findings mention `Explore`; the real file row IS recognized (orphan/stale evaluated) |
| E4 | design D1 adjacency | decision-table | L1 | automated | file table immediately followed (no blank line) by `` | Subagent | Use for | `` + its own `|---|` delimiter + backticked row | `doxLint` | prose row NOT recognized (no orphan for it); second delimiter closed the file table |
| E5 | design D1 loss mode | decision-table | L1 | automated | file table, then blank line, then row-shaped line outside the table (quota-plugin shape) | `scanDoxRows` | loose row NOT in rows[] (documents the loss mode; migration removes the real instance) |
| E6 | spec §coverage | boundary | L1 | automated | AGENTS.md with `| File | Purpose |` + `|---|---|` and zero body rows | `doxLint` | exactly one `zero-row-table` finding naming that file; `detail` contains the header's line number |
| E7 | design D1 grammar | equivalence | L1 | automated | header written `|  File  |  Purpose  |` (whitespace-flexible, trailing pipe present) | `scanDoxRows` | table opens; its rows are recognized |
| E8 | design D1 grammar | equivalence | L1 | automated | header written `| FILE | PURPOSE |` (uppercase) | `scanDoxRows` | table NOT recognized as file-row table (case-sensitive) |
| E9 | design D1 grammar | equivalence | L1 | automated | header written `| Path | Purpose |` | `scanDoxRows` | table NOT recognized (no synonym) |
| E10 | spec §coverage | boundary | L1 | automated | fixture tree: 2 AGENTS.md files, 4 recognized rows total (1 sidecar-pointer row included) | `doxLint` | `filesScanned === 2`, `rowsScanned === 4`; `--json` output carries both fields; CLI text mode prints a coverage line containing `2` files and `4` rows |
| E11 | spec §arms-parity (stale) | state-transition | L1 | automated | subheading-table row whose staleness sidecar sha ≠ file sha | `doxLint` with stalenessFile | `stale` finding for that row (stale arm sees subheading rows) |
| E12 | spec §arms-parity (broken-ref) | state-transition | L1 | automated | subheading-table row whose purpose cell cites a nonexistent `missing-ref.md` | `doxLint` | `broken-ref` finding for `missing-ref.md` (ref arm sees subheading rows) |
| E13 | spec §gitignore (negation) | decision-table | L1 | automated | nested `.gitignore`: `skills/openspec-*/**` + `!skills/openspec-shared/**`; md in `skills/openspec-shared/` (un-rowed) and md in `skills/openspec-alpha/` | `doxLint` | `missing` finding FIRES for the negated (tracked) md; NO `missing` for the ignored md (both negation forms keep tracked coverage) |
| E14 | spec §gitwalk + design D3 anchoring | decision-table | L1 | automated | root `.gitignore` with anchored dir pattern; `indexSource` with nested `src.dir`; then `respectGitignore: false` | indexer walk | gitignored files absent from walk results with the filter on; present with it off (root-anchored patterns apply from nested walk root; opt-out works) |
| E15 | design D3 deeper-override | decision-table | L1 | automated | root `.gitignore` ignores `vendored/`; nested `vendored/.gitignore` negates `!keep.md`; md files `vendored/keep.md` + `vendored/other.md` | `doxLint` | `missing` fires for `keep.md`, not for `other.md` (deeper file overrides shallower) |
| E16 | design D3 matcher forms | decision-table | L1 | automated | pattern-form table: bare `*` + file negation; leading `**/node_modules`; mid-name `rows*.jsonl`; leading-slash `/package-lock.json`; case-sensitivity pair (`Out/` vs `out/`) | matcher predicate per (pattern, relPath) pair | every table cell matches git semantics (true/false as specified); malformed line (`[abc`) is skipped without throwing |
| E17 | design D2 --fix golden | state-transition | L1 | automated | AGENTS.md with orphan row + valid subheading-table row + prose table | `doxLint({fix:true})` | orphan line pruned; ALL other lines byte-identical to input |
| E18 | design D2 --fix convergence | state-transition | L1 | automated | AGENTS.md with file table + an md file with no row | `doxLint({fix:true})` then `doxLint` again | appended row sits INSIDE the table (or header+delimiter created at EOF); second run reports zero `missing` for that file; no duplicate rows |
| E19 | design D2 doxInit idempotence | state-transition | L1 | automated | scratch tree; `doxInit` run twice | second `doxInit` | `plan.appended` empty on second run; file contains exactly one `| File | Purpose |` header + delimiter; `parseRowPaths` non-empty after first run |
| E20 | design D2 doxInit template | boundary | L1 | automated | scratch tree; `doxInit` creates a new AGENTS.md | inspect created file | template contains `| File | Purpose |` header + `|---|` delimiter; its rows are recognized by `scanDoxRows` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | spec §gitwalk | fault-injection | L1 | automated | no `.git`, no `.gitignore` anywhere in fixture dir | `doxLint` | no throw; predicate ignores nothing; non-rowed md still yields `missing` (graceful degrade) |
| X2 | design D3 robustness | fault-injection | L1 | automated | `.gitignore` containing a malformed pattern line (`[abc`) beside a valid one | matcher build + `doxLint` | no throw; valid pattern still applies; malformed line skipped |

## Coverage summary

- Requirements covered: 3/3 (row recognition 5 scenarios + grammar 3 + arms parity 2; gitignore 5 + matcher forms 1; coverage 2) plus write-path invariants 4 (--fix ×2, doxInit ×2) and robustness 2
- Scenarios by class: edge 20 · perf 0 · frontend 0 · error 2
- Scenarios by level: L1 22 · L2 0 · L3 0
- Scenarios by disposition: automated 22 · manual-only 0
- Performance: no latency/throughput requirement exists in the spec — no rows (a threshold would be a spec gap; none was found)

## New infra needed

- none — all rows land in the existing L1 vitest tier (`packages/kb/src/__tests__/`; gitignore matcher tests may use a new `gitignore.test.ts` sibling file, same harness)
