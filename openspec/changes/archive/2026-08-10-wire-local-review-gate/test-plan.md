# Test Plan — wire-local-review-gate

Stage: apply   Generated: 2026-08-10

## ✅ Clarifications resolved (4/4)

- [x] **C1** — Reviewer timeout = **300s** per invocation (D10).
- [x] **C2** — Reviewed diff = **`git diff origin/develop...HEAD`** (three-dot,
  merge-base) plus uncommitted working-tree edits.
- [x] **C3** — The `@review` bootstrap prompt fires on **every interactive
  hard-fail**, no persisted state; it is self-extinguishing because accepting it
  removes the hard-fail.
- [x] **C4** — RESOLVED: extract a pure `reviewRoundDecision(state) → review |
  fix | escape` helper into `scripts/`, per the `scripts/manifest.ts` /
  `scripts/no-weakening.ts` precedent, so the two-round cap is unit-testable.
  Recorded as design decision **D12**. E1–E3 and X6 stay `automated`.

> Resolve before the blocked scenarios can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | two-round cap | BVA | L1 | automated | round counter = 0, blocking findings present | evaluate round decision | decision = `review` (round 1 runs) |
| E2 | two-round cap | BVA | L1 | automated | round counter = 1, blocking findings present | evaluate round decision | decision = `review` (round 2 runs) |
| E3 | two-round cap | BVA | L1 | automated | round counter = 2, blocking findings still present | evaluate round decision | decision = `escape-hatch`; never `review` |
| E4 | Mermaid detector | EP | L1 | automated | md file: box-drawing chars inside a ```fence, no `├──` rows | run `check-conventions.mjs` | rule reports the file+line; exit non-zero |
| E5 | Mermaid detector — negative | EP | L1 | automated | md file: fenced dir tree using `├──`/`└──`/leading `│` | run `check-conventions.mjs` | zero violations; `README.md` + `docs/electron-session.md` clean |
| E6 | root-index detector | decision-table | L1 | automated | root `AGENTS.md` with a table of \`file\` → purpose rows | run `check-conventions.mjs` | violation reported; exit non-zero |
| E7 | root-index detector — negative | decision-table | L1 | automated | current root `AGENTS.md` (`## Key Files` = pointer prose only) | run `check-conventions.mjs` | zero violations |
| E8 | browser-scenario detector | EP | L1 | automated | `qa/tests/` as it stands (03-websocket.sh, 04-ws-ticket-auth.sh, 10-faux-model.sh) | run `check-conventions.mjs` | zero violations — WS/health/display-server are not rendered-UI |
| E9 | reviewer diff scope | state-transition | L1 | automated | worktree with 2 own commits + a 2.5 merge of 3 develop commits | compute `git diff origin/develop...HEAD` | diff contains only the 2 own commits' changes; none of the 3 merged develop commits |
| E10 | touched-set: added | EP | L1 | automated | new `proposal.md` without `## Discipline Skills`, `--base <ref>` | run check | file reported; exit non-zero |
| E11 | touched-set: untouched | EP | L1 | automated | pre-existing non-conforming `proposal.md`, not in diff | run check with `--base` | not reported; rule contributes exit 0 |
| E12 | touched-set: pure rename | EP | L1 | automated | non-conforming `proposal.md` moved, content byte-identical | run check with `--base` | not reported (filtered as `R`) |
| E13 | touched-set: rename + edit | EP | L1 | automated | non-conforming `proposal.md` moved AND content edited | run check with `--base` | reported (content-modified, not a pure rename) |
| E14 | no-`--base` mode | decision-table | L1 | automated | repo tree, invoked without `--base` | run check | Discipline-Skills rule reports without gating; other 3 rules still gate |
| E15 | "none apply" proposal | EP | L1 | automated | touched `proposal.md` carrying `## Discipline Skills` stating none apply | run check with `--base` | zero violations |
| E16 | dox byte-arm filter | decision-table | L1 | automated | `kb dox lint --json` output with 1 × `over-threshold`/`arm:"bytes"` | run byte-arm gate | exit non-zero, names the file |
| E17 | dox byte-arm filter — negative | decision-table | L1 | automated | JSON with only `missing`, `missing-companion`, `broken-ref`, `orphan` (58 rows, 0 byte) | run byte-arm gate | exit 0 |
| E18 | dox row-arm not gated | decision-table | L1 | automated | JSON with `over-threshold` / `arm:"rows"` only | run byte-arm gate | exit 0 |
| E19 | no triviality escape | EP | L1 | automated | `ship-it` skill text | parse step 4.5 | no diff-size/path/changed-count skip condition present |
| E20 | i18n-lint gating flag | EP | L1 | automated | wiring definition for step 4.4 | inspect invocation | `i18n:lint` is invoked with `--strict` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | 4.4 precedes 4.5 (cheap-fail-first) | threshold | L1 | automated | tree with 1 convention violation | zero reviewer invocations occur; enforcer verdict returned without a model call | single run |
| P2 | added ship-it cost | tail-latency | — | manual-only | a real `ship-it` run with `@review` configured | added wall-clock of 4.4+4.5 vs the pre-change path | 3 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | step ordering | state-transition | L1 | automated | `.pi/skills/ship-it/SKILL.md` | parse step sequence | 3 (harness) → 4.4 → 4.5 → 6 (ship-change); 4.5 never precedes 4.4 |
| F2 | composed-skills + guardrails | state-transition | L1 | automated | ship-it SKILL.md | parse | Composed-skills names `review-code`; Guardrails state the two-round cap + step-5 escape |
| F3 | flowchart updated | visual/subjective | — | manual-only | ship-it Mermaid diagram | human reads | 4.4 and 4.5 render legibly in the flow |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | `@review` required | fault-injection (missing config) | L1 | automated | `@review` unset in the role map | resolve reviewer | hard failure; error names `update_roles` + `@propose-review-N` seed; session default model NOT used |
| X2 | bootstrap onboarding | fault-injection (missing config) | L1 | automated | `@review` unset, non-interactive run | resolve reviewer | hard fail stands, no prompt emitted, no persisted "asked" state written |
| X3 | reviewer is not inline | fault-injection | L1 | automated | step 4.5 definition | inspect invocation contract | an `Agent` spawn with `model: "@review"`; never an in-context self-review |
| X4 | reviewer timeout | fault-injection (delay) | L1 | automated | reviewer stalls past 300s | invoke checkpoint | invocation terminated at the 300s deadline, timeout reported as a checkpoint failure, run does not hang |
| X5 | timeout is not a pass | fault-injection (delay) | L1 | automated | reviewer times out | evaluate gate verdict | `ship-change` is NOT entered; verdict ≠ pass |
| X6 | non-terminating reviewer | fault-injection (adversarial) | L1 | automated | stub reviewer returning a *different* blocking finding every round | drive the review loop | terminates after round 2; escape hatch taken; not dependent on a no-change cycle |
| X7 | unsatisfiable finding | fault-injection | L1 | automated | blocking finding satisfiable only by weakening a test; `assertNoWeakening` rejects every candidate | drive the loop | escape hatch; report names BOTH the finding and the guardrail; guardrail not relaxed |
| X8 | halt legibility | fault-injection | L1 | automated | blocking findings survive round 2 | halt | `SHIP_IT_BLOCKED.md` written naming findings + attempts; worktree intact; exit non-zero |
| X9 | non-blocking severities | decision-table | L1 | automated | reviewer returns only `suggestion`/`nit`/`question`/`praise` | evaluate verdict | proceeds to `ship-change`; findings reported |
| X10 | i18n-parity repair | fault-injection (stale path) | L1 | automated | current tree | run `i18n-parity.mjs` | exit 0; BOTH `lib/i18n/i18n.tsx` and `lib/i18n/i18n-hu.ts` resolve; `const zhCN` + `huCatalog` anchors found |
| X11 | quality:changed untouched | regression | L1 | automated | change diff | inspect `package.json` | `quality:changed` definition byte-identical to pre-change |
| X12 | splitter untouched | regression | L1 | automated | change diff | inspect | `scripts/split-large-agents.mjs` unmodified; no new per-file byte threshold anywhere |
| X13 | gate green on own tree | regression | L1 | automated | this change's own tree | run all step-4.4 enforcers | every one exits 0 |
| X14 | full ship-it path | state-transition | — | manual-only | scratch change, `@review` configured | run `ship-it` end-to-end | 4.4 then 4.5 fire in order after the harness; ship completes |

---

## Coverage summary

- Requirements covered: 24/24 spec requirements have ≥1 scenario
- Scenarios by class: edge 20 · perf 2 · frontend 3 · error 14
- Scenarios by level: L1 36 · L2 0 · L3 0 · — 3
- Scenarios by disposition: automated 36 · manual-only 3 (P2, F3, X14)

Note the level distribution: this change ships **no runtime UI and no server
path**, so there is nothing for L2/L3 to assert. Its surface is scripts +
skill-document contracts, which is L1 territory (`scripts/__tests__/*.test.mjs`
is the established home). A plan that manufactured L3 rows here would be
theatre.

## New infra needed

- **A testable seam for the review-round bound (C4, resolved → D12).** The
  two-round cap is the invariant this change exists to guarantee, and as Markdown
  prose it is unverifiable. `ship-it` already has the placement pattern:
  `.pi/skills/ship-it/scripts/manifest.ts` (`deferDecision`) and
  `no-weakening.ts` (`assertNoWeakening`) are pure decision helpers the skill
  consults. **But they are covered by zero tests** — `vitest.config.ts` lists only
  `packages/*` and `scripts/`, so nothing under `.pi/skills/` is collected. The
  bound lands beside them as `reviewRoundDecision`, **and `.pi/skills/ship-it`
  joins the vitest project list**, which retro-covers the two existing helpers.
- **A stub reviewer** for X6/X7 (a fake returning scripted findings per round).
  No such fixture exists; it is small and belongs beside the helper above.
- No new harness, no new level, no new dependency.
