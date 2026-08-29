## 1. Failing tests — scenarios folded from test-plan.md (red first)

Every task: vitest L1, harness exemplar `packages/kb/src/__tests__/kb.test.ts` (tmp-dir fixture harness) unless another path is named.

- [ ] 1.1 (test-plan #E1) Subheading row IS scanned: AGENTS.md `# DOX` → `## Files` → File|Purpose table with orphan row → doxLint yields `orphan` for it
- [ ] 1.2 (test-plan #E2) No-heading file IS scanned: File|Purpose table + orphan row, no `# DOX` → `orphan` fires
- [ ] 1.3 (test-plan #E3) Defect B pin, strengthened: `# DOX` + real file row + `## Subagent Routing` `| Agent | Use |` table → zero findings mention `Explore`, real row still recognized
- [ ] 1.4 (test-plan #E4) Adjacency: prose table (own `|---|`) butted directly under the file table → prose row NOT recognized
- [ ] 1.5 (test-plan #E5) Loose row (blank line splits table, quota-plugin shape) → NOT in scanDoxRows().rows
- [ ] 1.6 (test-plan #E6) Zero-row table → one `zero-row-table` finding naming the file, header line number in detail
- [ ] 1.7 (test-plan #E10) Coverage: 2 AGENTS.md / 4 rows fixture → `filesScanned===2`, `rowsScanned===4`; `--json` carries fields; CLI text prints coverage line (exemplar: `packages/kb/src/__tests__/dox-source-coverage.test.ts`)
- [ ] 1.8 (test-plan #E7) Whitespace-flex header (`|  File  |  Purpose  |`) → recognized
- [ ] 1.9 (test-plan #E8) Uppercase header (`| FILE | PURPOSE |`) → NOT recognized (case-sensitive)
- [ ] 1.10 (test-plan #E9) `| Path | Purpose |` header → NOT recognized (no synonym)
- [ ] 1.11 (test-plan #E11) Stale-arm parity: subheading-table row with sidecar sha drift → `stale` fires
- [ ] 1.12 (test-plan #E12) Broken-ref parity: subheading-table row citing `missing-ref.md` → `broken-ref` fires
- [ ] 1.13 (test-plan #E13) Negation both forms: `skills/openspec-*/**` + `!skills/openspec-shared/**` → `missing` fires for tracked negated md, not for ignored md
- [ ] 1.14 (test-plan #E14) Indexer anchoring + opt-out: root-anchored pattern applies from nested src.dir; `respectGitignore: false` keeps files (exemplar: existing indexer coverage in `packages/kb/src/__tests__/`)
- [ ] 1.15 (test-plan #E15) Deeper override: root ignores `vendored/`, nested `!keep.md` → `missing` fires for keep.md only
- [ ] 1.16 (test-plan #E16) Matcher forms decision table: bare `*`+negation, `**/node_modules`, `rows*.jsonl`, `/package-lock.json`, case pair, malformed `[abc` skipped (new `packages/kb/src/__tests__/gitignore.test.ts`, exemplar: sibling kb vitest file)
- [ ] 1.17 (test-plan #E17) `--fix` golden: orphan line pruned, ALL other lines byte-identical
- [ ] 1.18 (test-plan #E18) `--fix` convergence: appended row lands inside the table (header+delimiter created at EOF when absent); second run reports zero `missing`, no duplicates
- [ ] 1.19 (test-plan #E19) `doxInit` idempotence: second run appends nothing; one header+delimiter; `parseRowPaths` non-empty
- [ ] 1.20 (test-plan #E20) `doxInit` template: created file carries `| File | Purpose |` + `|---|`; rows recognized by scanDoxRows
- [ ] 1.21 (test-plan #X1) No .git / no .gitignore fixture → no throw, predicate ignores nothing, `missing` still fires (graceful degrade)
- [ ] 1.22 (test-plan #X2) Malformed `.gitignore` line (`[abc`) → no throw, valid pattern still applies

## 2. Shared scanner + write paths (design D1/D2)

- [ ] 2.1 Implement `scanDoxRows(text)` in `packages/kb/src/dox.ts`: header `/^\|\s*File\s*\|\s*Purpose\s*\|\s*$/`, open on header, close on first non-`|` line OR second `|---|` delimiter, rows via `/^\|\s*`([^`]+)`\s*\|/`, return `{ rows: {path,line,lineIndex}[], emptyFileTables: {line}[] }`
- [ ] 2.2 Rewire `parseRowPaths`, `countInlineRows`, and `doxLint` onto `scanDoxRows`; keep `parseRowPaths` signature and sidecar-pointer inclusion unchanged (sole cross-package consumer: `kb-extension/src/reindex.ts`); rebuild `--fix` output from pruned `lineIndex` set
- [ ] 2.3 One shared table-aware row-append helper used by `--fix`'s missing-arm AND `doxInit` (create-template gains header+delimiter; append inserts after the file-table's last row, never a leading blank line); restores `doxInit` idempotence
- [ ] 2.4 Add `zero-row-table` to the `DoxIssue` kind union; add `filesScanned`/`rowsScanned` to `DoxLintResult`
- [ ] 2.5 Rewrite existing heading-state fixtures: 17 `# DOX` fixture sites in `kb.test.ts` (none has a table header; E2/E4/E7/E8/E9/X1 among them) AND `dox-source-coverage.test.ts`'s `| FILE | PURPOSE |` uppercase helper → `| File | Purpose |`

## 3. Gitignore-honouring walks (design D3)

- [ ] 3.1 Create `packages/kb/src/gitignore.ts`: matcher covering bare names, `dir/`, `*.ext`, mid-name globs, mid-pattern `**` + chained + leading-`**/`, bare `*` + file negations, `!` negation (dir + content forms, root-level file negation), leading-slash anchors; last-match-wins per file, deeper file overrides shallower, case-SENSITIVE
- [ ] 3.2 Seed the pattern stack from the REPO ROOT: up-walk from the walk start collecting `.gitignore` files (boundary: `.git` or cwd), then descend; conservative dir-pruning (prune only on dir-matching pattern, else filter files at match time)
- [ ] 3.3 Thread the predicate through `walkFiles` so `walkMd`, `walkSource`, `walkAgents` (lint + `dox init` + missing/companion arms) honour `.gitignore`; keep dox.ts `DEFAULT_EXCLUDE`
- [ ] 3.4 Wire the same repo-root-seeded predicate into `packages/kb/src/indexer.ts` `walk`, gated on the existing `respectGitignore` config default (opt-out preserved); leave indexer `DEFAULT_EXCLUDE` untouched

## 4. CLI + docs + file fixes

- [ ] 4.1 `kb dox lint` (`packages/kb/src/cli.ts`): print coverage line in text mode (`N files, M rows scanned, K findings`); confirm `--json` carries new fields
- [ ] 4.2 Fix the loose row: remove the blank line splitting the table in `packages/quota-plugin/src/AGENTS.md` (row `__tests__/dialog.test.tsx` rejoins the table) — NO edit to `pi-flows/AGENTS.md` (untracked vendored tree; `Path | Purpose` stays, unlinted by design)
- [ ] 4.3 Root `AGENTS.md` doctrine row: file-table header MUST be `| File | Purpose |` (route prose per Documentation Update Protocol; ≤200 chars)
- [ ] 4.4 Rewrite the standing contract in `.pi/skills/AGENTS.md` ("Deliberately undocumented … that finding is expected") once the 16 bogus findings are gone — gitignore is now honoured, the finding no longer fires

## 5. Backlog audit + verification

- [ ] 5.1 Census gate: (a) first-table headers ≠ `| File | Purpose |` across walked AGENTS.md files (expect only the 3 known prose tables); (b) loose row-shaped lines outside any table (expect none after 4.2)
- [ ] 5.2 Run `kb dox lint` repo-wide (baseline today: 67 findings); audit the 90 newly visible rows (pi-forms-bpmn 19, cost-estimator 14, bus-client 29, shell 15, server/src/attachments 8, server/src/tunnel-providers 5) + the ~51 pre-existing findings — author purposes / prune true orphans — to zero
- [ ] 5.3 Confirm the 16 bogus `missing` findings are gone (`.pi/prompts/opsx-*`, `.pi/skills/openspec-*`) and `.pi/skills/openspec-shared` files remain covered; confirm indexer next-run `deleted` churn ≈ 100 distinct indexed paths (179 gitignored md on disk under `packages/electron/**` + 16 in `.pi`, post-dedup) and nothing else
- [ ] 5.4 Full verification: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` + summary grep; lint green WITH coverage line
