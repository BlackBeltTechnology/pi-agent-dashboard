# Test Plan — add-local-codeql-ratchet

Stage: design   Generated: 2026-10-14

Hard gate cleared: no unfillable Triple slots after doubt-review cycles 1–4
(exit codes, rule grammar, growth rules per rule+file, snapshot mechanics, the
offline preflight and the extractor-filter translation are pinned in
specs/design and were reproduced by probe). Levels:

- **L1** — vitest, no CodeQL needed. Pure decision functions are imported from
  `scripts/codeql-local.mjs`. Script behaviour runs the real script as a child
  process against a temp git repo with `CODEQL_BIN` pointing at a fake binary
  (a small Node script) that records argv/env/source-root listing to a JSON file
  and answers `version` / `resolve queries` / `pack download` / `database create`
  / `database analyze` from a per-test plan (exit codes, fixture SARIF).
- **L2** — the same script against the real CodeQL CLI on a tiny temp repo;
  `describe.skipIf(!codeqlAvailable)` (CI has no CodeQL, so these run on
  developer machines and in ship-it worktrees); offline simulated with
  `HTTPS_PROXY=HTTP_PROXY=http://127.0.0.1:9`, uncached with `HOME=$(mktemp -d)`.
- **manual-only** — GitHub-side rollout and the agent-driven ship-it walkthrough.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared config — categories / triggers / no cache | static contract | L1 | automated | `.github/workflows/codeql.yml` parsed as YAML | read | matrix languages exactly `actions`, `javascript-typescript`, `python`; analyze `category` is `/language:${{ matrix.language }}`; init `config-file` is `./.github/codeql/codeql-config.yml`; `build-mode: none`; triggers push+pull_request on `develop` and a schedule; top-level `permissions` with `security-events: write`; no step uses `actions/cache` and no `pnpm install`/`npm ci` step |
| E2 | shared config — filters newline-separated | contract (fake bin env capture) | L1 | automated | temp repo whose config `paths-ignore` is `**/__tests__/**`, `tests/**` | run script | every recorded `database create` env has `LGTM_INDEX_FILTERS` exactly `exclude:**/__tests__` + newline + `exclude:tests`; no recorded argv contains `--codescanning-config` |
| E3 | shared config — exclusion not applied | fault on result | L1 | automated | fake analyze returns a result in `src/__tests__/a.js` | run script | exit 2; stderr names `src/__tests__/a.js` and the glob `**/__tests__/**` |
| E4 | shared config — real exclusions; scripts analyzed | EP (path classes) | L2 | automated | temp repo with the same cleartext-logging snippet in `src/__tests__/a.js`, `mockups/m.js`, `scripts/x.mjs`, `scripts/__tests__/x.test.mjs`, `lib/a.js`, and the repo's real `codeql-config.yml` | run script `--json` | results reference `lib/a.js` and `scripts/x.mjs` only |
| E5 | snapshot — uncommitted content analyzed, ignored output not | EP | L1 | automated | temp repo: committed `a.js`, modified `a.js` (content `FIXED`), untracked `b.js`, deleted tracked `c.js`, git-ignored `node_modules/n.js` | run script; fake create records the `--source-root` listing and `a.js` content | listing has `a.js` (content `FIXED`) and `b.js`, lacks `c.js`, `node_modules/n.js` and `codeql-baseline.json` |
| E6 | snapshot — id tracks content, not the baseline | state-transition | L1 | automated | temp repo with modified `a.js`; record id; edit `a.js` again; record; edit only `codeql-baseline.json`; record | script's exported `snapshotId(cwd)` | 1st ≠ 2nd; 2nd = 3rd |
| E7 | snapshot — seed run without a baseline file | boundary | L1 | automated | temp repo without `codeql-baseline.json` | `snapshotId(cwd)` | returns a tree id; no error |
| E8 | snapshot — linked worktree, real index untouched | state | L1 | automated | `git worktree add` of a temp repo with staged, unstaged and untracked changes | snapshot from inside the worktree | snapshot contains working-tree contents; `git status --porcelain` and `git ls-files -s` byte-identical before/after |
| E9 | snapshot — analysis options | contract (argv capture) | L1 | automated | temp repo + baseline header packs `javascript-queries 2.4.7`, `actions-queries 0.6.37` | run script twice | each `database create` has `--overwrite`, `--build-mode=none` and a run dir that differs between the two runs; each `database analyze` has `codeql/javascript-queries@2.4.7:codeql-suites/javascript-code-scanning.qls` (resp. actions) and `--threat-model=remote`, and no `--download` |
| E10 | unavailable — binary missing | EP | L1 | automated | `CODEQL_BIN` unset, `PATH` without `codeql` | run script `--json` | exit 0; stderr has a line starting `CODEQL SKIPPED:`; stdout `status` `skipped` with `message` |
| E11 | unavailable — packs neither cached nor downloadable | EP | L1 | automated | fake `resolve queries` exit 2, fake `pack download` exit 2 | run script | exit 0; `CODEQL SKIPPED:` naming the pack; no `database create` recorded |
| E12 | unavailable — cache used before network | contract | L1 | automated | fake `resolve queries` exit 0 | run script | no `pack download` recorded |
| E13 | unavailable — version mismatch warns | EP | L1 | automated | fake `version` reports 2.28.0, header 2.27.2 | run script | stderr line starting `CODEQL WARNING:` naming both; ratchet still runs (exit per results) |
| E14 | ratchet — new / above / at-or-below | decision-table | L1 | automated | baselines × counts: key absent (current 1); baseline 1 current 2; baseline 2 current 2; baseline 2 current 1 | `ratchetDecision` | new 1, new 1, pass, pass; new results carry rule, file, start line, message |
| E15 | ratchet — validator grammar | decision-table | L1 | automated | entries per fixture V | `validateBaseline` | each fixture-V row gives its listed verdict |
| E16 | ratchet — missing or malformed baseline file | EP | L1 | automated | no file; `version: 2`; count 0; reason `because` | run script | exit 2 naming the problem; no baseline written |
| E17 | ratchet — keys from SARIF | contract | L1 | automated | fixture SARIF: two rules on one line; URI `sp%20ace/q.js`; one result without `primaryLocationLineHash` at line 7 | `resultKeys` | two distinct keys for the shared line; file `sp ace/q.js`; the hashless one keyed `-@7` plus a warning; moving it to line 9 gives a different key |
| E18 | ratchet — code inserted above keeps the key | property (real fingerprints) | L2 | automated | temp file with a flagged line followed by >100 chars of unchanged code; baseline from run 1; then insert a line and a function above it | run 2 | exit 0 (same `lineHash`) |
| E19 | growth — accepted with a reason, triage then accept | decision-table | L1 | automated | ref/work pairs: new `js/path-injection` key `operator-authz: GET /api/x …`; ref `untriaged`×2 → work `operator-authz: …`×3 | `baselineGrowth` | both pass; output lists old→new count and reason |
| E20 | growth — untriaged rules per rule+file | decision-table | L1 | automated | (a) new key reason `untriaged`; (b) `untriaged` 2→3 same key; (c) ref one `untriaged`×3 → work two other keys `untriaged`×2 and ×2, same rule+file; (d) ref `false-positive: x` → work `untriaged` same count | `baselineGrowth` | all four fail naming entry or rule+file |
| E21 | growth — no-growth mode | EP | L1 | automated | work adds a key with `operator-authz: …`; separately raises a `false-positive:` count | `baselineGrowth(…, {noGrowth:true})` | both fail |
| E22 | growth — lowering, removal, triage allowed and printed | EP | L1 | automated | count 3→1; entry removed; `untriaged`→`false-positive: x` same count | `baselineGrowth` | pass; printed lines include the removal as count 0 with old reason, and the reason change |
| E23 | growth — seed exactness | decision-table | L1 | automated | ref without baseline; last run counts {k1:2,k2:1}; work (a) equal; (b) k1:3; (c) only k1; (d) no matching last run | `--check-baseline-diff <ref>` in a temp repo | (a) exit 0; (b),(c) exit 1; (d) exit 0 with a line starting `SEED:` |
| E24 | prune — removes, lowers, never raises, reports lost reasons | decision-table | L1 | automated | baseline {a:2 untriaged, b:1 `github-dismissed (#12, false positive): x`, c:1}; current {a:1, c:3} | `pruneBaseline` | a→1, b removed and printed with its reason, c stays 1; reasons unchanged |
| E25 | accept — several after one run | state-transition | L1 | automated | last run with two new keys k1,k2 | `--accept k1 --reason "false-positive: constant input"` then the same for k2 | 1st exit 1 (k2 remains), 2nd exit 0; both entries at current counts |
| E26 | accept — refusals | EP | L1 | automated | key without excess; reason `untriaged`; reason `x`; reason equal to the entry's current one after whitespace normalization; `operator-authz: …` on `js/request-forgery`; source edited after the run | `--accept` | each exit 2; baseline byte-unchanged |
| E27 | triage — allowed and refused | EP | L1 | automated | entry `untriaged`×2; entry `false-positive: x`; missing key | `--triage` with `false-positive: constant input` | 1st: reason changed, count 2, then `--check-baseline-diff` passes and prints the change; 2nd and 3rd exit 2, baseline unchanged |
| E28 | seed — writes header and entries; refuses overwrite | state | L1 | automated | temp repo, no baseline, fake run with 2 keys and pack versions `2.4.7+abc`; then run again with the file present | `--write-baseline`; plain run; `--write-baseline` again | header `codeql` = fake version, packs `2.4.7`/`0.6.37` (no `+sha`), 2 `untriaged` entries; plain run exit 0; 2nd seed exit non-zero, file unchanged |
| E29 | output — JSON and byte-stable baseline | contract | L1 | automated | fake run with one new result and one stale entry; baseline content written twice from shuffled entry order | run `--json`; writer | stdout is one JSON object `status: new`, one `newResults`, one `staleEntries`; human lines on stderr only; the two files are byte-identical and end with a newline |
| E30 | ship-it delta — skill documents 4.4b | static contract | L1 | automated | `.pi/skills/ship-it/SKILL.md` | read | step 4.4 lists `codeql-local.mjs --check-baseline-diff origin/develop`; a 4.4b section between 4.4 and 4.5 names `--prune`, `--accept`, `ask_user`, the three preset rules (and not `js/request-forgery`), `--no-growth` for headless, `SHIP_IT_BLOCKED.md`, retry/abort and revert/abort handling, accepts before fixes, and "no model call"; step 4.5 states it runs only after 4.4b passes or skips |

#### Fixture V — validator verdicts (fenced: values contain colons and parentheses)

```text
reason "untriaged"                                        -> valid
reason "untriaged "                                       -> invalid
reason "operator-authz: GET /api/x behind guard" on js/path-injection -> valid
reason "operator-authz: x" on js/request-forgery          -> invalid
reason "operator-authz:"                                  -> invalid
reason "false-positive: constant input"                   -> valid
reason "accepted-risk: dev-only tool"                     -> valid
reason "github-dismissed (#12, false positive): no comment" -> valid
reason "github-dismissedX: y"                             -> invalid
reason "because"                                          -> invalid
lineHash "60907dd70d778:1" / "332c0eff7e57397a:1" / "-@7" -> valid
lineHash "abc" / "-"                                      -> invalid
file " a.ts" / "a.ts "                                    -> invalid
count 0 / 1.5 / "2"                                       -> invalid
duplicate (ruleId, file, lineHash)                        -> invalid
```

### Performance

| id | requirement | technique | level | disposition | load | trigger | expected observable |
|----|-------------|-----------|-------|-------------|------|---------|---------------------|
| P1 | 4.4 enforcer is static and instant | boundary | L1 | automated | ref and work baselines of 400 entries each, 50 changed | `--check-baseline-diff` timed | < 2 s; no `CODEQL_BIN` invocation recorded |
| P2 | local run fits the ship loop | measurement | — | manual-only | the real repository on `develop` with packs cached | `npm run codeql` (task 2.5) | completes in ≤ 5 min; times recorded in the sidecar |

### Frontend-quirk

none — no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | unavailable — extractor failure | fault-injection | L1 | automated | fake `database create` exits 1 with stderr `boom` | run script | exit 2; stderr contains `boom` |
| X2 | unavailable — `CODEQL_BIN` points to a missing file | fault-injection | L1 | automated | `CODEQL_BIN=/nonexistent/codeql` | run script | exit 2 (not SKIPPED) |
| X3 | snapshot — conflicted index | fault-injection | L1 | automated | temp repo with an unmerged path after a conflicting merge | run script | exit 2 asking to resolve conflicts; no create recorded |
| X4 | snapshot — live lock refuses, stale lock taken over | state-transition | L1 | automated | lock dir naming (a) the test runner's own live PID and start time, (b) a dead PID | run analysis and `--prune` | (a) both exit 2, baseline unchanged; (b) analysis proceeds and replaces the lock |
| X5 | growth — invalid baseline or unknown ref | fault-injection | L1 | automated | (a) work baseline with a duplicate key; (b) ref baseline with reason `because`; (c) ref `nope/missing` | `--check-baseline-diff` | each exit 2 |
| X6 | unavailable — offline with cached packs works; uncached skips | fault-injection (network) | L2 | automated | (a) real `HOME`, proxy blackhole; (b) `HOME=$(mktemp -d)`, proxy blackhole | run script on a tiny repo with a seeded baseline | (a) analysis completes (exit 0/1 per results); (b) exit 0 with `CODEQL SKIPPED:` within 150 s |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | ship-it delta — interactive 4.4b | walkthrough | — | manual-only | a worktree change that introduces one cleartext-logging alert and fixes a line under a seeded entry | run `ship-it` interactively | stale entry pruned and staged; one `ask_user` question with fix / typed reason (no `operator-authz` preset for this rule); accept staged; closing check passes; 4.5 runs |
| M2 | ship-it delta + boundary-reverse — headless stop | walkthrough | — | manual-only | same change, headless | run `ship-it` headless | `SHIP_IT_BLOCKED.md` lists the alert with resolution steps; exit non-zero; 4.5 and ship-change do not run; `proposal.md`/`design.md` untouched |
| M3 | local-review-gate — review waits for 4.4b | walkthrough | — | manual-only | M2's state | inspect run output | no reviewer model call was made |
| M4 | rollout — default setup off, first advanced analysis | checklist | — | manual-only | repo admin, tasks 6.1–6.3 | disable default setup; merge; wait for the first `develop` analysis | `default-setup` `state` is `not-configured`; analyses carry the three `/language:*` categories; every exported dismissal is still dismissed or re-dismissed; ignored-path alerts closed; CI and local rule sets equal for JS/TS and actions |
| M5 | seed gate — local vs GitHub agreement | measurement | — | manual-only | latest GitHub `develop` analysis commit (task 3.1) | compare keys | matched / local-only / GitHub-only counts recorded in `evidence/`; stop for a decision above 5 % unmatched |

---

## Coverage summary

- Requirements covered: 9/9 (codeql-local-ratchet ×7, ship-it-orchestrator ×2 MODIFIED, local-review-gate MODIFIED via M3/E30)
- Scenarios by class: edge 30 · perf 2 · frontend 0 · error 6 · manual 5
- Scenarios by level: L1 34 · L2 3 · L3 0 · — 6
- Scenarios by disposition: automated 37 · manual-only 6

## New infra needed

- Fake CodeQL binary helper `scripts/__tests__/fixtures/fake-codeql.mjs` (records
  argv/env/source-root listing; scripted exit codes and fixture SARIF).
- New test files: `scripts/__tests__/codeql-local.test.mjs` (pure, exemplar
  `knip-ratchet.test.mjs`), `scripts/__tests__/codeql-local-cli.test.mjs` (fake
  bin + temp git repos, exemplar `check-conventions.test.mjs`),
  `scripts/__tests__/codeql-local-real.test.mjs` (L2, `skipIf` no CodeQL),
  `packages/shared/src/__tests__/codeql-workflow-contract.test.ts` (exemplar
  `workflow-token-cache-contract.test.ts`),
  `packages/shared/src/__tests__/ship-it-codeql-wiring.test.ts` (exemplar
  `spec-collateral-wiring.test.ts`).
