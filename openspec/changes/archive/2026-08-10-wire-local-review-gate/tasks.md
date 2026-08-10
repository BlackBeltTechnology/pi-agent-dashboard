## 1. Re-derive every count before sizing the work

- [x] 1.1 Re-derive on the current tree: over-cap `AGENTS.md` files, ASCII-diagram violations under the narrow detector, `qa/tests/*.sh` browser violations, proposals missing `## Discipline Skills`, and the `kb dox lint` issue-kind census. Record the measured values
- [x] 1.2 Confirm the design's stated figures still hold (1 over-cap, 4 ASCII, 0 shell-browser, 34/74, 59 dox issues); update `design.md` D6/D8 if the tree moved

## 2. Repair the broken enforcers before wiring anything

- [x] 2.1 Repair **both** stale paths in `scripts/i18n-parity.mjs` — `lib/i18n.tsx` AND `lib/i18n-hu.ts`, both moved under `lib/i18n/`
- [x] 2.2 Run `node scripts/i18n-lint.mjs --strict`; clear any hits, or fix them here

## 3. Clear the mechanical violations (so the gate lands green)

- [x] 3.1 Convert the ASCII box-drawing diagrams to ```mermaid blocks (delegate `docs/` prose writes to DocScribe, caveman style)
- [x] 3.2 Split the over-cap `AGENTS.md` with `node scripts/split-large-agents.mjs <path> --write`; verify under 30000 bytes
- [x] 3.3 Do NOT migrate any `qa/tests/*.sh` to Playwright — zero real violations; the rule ships as a regression guard only
- [x] 3.4 Do NOT clear the other 58 `kb dox lint` issues — explicitly out of scope

## 4. Implementation — the review-gate decision module (D12)

- [x] 4.1 Create `.pi/skills/ship-it/scripts/review-gate.ts` beside `manifest.ts` / `no-weakening.ts`. It owns the **decisions**; the skill owns the I/O (spawning, timing). Exports: `REVIEW_TIMEOUT_MS = 300_000`, `resolveReviewer`, `classifyFindings`, `reviewRoundDecision`
- [x] 4.2 Add `.pi/skills/ship-it/vitest.config.ts` (include `scripts/__tests__/**/*.test.ts`, node env) and register `.pi/skills/ship-it` in `vitest.config.ts`'s `projects` — without this the helper's tests never execute
- [x] 4.3 Confirm the wiring retro-covers the existing helpers: `manifest.ts` and `no-weakening.ts` are now collectable by `npm test`
- [x] 4.4 Implement a stub reviewer fixture (scripted findings per round) for the adversarial scenarios

## 5. Implementation — `scripts/check-conventions.mjs`

- [x] 5.1 Implement the four rules with the D6 detectors — no new dependency, per-rule reporting, non-zero exit on any gating violation
- [x] 5.2 Implement touched-set resolution behind an explicit `--base <ref>` flag, filtering `--diff-filter=AM`, excluding pure renames. No `--base` → Discipline-Skills reports without gating; mode is never inferred

## 6. Implementation — the dox byte-arm gate

- [x] 6.1 Implement the byte-arm gate as a thin consumer of `kb dox lint --json`, failing only on `over-threshold` / `arm:"bytes"` — filter only, recompute no threshold, no walk, no classification
- [x] 6.2 Do NOT add a `--check` mode to `split-large-agents.mjs`

## 7. Wire step 4.4 into ship-it (NOT into quality:changed)

- [x] 7.1 Add step 4.4 to `.pi/skills/ship-it/SKILL.md`, after the step-3 harness gate and before 4.5: `check-conventions.mjs --base origin/develop`, the byte-arm dox gate, `i18n:lint --strict`, `i18n:parity`
- [x] 7.2 Specify that a 4.4 failure routes to the step-4 fix loop and that step 4.5 does not run

## 8. ship-it step 4.5 — the local review gate

- [x] 8.1 Add step 4.5 to `.pi/skills/ship-it/SKILL.md`, strictly before the step-6 inline `ship-change` drive
- [x] 8.2 Pin the engine contract: an `Agent` spawn with `model: "@review"` carrying `review-code`'s rubric — never an inline self-review, never the CodeRabbit CLI
- [x] 8.3 Specify `@review` as REQUIRED: unconfigured → hard fail naming `update_roles` / the Roles panel and suggesting a `@propose-review-N` seed; no fallback to the session default
- [x] 8.4 Give the required role an onboarding path: document `@review` in setup + a one-time interactive bootstrap on first hard-fail; non-interactive runs keep the hard fail
- [x] 8.5 Specify the reviewer input: change diff + `proposal.md` + task text, diff scoped to the change's own work
- [x] 8.6 Wire step 4.5 to `reviewRoundDecision`; specify the hard two-round cap and per-invocation timeout
- [x] 8.7 Specify severity routing and the `assertNoWeakening` escalation valve
- [x] 8.8 Specify that every halt cause writes `SHIP_IT_BLOCKED.md` and exits non-zero — no new artifact or exit code
- [x] 8.9 Update ship-it Guardrails, Composed skills (`review-code`), and the Mermaid flowchart
- [x] 8.10 Record explicitly that there is no triviality escape

## 9. Spec-posture change for Discipline Skills

- [x] 9.1 Update `AGENTS.md` OpenSpec Conventions: heading required on any touched proposal; when no discipline applies, say so under the heading rather than omitting it
- [x] 9.2 Verify this change's own `proposal.md` carries the heading

## 10. Docs

- [x] 10.1 DocScribe: update `docs/code-quality.md` with the five oracle layers and where each is invoked (note `quality:changed` is a dev-loop oracle with no automated caller)
- [x] 10.2 DocScribe: record the ast-grep negative result with re-derived figures (678 hex, 451 in `lib/theme/` token files); note the originals cited paths deleted by the client reorg
- [x] 10.3 Add directory `AGENTS.md` rows for `scripts/check-conventions.mjs` and the new decision helper

## 11. Automated scenarios (folded from test-plan.md)

All 36 rows are L1. Exemplar for every file below:
`scripts/__tests__/lint-ledger.test.mjs` (drives exported fns directly, cites
`test-plan #<id>`, carries a `See change:` header; fixtures under
`scripts/__tests__/fixtures`). Homes:

| file | rows |
|---|---|
| `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts` | E1–E3, X1, X2, X4–X9 |
| `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts` | E19, E20, F1, F2, P1, X3 |
| `scripts/__tests__/check-conventions.test.mjs` | E4–E8, E10–E15 |
| `scripts/__tests__/dox-byte-gate.test.mjs` | E16–E18 |
| `scripts/__tests__/repo-hygiene.test.mjs` | E9, X10–X13 |

- [x] 11.1 Round-cap lower bound: counter=0 + blocking findings · evaluate decision · decision = `review` (test-plan #E1, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.2 Round-cap second round: counter=1 + blocking findings · evaluate decision · decision = `review` (test-plan #E2, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.3 Round-cap ceiling: counter=2 + blocking findings still present · evaluate decision · decision = `escape-hatch`, never `review` (test-plan #E3, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.4 Mermaid detector positive: md with box-drawing inside a fence, no tree rows · run check · file+line reported, exit non-zero (test-plan #E4, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.5 Mermaid detector negative: md with fenced `├──`/`└──` dir tree · run check · zero violations; README.md + docs/electron-session.md clean (test-plan #E5, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.6 Root-index positive: root AGENTS.md with a file→purpose row table · run check · violation, exit non-zero (test-plan #E6, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.7 Root-index negative: current root AGENTS.md (pointer-only Key Files) · run check · zero violations (test-plan #E7, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.8 Browser-rule negative: current `qa/tests/` · run check · zero violations (WS/health/display-server are not rendered UI) (test-plan #E8, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.9 Reviewer diff scope: 2 own commits + a 2.5 merge of 3 develop commits · compute reviewed diff · only own-commit changes present (test-plan #E9 — blocked on C2, author in `scripts/__tests__/repo-hygiene.test.mjs`)
- [x] 11.10 Touched-set added: new proposal without the heading + `--base` · run check · reported, exit non-zero (test-plan #E10, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.11 Touched-set untouched: pre-existing non-conforming proposal not in diff · run check with `--base` · not reported (test-plan #E11, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.12 Touched-set pure rename: proposal moved, content byte-identical · run check with `--base` · not reported (test-plan #E12, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.13 Touched-set rename+edit: proposal moved AND edited · run check with `--base` · reported (test-plan #E13, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.14 No-`--base` mode: invoked without `--base` · run check · Discipline-Skills reports without gating, other 3 rules still gate (test-plan #E14, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.15 "None apply" proposal: touched proposal whose heading states none apply · run check with `--base` · zero violations (test-plan #E15, author in `scripts/__tests__/check-conventions.test.mjs`)
- [x] 11.16 Dox byte-arm positive: JSON with 1 × `over-threshold`/`arm:"bytes"` · run gate · exit non-zero, names the file (test-plan #E16, author in `scripts/__tests__/dox-byte-gate.test.mjs`)
- [x] 11.17 Dox byte-arm negative: JSON with 58 non-byte issues, 0 byte · run gate · exit 0 (test-plan #E17, author in `scripts/__tests__/dox-byte-gate.test.mjs`)
- [x] 11.18 Dox row-arm not gated: JSON with `over-threshold`/`arm:"rows"` only · run gate · exit 0 (test-plan #E18, author in `scripts/__tests__/dox-byte-gate.test.mjs`)
- [x] 11.19 No triviality escape: ship-it skill text · parse step 4.5 · no diff-size/path/count skip condition present (test-plan #E19, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.20 i18n-lint gating flag: step-4.4 wiring · inspect invocation · `i18n:lint` invoked with `--strict` (test-plan #E20, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.21 Cheap-fail-first: tree with 1 convention violation · run 4.4 · zero reviewer invocations, verdict returned without a model call (test-plan #P1, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.22 Step ordering: ship-it SKILL.md · parse step sequence · 3 → 4.4 → 4.5 → 6, and 4.5 never precedes 4.4 (test-plan #F1, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.23 Composed skills + guardrails: ship-it SKILL.md · parse · names `review-code`; guardrails state the two-round cap + step-5 escape (test-plan #F2, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.24 `@review` required: role unset · resolve reviewer · hard failure naming `update_roles` + seed hint; session default NOT used (test-plan #X1, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.25 Bootstrap non-interactive: role unset, non-interactive · resolve reviewer · hard fail stands, no prompt (test-plan #X2 — blocked on C3, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.26 Reviewer not inline: step 4.5 definition · inspect invocation contract · an `Agent` spawn with `model: "@review"`, never in-context self-review (test-plan #X3, author in `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`)
- [x] 11.27 Reviewer timeout: reviewer stalls past deadline · invoke checkpoint · terminated, timeout reported, no hang (test-plan #X4 — blocked on C1, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.28 Timeout is not a pass: reviewer times out · evaluate verdict · `ship-change` NOT entered (test-plan #X5, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.29 Non-terminating reviewer: stub returning a different blocking finding each round · drive loop · terminates after round 2 via escape hatch, independent of a no-change cycle (test-plan #X6, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.30 Unsatisfiable finding: finding satisfiable only by weakening a test · drive loop · escape hatch; report names finding AND guardrail; guardrail not relaxed (test-plan #X7, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.31 Halt legibility: blocking findings survive round 2 · halt · `SHIP_IT_BLOCKED.md` names findings + attempts, worktree intact, exit non-zero (test-plan #X8, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.32 Non-blocking severities: only suggestion/nit/question/praise · evaluate verdict · proceeds to `ship-change`, findings reported (test-plan #X9, author in `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`)
- [x] 11.33 i18n-parity repair: current tree · run script · exit 0; both `lib/i18n/i18n.tsx` and `lib/i18n/i18n-hu.ts` resolve; `const zhCN` + `huCatalog` anchors found (test-plan #X10, author in `scripts/__tests__/repo-hygiene.test.mjs`)
- [x] 11.34 quality:changed untouched: change diff · inspect package.json · definition byte-identical to pre-change (test-plan #X11, author in `scripts/__tests__/repo-hygiene.test.mjs`)
- [x] 11.35 Splitter untouched: change diff · inspect · `split-large-agents.mjs` unmodified, no new per-file byte threshold anywhere (test-plan #X12, author in `scripts/__tests__/repo-hygiene.test.mjs`)
- [x] 11.36 Gate green on own tree: this change's tree · run all step-4.4 enforcers · every one exits 0 (test-plan #X13, author in `scripts/__tests__/repo-hygiene.test.mjs`)

## 12. Manual verification (deferred post-merge)

- [x] 12.1 Measure the added `ship-it` wall-clock of 4.4+4.5 vs the pre-change path over 3 runs (test-plan: manual-only)
- [x] 12.2 Read the updated ship-it Mermaid flowchart and confirm 4.4 and 4.5 render legibly (test-plan: manual-only)
- [x] 12.3 Run `ship-it` end-to-end on a scratch change with `@review` configured; confirm 4.4 then 4.5 fire in order after the harness (test-plan: manual-only)
- [x] 12.4 Resolve C1 (timeout value), C2 (diff range), C3 (bootstrap once-only semantics) and update the blocked scenarios (test-plan: manual-only)

## 13. Verification

- [x] 13.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; grep the log for the summary line
- [x] 13.2 `node scripts/check-conventions.mjs` exits 0 on the change's own tree
- [x] 13.3 The byte-arm dox gate, `i18n:lint --strict`, and `i18n:parity` all exit 0 on the change's own tree (raw `kb dox lint` still exits 1 on the 58 out-of-scope issues — expected)
