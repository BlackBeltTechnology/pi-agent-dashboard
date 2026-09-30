# Test Plan — add-spec-collateral-scan

Stage: design   Generated: 2026-09-29

No clarifications: every Triple is fillable from the spec + design (sentence
boundary for intent weighting pinned in design D2).

Levels: **L1** only. Script scenarios → `scripts/__tests__/spec-collateral.test.mjs`
(root `scripts` vitest project) on synthetic fixture corpora written to a temp
dir; exemplars: pure functions → `scripts/__tests__/check-pi-settings-paths.test.mjs`,
CLI via child process → `scripts/__tests__/check-kb-dist-fresh.test.mjs`.
Skill-text wiring → `packages/shared/src/__tests__/spec-collateral-wiring.test.ts`;
exemplar `packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts`
(repo-level wiring guard over `plan-proposal` text). Whether a live model obeys
the new skill text → `manual-only`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Identifiers (shape) | EP | L1 | automated | text with `` `Tasks` `` `` `Popover` `` `` `Apply` `` | `extractIdentifiers` | none of the three is a key of the result |
| E2 | Identifiers (kept) | EP | L1 | automated | text with `SessionOpenSpecActions`, `CORE_PACKAGE_NAMES`, `@earendil-works/pi-ai`, `stats_update`, `packages/server/src/pi-core-checker.ts` | `extractIdentifiers` | keys include `SessionOpenSpecActions`, `CORE_PACKAGE_NAMES`, `@earendil-works/pi-ai`, `stats_update`, `pi-core-checker.ts`, `pi-core-checker` |
| E3 | Identifiers (stoplist) | EP | L1 | automated | text with `MODIFIED`, `RENAMED`, `[--json]`, `--top` | `extractIdentifiers` | none of `MODIFIED`, `RENAMED`, `--json`, `--top` is a key |
| E4 | Identifiers (packages, routes, CSS vars, paths) | EP | L1 | automated | text with `@earendil-works/pi-ai`, `/api/pi-core/update`, `--accent-green`, `packages/client/src/index.css` | `extractIdentifiers` | keys include `@earendil-works/pi-ai`, `/api/pi-core/update`, `--accent-green`, `index.css`; `index` is not a key |
| E5 | Identifiers (citation suffix) | EP | L1 | automated | text citing `packages/server/src/pi-core-checker.ts:42` and `review-gate.ts:17-73` | `extractIdentifiers` | keys include `pi-core-checker.ts` and `review-gate.ts`; no key contains `:42` or `:17-73` |
| E6 | Identifiers (capability names) | EP | L1 | automated | corpus has capability `plan-proposal-orchestrator`; change text names it and `spec-collateral-scan`, which only the change's delta creates | `scanCollateral` | neither appears in `identifiers` |
| E7 | Identifiers (bare token) | EP | L1 | automated | prose "the helper calls resolveReviewer first" (no backticks) | `extractIdentifiers` | `resolveReviewer` is a key |
| E8 | Ranking (intent ×3) | decision-table | L1 | automated | ids `fooBarAlpha`, `fooBarBeta` with equal df; change line 1 "Remove `fooBarAlpha`." line 2 "Keep `fooBarBeta`." | `extractIdentifiers` + `scanCollateral` | `fooBarAlpha` multiplier 3, `fooBarBeta` 1; a requirement naming `fooBarAlpha` outranks one naming `fooBarBeta` |
| E9 | Ranking (max over occurrences) | EP | L1 | automated | `fooBarAlpha` in a neutral bullet and in a separate "drop `fooBarAlpha`" bullet | `extractIdentifiers` | multiplier for `fooBarAlpha` is 3 |
| E10 | Ranking (df cap, large corpus) | BVA | L1 | automated | synthetic corpus N = 657; `idTwentySix` in 26 specs, `idTwentySeven` in 27 | `scanCollateral` | `idTwentySix` contributes to scores; `idTwentySeven` absent from `identifiers` and contributes nothing |
| E11 | Ranking (df floor, small corpus) | BVA | L1 | automated | N = 20; `idInTwo` in 2 specs, `idInThree` in 3 | `scanCollateral` | `idInTwo` contributes; `idInThree` dropped |
| E12 | Ranking (df = 0) | BVA | L1 | automated | change names `nowhereToken` absent from every spec | `scanCollateral` | no entry references it; no weight in the output is `Infinity` or `NaN` |
| E13 | Ranking (token bound) | BVA | L1 | automated | change names `pi-core-version`; req A contains only `pi-core-version-check`, req B contains `pi-core-version.ts`, req C contains `(pi-core-version)` | `scanCollateral` | A scores 0 for it; B and C match |
| E14 | Ranking (best requirement) | decision-table | L1 | automated | capability A: 1 requirement with rare removed id; capability B: 5 requirements each with a different common (non-capped) id | `scanCollateral` | A ranks above B in `t1.entries` |
| E15 | Lists (T2 listed) | state-transition | L1 | automated | delta only ADDs to C; C's main requirement R names a touched id | `scanCollateral` | `t2.entries` contains `{capability: C, requirement: R}` |
| E16 | Lists (T2 MODIFIED excluded) | state-transition | L1 | automated | delta names R under `## MODIFIED` | `scanCollateral` | R not in `t2.entries` |
| E17 | Lists (T2 REMOVED / RENAMED excluded) | decision-table | L1 | automated | delta REMOVES R1 and RENAMES `FROM: R2` | `scanCollateral` | neither R1 nor R2 in `t2.entries` |
| E18 | Lists (T1 excludes delta caps) | EP | L1 | automated | capability C is in the delta and matches strongly | `scanCollateral` | C not in `t1.entries` |
| E19 | Lists (T1 needs a match) | BVA | L1 | automated | corpus where no capability outside the delta matches any id | `scanCollateral` | `t1.entries` is empty, `t1.omitted` 0 |
| E20 | Lists (global cap + omitted) | BVA | L1 | automated | 3 delta capabilities with 14 matching unmodified requirements, N = 10 | `scanCollateral` + markdown render | `t2.entries.length` 10 (the 10 highest), `t2.omitted` 4; markdown states 4 omitted |
| E21 | Lists (tie-break) | EP | L1 | automated | two T1 capabilities `alpha-cap-x`, `beta-cap-y` with equal scores; two T2 requirements equal in score and capability | `scanCollateral` | T1 order `alpha-cap-x`, `beta-cap-y`; T2 order by requirement name ascending |
| E22 | Lists (determinism) | EP | L1 | automated | same change + corpus | CLI twice (markdown and `--json`) | outputs byte-identical per format |
| E23 | Lists (JSON shape) | EP | L1 | automated | any completed scan | CLI `--json`, `JSON.parse` | keys `t1.entries`, `t1.omitted`, `t2.entries`, `t2.omitted`; `identifiers` is an array of `{id, weight}` (non-empty when ids exist) |
| E24 | Lists (identifiers after cap) | EP | L1 | automated | E10 corpus | CLI `--json` | `identifiers` contains `idTwentySix`, not `idTwentySeven` nor `MODIFIED` |
| E25 | Identifiers (missing artifact) | EP | L1 | automated | change dir with proposal + tasks, no `design.md` | CLI | exit 0, output produced |
| E26 | Lists (`--top`) | BVA | L1 | automated | corpus with ≥ 5 candidates per list | CLI `--top 3 --json` | each `entries` length ≤ 3 and `omitted` = total − 3 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Lists (single pass) | invariant | L1 | automated | synthetic corpus of 700 specs, reader injected into `scanCollateral` counting reads per path | every spec path read exactly once | one scan |
| P2 | Lists (no accidental quadratic) | tail-latency (timed) | L1 | automated | synthetic corpus of 700 specs × 8 requirements, change with 60 ids | wall < 10 s | one CLI run |

### Frontend-quirk

None — no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Never gates (usage) | fault-injection (bad input) | L1 | automated | `--change does-not-exist` | run CLI | exit 2; stderr names `does-not-exist` |
| X2 | Never gates (usage) | fault-injection (bad input) | L1 | automated | `--specs /nonexistent-dir` | run CLI | exit 2; stderr names `/nonexistent-dir` |
| X3 | Never gates (runtime) | fault-injection (abort) | L1 | automated | one corpus spec file made unreadable (`chmod 000`; skipped on win32 / root) | run CLI | exit 2; stderr names that file |
| X4 | Never gates (findings) | EP | L1 | automated | both lists non-empty | run CLI | exit 0 |
| X5 | Never gates (exit set) | decision-table | L1 | automated | runs X1–X4 | collect exit codes | every code ∈ {0, 2}; never 1 |
| X6 | Never gates (no gate wiring) | EP | L1 | automated | repo files `scripts/check-conventions.mjs`, `.github/workflows/*.yml`, `.pi/skills/ship-it/SKILL.md` | read files | none invokes `spec-collateral.mjs` |
| W1 | plan-proposal scan in CONTRACT | EP | L1 | automated | `.pi/skills/plan-proposal/SKILL.md` step 2 | read section | names `node scripts/spec-collateral.mjs --change`, "before each" doubt cycle, the heading "Candidate conflicting requirements (advisory scan)", and report-and-proceed on scan failure |
| W2 | plan-proposal cross-model wording | EP | L1 | automated | `.pi/skills/plan-proposal/SKILL.md` | read file | no `always offer, never silently skip`; the main-session paragraph states cross-model runs automatically when a `@propose-review-N` role resolves and is offered otherwise |
| W3 | plan-proposal cited claims | EP | L1 | automated | `.pi/skills/plan-proposal/SKILL.md` step 1 | read section | instructs citing a path (and `:line` when specific) for statements about existing code in `design.md` |
| W4 | plan-proposal re-scan after fold | EP | L1 | automated | `.pi/skills/plan-proposal/SKILL.md` step 3 | read section | runs the scan after the fold; new candidates reported; a real conflict returns to step 2; "unaffected" only for a verified false positive |
| W5 | doubt-review prompt hygiene | EP | L1 | automated | `packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md` and `SKILL.agent.md` | read both | each adversarial template instructs verifying claims against the repository, writing `unverified` when a claim cannot be checked, and checking every listed candidate |
| M1 | Scan reaches a live review | observation | — | manual-only | next real `plan-proposal` run | human reads the session log | each doubt-review CONTRACT contains the advisory candidate section; the reviewer addresses each candidate |
| M2 | Unverified labelling in a live review | observation | — | manual-only | next real doubt-review where the reviewer lacks a tool (e.g. no network) | human reads the reply | the unverifiable claim is labelled `unverified`, not asserted |

---

## Coverage summary

- Requirements covered: 5/5 (spec-collateral-scan: identifiers, ranking, lists/never-gates; plan-proposal-orchestrator: planning-phase orchestration, doubt-review trigger)
- Scenarios by class: edge 26 · perf 2 · frontend 0 · error 13
- Scenarios by level: L1 39 · L2 0 · L3 0 · — 2
- Scenarios by disposition: automated 39 · manual-only 2

## New infra needed

- none (root `scripts` vitest project and `packages/shared` tests already exist)
