# Test Plan — tune-reverse-spec-for-rebuild-eval

Stage: design   Generated: 2026-10-04

L1 = `packages/eng-disciplines/src/__tests__/*.test.ts` (vitest), exercising
`S/scripts/guard.mjs` via the `guard()` helper in `src/__tests__/files.ts`
(`S = packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild`).
LLM-pipeline behaviour (does the generator/merge/auditor actually follow the new
text) has no deterministic observable outside the judged eval; those rows are
`manual-only` and map to the `score.md` judge procedure, as in the parent change's
M-series.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Per-claim provenance — multi-location confirmed rejected | BVA (location count 1 / 2) | L1 | automated | spec.md with `<!-- cite: ref=src/a.ts:1, confidence=confirmed -->` (1 location) and another file with `ref=src/a.ts:1; src/b.ts:2-4, confidence=confirmed` (2) | `guard.mjs lint-cite <file>` | 1-location file → exit 0, empty stdout; 2-location file → exit 1, stdout names `<file>:<line>` of that cite |
| E2 | Per-claim provenance — non-standard separator | EP (separator class `;` / `,` / ` and `) | L1 | automated | three md cites, `confirmed`, refs `a.ts:1; b.ts:2`, `a.ts:1, b.ts:2`, `a.ts:1 and b.ts:2` | `lint-cite` | exit 1; three findings, one per line |
| E3 | Per-claim provenance — cap applies only to confirmed | decision table (confidence × location count) | L1 | automated | 2-location cites tagged `inferred` and `assumed`; 1-location `confirmed` | `lint-cite` | exit 0, no findings |
| E4 | Per-claim provenance — key order / indentation | EP | L1 | automated | indented (`  <!-- cite: confidence=confirmed, ref=a.ts:1; b.ts:2 -->`) cite, confidence-first order | `lint-cite` | exit 1; finding at that line; ref parsed up to `-->` |
| E5 | Per-claim provenance — nested fragment citation | EP (JSON shape) | L1 | automated | fragment JSON with `entities[0].fields[2] = {"cite":"a.ts:1; b.ts:2","confidence":"confirmed"}`, one-line serialisation, `confidence` key before `cite` | `lint-cite <frag>.json` | exit 1; finding names `<file>#/entities/0/fields/2` |
| E6 | Per-claim provenance — entry points skipped | EP | L1 | automated | fragment JSON whose only multi-location cite is in `entry_points[0]` (no `confidence` key) | `lint-cite` | exit 0 |
| E7 | Per-claim provenance — single-line cite rule | BVA (terminated / unterminated) | L1 | automated | md with `<!-- cite: ref=a.ts:1, confidence=confirmed` and `-->` on next line | `lint-cite` | exit 1; finding names the opening line as unterminated |
| E8 | Per-claim provenance — multi-file call | EP | L1 | automated | one clean md + one dirty json passed together | `lint-cite clean.md dirty.json` | exit 1; findings only for `dirty.json` |
| E9 | Business rule catalog — boundary text aligned | EP (3 files) | L1 | automated | `prompts/generator-rebuild.md`, `prompts/auditor-rebuild.md`, `SKILL.md` | read + collapse `/\s+/g` to `" "` | each contains the D1 boundary sentence verbatim; none contains the old "Interface plumbing (exit codes," wording |
| E10 | Gap register — literal key instruction | EP | L1 | automated | `prompts/generator-rebuild.md` | whitespace-normalised read | contains "name the key exactly as read" |
| E11 | Grounding audit — lint wired into gate | EP | L1 | automated | `SKILL.md` | whitespace-normalised read | mentions `lint-cite` in the `G` subcommand list, pre-merge fragment lint, post-merge catalog lint, gate summary and promotion condition |
| E12 | Per-claim provenance — template does not violate the cap | EP | L1 | automated | `references/package-templates.md` fragment example (JSON block) | extract block → `lint-cite` | exit 0 (line 163 entity cite no longer `confirmed` with 2 locations) |
| E13 | Business rule catalog — error map + fallback recalled | judged eval | — | manual-only | fixture run 2 (`score.md` §1, variant A) | judge per `score.md` §2 | `rules.md` holds R11 (explicit) + I6 (implicit); recall ≥ 90% |
| E14 | Gap register — literal key in R9 | judged eval | — | manual-only | fixture run 2 | judge | R9 rule names `approval.autoApproveLimit`; GAP present |
| E15 | Business rule catalog — re-run preserves ids (M5) | state-transition (run 2 → run 3) | — | manual-only | run 3 supplying run 2's package | judge | every surviving `BR-/QUIRK-/GAP-` id kept; no run-2 id reused |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Per-claim provenance — check usage errors | fault (missing input) | L1 | automated | no file argument | `lint-cite` | exit 2; stderr contains usage text |
| X2 | Per-claim provenance — missing file | fault (abort) | L1 | automated | non-existent path | `lint-cite /nope.md` | exit 2; stderr `lint-cite: not found: /nope.md` |
| X3 | Per-claim provenance — malformed fragment JSON | fault (corrupt input) | L1 | automated | `.json` file with invalid JSON | `lint-cite` | exit 2 (or 1 with a parse finding) and stderr names the file — never exit 0 |
| X4 | Grounding audit — audits converge with caps | judged eval | — | manual-only | fixture run 2 | SKILL.md steps 6–11 | every capability audit + cross-cutting audit `pass` within 3 rounds; `lint-cite` clean before each audit round; cap-lowered `inferred` not flagged by auditor |
| X5 | Rebuild package layout (unmodified) / M11 — real-target run leaves repo clean | fault (write outside scratch) | — | manual-only | one kb-indexed `packages/server/src` area | full run + promote to `.reverse-spec-scratch/promoted/` | `git status --porcelain` diff before/after shows changes only under `.reverse-spec-scratch/`; gate summary includes citation-check result |

---

## Coverage summary

- Requirements covered: 4/4 MODIFIED (Per-claim provenance, Business rule catalog, Gap register, Grounding audit and revise loop)
- Scenarios by class: edge 15 · perf 0 · frontend 0 · error 5
- Scenarios by level: L1 15 · L2 0 · L3 0
- Scenarios by disposition: automated 15 · manual-only 5

## New infra needed

- none (extends `src/__tests__/` with the existing `guard()` helper)
