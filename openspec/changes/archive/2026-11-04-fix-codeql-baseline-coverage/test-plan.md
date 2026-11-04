# Test Plan — fix-codeql-baseline-coverage

Stage: apply   Generated: 2026-11-03   Clarifications Q1–Q5 resolved 2026-11-03 (owner accepted all recommended answers; folded below). F1 is filed as #1104.

Scope note: no rendered UI, no runtime/API change. Surfaces: (a) baseline-file contract test (L1, vitest, repo-file reads), (b) skill-text wiring test (L1), (c) anchor contract test (L1), (d) goal-plugin format-string fix (L1, fastify inject), (e) real CodeQL run / CI proof / GitHub comment sync (`ci` level — workflow- or operator-run, not vitest). No L2 qa/ rows, no L3 Playwright rows (nothing to render).

Exemplars (all exist):
- Static contract on repo files: `packages/shared/src/__tests__/codeql-workflow-contract.test.ts`, `packages/shared/src/__tests__/ship-it-codeql-wiring.test.ts`
- Route test with fastify inject: `packages/goal-plugin/src/server/__tests__/goal-routes.test.ts` (DELETE at line ~203)
- Ratchet CLI behaviour (`--check-baseline-diff`, growth): `scripts/__tests__/codeql-local-cli.test.mjs`, `scripts/__tests__/codeql-local.test.mjs`
- Real analysis: `scripts/__tests__/codeql-local-real.test.mjs`

---

## Scenarios

### Edge-case

Technique note: `codeql-baseline-gates.test.ts` (D1) is driven both by the committed baseline (E1–E3, E32: the real entries) and by synthetic baseline fixtures fed to the same validator function (E4–E14: each spec scenario / boundary). The test must export or locally define a pure `validateOperatorAuthzReason(entryKey, reason, repoRoot)` so fixtures need no file edits.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | operator-authz cite gate — committed baseline | EP (all entries) | L1 | automated | real `codeql-baseline.json` after task 1.4 | run contract test | set of `operator-authz` keys equals the gate-table rows still in that class (count derived dynamically from `evidence/dismissal-comments.json`/`gate-table.md`, never a hard-coded literal: the two reclassified `false-positive:` entries leave the class), all pass; failure message names each offender key. Before the baseline edit task: fails on every `operator-authz` entry (TDD red). |
| E2 | Canned universal-guard reason rejected | error-guessing | L1 | automated | fixture entry `…browse.ts` reason `operator-authz: Operator API behind the universal network guard (createNetworkGuardHook); an admitted caller can already spawn shell-capable sessions.` | validate | fails; message contains the entry key and `can already spawn shell-capable` |
| E3 | Canned sentence banned everywhere in baseline | EP | L1 | automated | real baseline | scan all reasons (any class, not only `operator-authz:` prefix) | 0 reasons contain `can already spawn shell-capable` / `behind the universal network guard` |
| E4 | Reason names an existing gate | EP valid | L1 | automated | `operator-authz: gate: admitCwd packages/server/src/routes/folder-project-routes.ts:65; known folders only` | validate | passes (file exists, contains `admitCwd`, line 65 ≤ file length) |
| E5 | Gate symbol absent from file | EP invalid | L1 | automated | `gate: noSuchSymbol packages/server/src/routes/folder-project-routes.ts:65` | validate | fails naming entry key and symbol |
| E6 | Gate path nonexistent | EP invalid | L1 | automated | `gate: admitCwd packages/server/src/routes/does-not-exist.ts:1` | validate | fails naming entry and path |
| E7 | Gate line beyond file length (task 1.1 asserts line ≤ length) | BVA | L1 | automated | file of N lines; reasons with `:N` (max), `:N+1` (just above), `:1` (min), `:0` (just below) | validate | `:1`,`:N` pass; `:N+1`, `:0` fail |
| E8 | Over-long reason (≤236 after prefix) | BVA | L1 | automated | reason text after `github-dismissed (…): ` of 235 / 236 / 237 chars | validate | 235, 236 pass; 237 fails naming entry |
| E9 | Length excludes the prefix | EP | L1 | automated | `github-dismissed (#57, won't fix): ` + 236-char body (total >236, <280 + prefix) | validate | passes (prefix not counted) |
| E10 | Mirrored entry keeps gate first | EP | L1 | automated | `github-dismissed (#57, won't fix): operator-authz: gate: isWithinBrowseRoots packages/server/src/routes/file-routes.ts:621; …` | validate + build GitHub comment (strip prefix, append ` — See change: fix-codeql-baseline-coverage`) | passes; derived comment (text after prefix + ` — See change: fix-codeql-baseline-coverage`) matches `^operator-authz: gate: ` (comment = text after the prefix verbatim; the gate immediately follows `operator-authz: `) and length ≤ 280 |
| E11 | Control-tier form on allowlisted file | decision-table (form × file) | L1 | automated | `…/spawn-preflight.ts` with `operator-authz: control-tier: POST /api/session/spawn; probe targets a directory the caller may already start a shell in` | validate | passes |
| E12 | Control-tier form on non-allowlisted file | decision-table | L1 | automated | `…/routes/browse.ts` with `operator-authz: control-tier: …` | validate | fails naming entry |
| E13 | Decision table: form × file-class (gate/control-tier × allowlisted/other) incl. gate form on allowlisted control-only file | decision-table | L1 | automated | 4 combos: gate+observe-file ✔, gate+allowlisted ✔(only if gate real), ctrl+allowlisted ✔, ctrl+other ✘ | validate each | outcomes as listed; the 3 allowlist files exactly `git-operations.ts`, `process-manager.ts`, `spawn-preflight.ts` under `packages/server/src/` |
| E14 | Not-request-reachable / primitive sink not operator-authz | EP | L1 | automated | entries for `rpc-keeper/keeper-manager.ts` and `lib/path-containment.ts` with `operator-authz: …` | validate | fails naming entry. Real baseline: both carry `false-positive:` (asserted separately, pass) |
| E15 | Malformed reason shapes | error-guessing | L1 | automated | `operator-authz:` + empty; `operator-authz: gate:` (no symbol); `gate: sym path` (no `:line`); `gate: sym path:abc`; reason without `operator-authz` prefix is ignored | validate | first four fail naming entry; non-operator-authz reason not evaluated |
| E16 | Bare entry (no github-dismissed prefix) accepted | EP | L1 | automated | `file-routes.ts:268` bare `operator-authz: gate: resolveScopedMdPath …` | validate | passes, same rules |
| E32 | Unfixed F1 finding keeps an `accepted-risk:` reason citing #1104 (Q4) | EP / decision-table (class × issue ref) | L1 | automated | real baseline entries for `packages/automation-plugin/src/server/automation-writer.ts`; fixtures: `accepted-risk: … tracked in #1104 …` ✔, `false-positive: …` ✘, `accepted-risk: … tracked in #<n>` (placeholder) ✘, `accepted-risk:` with no `#\d+` ✘ | validate (added to `codeql-baseline-gates.test.ts`) | real entries match `/^accepted-risk: .*#\d+/` and contain `#1104`, never start `false-positive:`; the three bad fixtures fail naming the entry. Vacuous (no entries) when the D2 fallback removed the anchor-derived entries. |

### Skill wiring (ship-it §4.4b)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E17 | §4.4b preset is a gate template (D1 step 6) | EP | L1 | automated | `.pi/skills/ship-it/SKILL.md` §4.4b (extend `ship-it-codeql-wiring.test.ts`) | `section("4.4b")` flattened | contains `gate: <symbol>`; does NOT contain `can already spawn shell-capable`; still contains `operator-authz` preset offer. Red before 1.5. |
| E18 | Canned sentence gone from the whole skill | EP | L1 | automated | `.pi/skills/ship-it/**` | recursive text scan | 0 matches of `can already spawn shell-capable` (task 1.5 `rg` empty) |

### Anchor contract (#1059)

Technique: pure static analysis of the anchor source text (never imported/executed — registrars are `.ts` with `.js` specifiers). Fixtures: synthetic anchor source strings fed to the checker; plus the real file.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E19 | Allowlist bounded to measured registrars | EP | L1 | automated | real `scripts/codeql-anchor/plugin-routes.mjs` | parse imports | import set equals exactly `mountAutomationRoutes`, `mountTeamRoutes`, `registerGoalRoutes`, `registerBlackholeRoutes`, `mountRolesRoutes` (modules under `packages/{automation,team,goal,blackhole,roles}-plugin/src/server/`); no `listen(`. Red with anchor absent (TDD). |
| E20 | Allowlisted registrar missing from anchor | boundary (N−1) | L1 | automated | fixture anchor importing 4 of 5 | check | fails naming the missing module |
| E21 | Extra import outside allowlist | boundary (N+1) | L1 | automated | fixture anchor importing 5 + `packages/team-plugin/src/server/store.ts` or another plugin's registrar | check | fails naming the extra module |
| E22 | Registrar module missing / export renamed | error-guessing | L1 | automated | fixture repo-root where one allowlisted module file is absent; another where file exists but export `mountTeamRoutes` is renamed | check | both fail naming module and registrar |
| E23 | Anchor is inert by construction | EP | L1 | automated | fixtures: (a) top-level call `registerGoalRoutes(f)`, (b) `fastify.listen(…)`, (c) function not exported, (d) correct: exported function, calls inside body only | check | (a)(b) fail; (c) fails; (d) passes; real anchor passes (no top-level call expression other than `Fastify()` inside the function, no `listen(`, no `await` at top level) |
| E24 | `**/__tests__/**` stays in paths-ignore | EP | L1 | automated | `.github/codeql/codeql-config.yml` | parse yaml (extend `codeql-workflow-contract.test.ts` style) | `paths-ignore` still contains `**/__tests__/**` and the test globs; anchor path `scripts/codeql-anchor/**` is NOT ignored |
| E25 | Anchor not published in package tarball | EP | L1 | automated | root `package.json` `files` | check | no entry matches `scripts/codeql-anchor/…` |
| E26 | Test code stays out of scope | decision-table (ignored path × result) | L1 | automated | `scripts/__tests__/codeql-local.test.mjs` existing "Exclusion not applied is an error" scenario run with a SARIF fixture containing a result in `packages/x/src/__tests__/y.ts` | run ratchet | exit non-zero, error names that path (existing behaviour not regressed); no result in the real anchored run references an `__tests__` path (see X-level row C3) |

### Goal-plugin format-string fix (#1059 §3.5)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E27 | `%s` in `id` must not consume the error arg (issue repro) | error-guessing / EP | L1 | automated | goal routes with `abortGoalSupervision` stub that rejects with `Error("boom")`; `goalId` path param `abc%s%d` (URL-encoded) | `DELETE /api/folders/goals/abc%25s%25d?cwd=…` via fastify inject (exemplar `goal-routes.test.ts` DELETE case ~L203) | response `{success:true}` (delete not blocked); spy on `console.warn`: first arg is a constant format string with a `%s` placeholder, args are `(id, err)` in that order, and `util.format(...args)` output contains literal `abc%s%d` AND `boom` (err not swallowed into `%s`). Red before the fix. |
| E28 | Normal id unchanged | EP | L1 | automated | id `g_123`, rejecting abort stub | DELETE | delete succeeds; warn message contains `g_123` and error text; same as before |
| E29 | No abort hook configured | EP | L1 | automated | `abortGoalSupervision` undefined | DELETE | no `console.warn`; success (regression guard on the guarded branch) |

### Ratchet behaviour on reason-only edits (D1 step 2)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E30 | Reason-only edit is not growth | EP | L1 | automated | `scripts/__tests__/codeql-local-cli.test.mjs` style: base baseline vs working baseline differing only in a reason string (same keys, same counts) | `--check-baseline-diff <base>` and `--no-growth` | exit 0, `describeChange` prints the reason change (1 line per changed key); with `--no-growth` still exit 0. (Checks the premise D1 step 2 relies on. Already covered by the existing reason-only-triage case in `codeql-local-cli.test.mjs` and the mirror `--no-growth` case; task confirms and adds a `--no-growth` assertion only if absent.) |
| E31 | Real change: 33 reason changes, 0 growth | EP | ci | automated | real tree vs `origin/develop` after task 1.4 | `node scripts/codeql-local.mjs --check-baseline-diff origin/develop` | exit 0; output lists one reason change per gate-table row (count taken from the table, not hard-coded; the 2 reclassified entries are among the changed keys); 0 added/removed keys. Operator-run gate (task 1.4 Verify), not vitest. |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Anchor recovers 0 results in CI (D2 fallback) | fault-injection (abort) | ci | automated | clean clone, no `node_modules` (task 3.4) | `node scripts/codeql-local.mjs` | go/no-go: ≥1 team-plugin `js/path-injection` result (paths.ts 150–153, records.ts 65/79/99/109). If 0: fallback checklist triggered; any shortfall vs the full spike set (18) with ≥1 recovered is recorded as a known gap, not a fallback trigger; after fallback `openspec validate fix-codeql-baseline-coverage --strict` passes and `rg -i anchor openspec/changes/fix-codeql-baseline-coverage/specs` is empty (this last check is a testable invariant of the fallback branch). |
| X2 | PR CodeQL run shows anchor alerts | fault-injection (dependency: CI extractor) | ci | automated | PR branch pushed | `gh api …/code-scanning/alerts?ref=refs/pull/<n>/merge&state=open` | go/no-go: ≥1 alert with rule `js/path-injection` in `packages/team-plugin/src/server/paths.ts`; the full CI alert set is recorded in `evidence/ci-anchor-alerts.md` and compared to the 18 (shortfall = known gap, Q5). Operator-run; not a vitest row. |
| X3 | Anchor fails at module resolve (fastify absent) must not break non-CodeQL gates | fault-injection | ci | automated | repo with anchor present, `node_modules` hoisted | `npm run quality:changed` (knip) | exit 0; if knip flags `fastify` import, `scripts/codeql-anchor/**` ignore added and re-run exit 0 |
| X4 | Local analysis with anchor ratchet passes | EP | ci | automated | working tree with anchor + 18 new baseline entries (none `untriaged`) | `node scripts/codeql-local.mjs` | exit 0; 0 results in ignored paths; each new key has non-`untriaged` reason; `--check-baseline-diff origin/develop` (no `--no-growth`) exits 0 and lists exactly the intended new keys (= count in design D3 triage, 18 minus any dropped) |
| X5 | Untriaged recovered result fails the ratchet | decision-table | L1 | automated | `codeql-local.test.mjs` existing case: anchor-style new result key with reason `untriaged` | run ratchet | exit non-zero naming the key (regression guard that anchor results cannot land untriaged). Already covered by the existing `codeql-local.test.mjs` growth case (new untriaged key fails); task confirms it and adds a case only if absent |
| X6 | Rate-limiting results (blackhole, roles) | fault-injection (dep shape) | ci | automated | anchor deps shape iteration once (task 3.3) | local analysis | either the 2 `js/missing-rate-limiting` results appear (and are baselined) or a one-line "known gap" note exists in `evidence/spike-hidden-results.md` (grep for `known gap`) |
| X7 | GitHub comment edit — dry run | fault-injection (dry-run) | ci | automated | `evidence/sync-dismissal-comments.mjs --dry-run` against live alerts | run | lists exactly 33 alerts; 0 `dismissed_reason` changes; 0 new comments > 280 chars; every new comment matches `^(operator-authz: (gate|control-tier): |false-positive: )` (comment = text after the `github-dismissed (…): ` prefix verbatim); #128 #129 #136 #137 #138 not touched |
| X8 | Canary: only `dismissed_comment` changes | state-transition (alert JSON before/after) | ci | automated | one alert (e.g. #57), full JSON saved before and after PATCH | run script for that alert | diff shows only `dismissed_comment` (+ timestamp-like fields); `dismissed_by`, `dismissed_at`, `dismissed_reason`, `state` unchanged. If not → stop (recorded in `comment-sync.md`). Operator-run, one-shot. |
| X9 | Sync is idempotent / resumable | fault-injection (abort mid-run) | ci | automated | script killed after k of 33 alerts; re-run | run again | already-updated alerts produce a no-op (same comment) and the remaining complete; final re-read: 33 alerts `dismissed`, original reasons, none contains `behind the universal network guard`; log holds old+new text |
| X10 | Alert not `dismissed` or API 4xx/5xx | fault-injection (abort) | ci | automated | an alert in state `open` / `fixed`, or a 5xx on PATCH | run script | pre-flight reads ALL alerts first; if any is not `dismissed` or its `dismissed_reason` differs from the table's expected reason, abort non-zero BEFORE any PATCH (so it can never dismiss an open alert); a mid-run API error stops non-zero, resumable (idempotent); no partial silent success (Q3). |
| X11 | Over-long comment never sent | BVA | ci | automated | `reasonText` 236 / 237 chars | script builds comment | 236 → comment length 279 ≤ 280 sent; 237 → script refuses (exit non-zero) before any PATCH |
| X12 | Docs/conventions gates | EP | ci | automated | working tree after task 4.1 | `node scripts/dox-byte-gate.mjs`, `node scripts/check-conventions.mjs --base origin/develop`, `openspec validate fix-codeql-baseline-coverage --strict` | all exit 0 |

### Frontend-quirk

None — no rendered UI, no WS-driven view change. The F1 finding (browser `plugin_action` create with unadmitted cwd, #1104) is explicitly NOT fixed here, so no regression test for the flow itself; the reason-class check is row E32.

### Performance

None — no latency/throughput budget in the spec. CodeQL analysis wall-time is not a requirement.

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Reasons accurately describe the bounding gate (semantic correctness of 33 texts) | review (judgment) | — | manual-only | `evidence/dismissal-comments.json` + cited `path:line` | reviewer reads each gate in code, confirms it runs before the sink on that route and the tier in `route-tiers.ts` | [judgment: the contract test checks symbol presence only (design Risks); doubt-review verdict recorded in `evidence/comment-sync.md` — no automatable signal for "gate actually bounds the sink"] |
| M2 | Triage verdicts for 18 recovered results (false-positive vs accepted-risk) | review (judgment) | — | manual-only | each recovered result + cited gate | `security-hardening` pass | [judgment: per-result security verdict; not automatable] |
| M3 | #1104 (F1) stays open and the `automation-writer.ts` GitHub alerts stay un-dismissed | review | — | manual-only | #1104 filed; baseline entries cite it | operator checks GitHub alert state | [judgment/process: GitHub alert state is not repo-readable; the reason-class and `#1104` citation are covered by row E32] |
| M4 | Post-merge dismissal / `--mirror-dismissal` parity | — | — | manual-only | merge SHA | tracked on #1059, outside this change | deferred to ship-change / #1059 |

---

## Coverage summary

- Requirements covered: 2/2 (all spec scenarios mapped: reason-names-gate→E4; canned→E2/E3; control-tier allowlisted→E11; other file→E12; mirrored→E10; not-request-reachable→E14; symbol absent→E5/E6; over-long→E8/E9; anchor analysed→X1/X2/X4; allowlist bounded→E19/E25; registrar missing/extra→E20/E21; renamed→E22; test code out of scope→E24/E26; unfixed finding keeps accepted-risk reason→E32) plus design D1 step 6, D3 goal fix (issue repro E27), task gates
- Scenarios by class: edge 32 (E1–E32) · perf 0 · frontend 0 · error 12 (X1–X12) · manual 4 (M1–M4)
- Scenarios by level: L1 32 (E1–E30, E32, X5) · L2 0 · L3 0 · ci 12 (E31, X1–X4, X6–X12) · — 4
- Scenarios by disposition: automated 44 · manual-only 4



- `validateOperatorAuthzReason` (or equivalent) needs to be importable by the test with fixture inputs and an injectable `repoRoot`; otherwise E4–E16 would have to mutate the real baseline. This is test-side design, not a new harness.
- `ci`-level rows E31, X1–X4, X6–X12 have no vitest harness: they are operator-run gate commands (CodeQL CLI / `gh api`) recorded in `evidence/`. E2E/Playwright and qa/ not required. X7–X11 need `sync-dismissal-comments.mjs` to expose a `--dry-run`, a state check, and a length guard so they are observable; X8/X9 are one-shot operator checks.
