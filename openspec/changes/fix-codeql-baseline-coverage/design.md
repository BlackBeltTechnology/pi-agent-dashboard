## Context

Evidence is in `evidence/gate-table.md` (per-sink gates, verified at `develop` @ `43fc54fd4`) and `evidence/spike-hidden-results.md` (real local analyses). Issue text was treated as a claim, not a fact.

**#1062.**
- All 33 `operator-authz` entries (34 results; 30 `github-dismissed`, 3 bare) carry the same text (`codeql-baseline.json`). 38 GitHub dismissed alerts carry it or a variant (#120 #136 #137 #493); 33 of them map to a baseline entry (31 via `github-dismissed (#n…)` prefixes, plus bare #120 and #493), the other 5 (#128 #129 #136 #137 #138) map to none.
- The premise "an admitted caller can already spawn" is a statement about the universal network guard (`packages/server/src/auth/localhost-guard.ts:772` `createNetworkGuardHook`, wired `server.ts:3750`). The tier gate only narrows paired-device and login-session credentials; loopback and trusted-CIDR callers are exempt (`auth/route-tier-gate.ts:84-85`). So the premise is true for those callers and false for an `observe`-capped credential on the routes in `route-tiers.ts` marked `observe` (browse `:115-116`, file `:128-139`, folder-project `:140`, changelog `:192`).
- `harden-http-auth-boundaries` (planned, not implemented: `networkOnlyTierCap` has no definition at HEAD) would cap trusted-CIDR callers at `observe`, making the per-sink gates the only bound for them too. The reworded reasons stay true after it ships.
- The issue's file list is partly stale: `openspec-routes.ts` has 0 results at HEAD (only alert #138's comment); `spawn-preflight.ts`, `process-manager.ts` and `keeper-manager.ts` are not `observe` GET sinks (spawn is `control`; keeper ids are server-minted, `process-manager.ts:1103`).
- The text keeps propagating because the `ship-it` skill ships it as the `operator-authz` preset (`.pi/skills/ship-it/SKILL.md:276-281`), pinned only by name in `ship-it-codeql-wiring.test.ts:63-70`.
- GitHub limits `dismissed_comment` to 280 characters; the convention (`docs/code-quality.md` "Convention — triaged entry with open GitHub alert") is reason text plus ` — See change: <id>`, so a long reason is cut from the end.

**#1059.**
- Config: `.github/codeql/codeql-config.yml` `paths-ignore` (`**/__tests__/**`, `**/*.test.ts|tsx|mjs`, `**/*.spec.ts`, …). CI is advanced setup (`.github/workflows/codeql.yml` `config-file:`), not "default setup" as the issue says; both sides read one file, so they are equal by construction.
- Cause (archive `2026-10-17-harden-codeql-ratchet-followups` `evidence/local-vs-ci.md`, "Cause 2"): plugin route modules take `fastify: FastifyInstance` through a type-only import and production loads plugins dynamically, so the only resolvable `Fastify()` → registrar call path is in test files.
- Re-measured (spike): the hidden set is 20 production results in 7 files, none in a test file. Un-ignoring only `**/__tests__/**` recovers 9 (team-plugin's call path is a non-`*.test.*` harness); the automation call paths are `*.test.ts` and stay hidden. Un-ignoring all test globs recovers all 20 but adds 38 test-fixture results.
- The local script already fails when a result lies in an ignored path (spec "Exclusion not applied is an error"), so any ignore change must be done in the shared file, never locally.

## Goals / Non-Goals

Goals:
- Every `operator-authz` reason names a gate that exists, or states "control tier" where no per-sink gate applies; GitHub comments of the 33 mapped alerts match.
- A regression guard: the canned universal-guard sentence cannot be committed again.
- The five plugin registrars measured hidden at HEAD are analysed on both sides, if CI proves it recovers them (D2 fallback otherwise).
- `docs/code-quality.md` states what is intentionally excluded.

Non-Goals:
- Re-triaging the 33 dismissals (they stand; only the stated basis changes). A reading that shows a sink is NOT bounded becomes a finding, not a wording fix (D1 step 3).
- Editing the 5 map-less alerts' comments (#128 #129 #136 #137 #138). They have no result at HEAD; their analysed code no longer exists, so any gate text would be invented. They stay as historical records; the evidence table says so.
- Changing any GitHub `dismissed_reason`, or the `operator-authz` grammar in `scripts/codeql-local.mjs` (a grammar change would rewrite the `operator-authz: x` scenarios; the guard is a contract test).
- Anchoring every plugin registrar. Only registrars with measured hidden production results are anchored (D2); unmeasured ones stay as today.
- Scanning test code; modelling `FastifyInstance` via a data extension; implementing `harden-http-auth-boundaries`.

## Decisions

### D1 — Per-file gate reasons, one table feeds both baseline and GitHub

Reason text: `operator-authz: gate: <symbol> <repo-path>:<line>; <one-line basis>`. The gate comes first so the 280-char GitHub cut never drops it. One length rule everywhere (test, table check, sync script): the reason after any `github-dismissed (…): ` prefix is ≤ 236 characters (GitHub comment = that text + ` — See change: fix-codeql-baseline-coverage`, 43 chars, ≤ 280). The prefix is not counted: GitHub never sees it.

Three classes, decided from `evidence/gate-table.md` (verified at HEAD):
- Gate form (observe-tier routes, and control-tier routes with a real per-sink gate): `gate: <symbol> <path>:<line>`.
- `control-tier: <basis>` form, only for the three control-only files where no per-sink gate exists (`git-operations.ts`, `process-manager.ts`, `spawn-preflight.ts`; `git worktree` `path` is the caller-chosen worktree target by design, spawn probes a directory the caller may already shell into). The contract test holds that file allowlist, so an observe-tier file cannot use this form.
- Not `operator-authz` at all: `keeper-manager.ts:400` (#244, not request-reachable: the sidecar name is a server-minted id) and `path-containment.ts:67` (#100, the containment primitive itself) become `false-positive:` with the one-line basis. GitHub `dismissed_reason` is unchanged (#244 stays `won't fix`).

The contract test reads only the baseline file: it cannot know a route's tier, so tier correctness is reviewed from the gate table and enforced indirectly by the file allowlist plus the ban on the canned sentence. `observe`-tier entries therefore cannot silently keep the old text.

Steps:
1. Build one table `entry → reason text` from `evidence/gate-table.md`, re-verifying each cited line when writing (lines drift).
2. Edit the reason strings of the existing keys in `codeql-baseline.json`. Reason-only edits are not growth: `baselineGrowth` (`scripts/codeql-local.mjs:237-258`) only fails on untriaged growth, or on a raised count / new key under `--no-growth`; `describeChange` prints the reason change. The `github-dismissed (#n, <reason>):` prefix stays; the 3 bare entries stay bare (no mirror attempt: `--mirror-dismissal` needs a clean tree at the alert's analysed commit, which an edited tree is not).
3. If a gate does not bound the sink, state the true bound or file a finding; never cite a gate that does not apply.
4. Update the 33 mapped GitHub comments from the same table with `gh api -X PATCH …/code-scanning/alerts/<n>` (`state=dismissed`, `dismissed_reason` read from each alert and re-sent, new comment = the text after the `github-dismissed (…): ` prefix verbatim, so it starts `operator-authz: gate: …`). The script pre-flights: it reads ALL alerts first and aborts non-zero before any PATCH if one is not `dismissed` or its `dismissed_reason` differs from the table's expected reason (a PATCH with `state=dismissed` on an open alert would dismiss it); a mid-run API error stops non-zero and is resumable (per-alert idempotent). One canary alert first: compare the full alert JSON before/after; only `dismissed_comment` may change (re-sending `state=dismissed` could reset `dismissed_by`/`dismissed_at`). Stop and re-plan if more changes. Dry-run prints before/after; the run log goes to `evidence/comment-sync.md`.
5. Contract test `codeql-baseline-gates.test.ts` enforces the spec requirement. It pins the set of `operator-authz` keys and the `--check-baseline-diff` change count to the gate table dynamically (derived from `evidence/dismissal-comments.json`/`gate-table.md`), never a hard-coded literal: the 2 reclassified `false-positive:` entries leave the class but are among the changed keys. It also asserts every `automation-writer.ts` reason matches `/^accepted-risk: .*#\d+/` (cites #1104) and is not `false-positive:`.
6. `ship-it` §4.4b: the `operator-authz` option stays a preset offered for the same three rules (so the main `ship-it-orchestrator` wording "offering the `operator-authz` reason as a preset" still holds, no delta), but its text becomes a template that `ask_user` fills in (`gate: <symbol> <path>:<line>; basis`); `ship-it-codeql-wiring.test.ts` asserts §4.4b contains `gate: <symbol>` and does not contain `can already spawn shell-capable`.

Alternatives considered:
- Reclassify all observe-tier entries as `accepted-risk:`/`false-positive:` and change the GitHub dismissal reason. Rejected: the issue says keep the dismissal reason, and the class split is not what is wrong, the basis text is. (Only the two entries whose sink is not a request sink at all are reclassified.)
- Enforce the grammar in `reasonError` (script). Rejected: see Non-Goals.
- A `--sync-dismissal-comments` mode in `codeql-local.mjs`. Rejected: more spec + tests for a one-off.
- Fresh gate text for the 5 map-less alerts. Rejected: see Non-Goals (misattribution, e.g. #138 would cite a different route's loose allowlist).

### D2 — Restore plugin coverage with a bounded analysis anchor (Decided 2026-11-03 by owner: anchor, option D)

Owner accepted option D over un-ignoring tests (A: recovers 9 of 20 plus test-helper noise; A+: 38 fixture results) and over a data-extension model (B: unproven, QL sources unavailable locally, a wrong row applies to nothing silently; stays the fallback).

`scripts/codeql-anchor/plugin-routes.mjs` imports the five registrars measured in the spike and calls each with a real `Fastify()` inside an exported, never-called function. The allowlist is explicit and bounded: `mountAutomationRoutes`, `mountTeamRoutes`, `registerGoalRoutes`, `registerBlackholeRoutes`, `mountRolesRoutes` (modules `packages/{automation,team,goal,blackhole,roles}-plugin/src/server/…`). Criterion for membership (documented in `docs/code-quality.md`): a registrar is anchored iff a run with the test ignores lifted showed ≥1 production result hidden for its module. Other `FastifyInstance` modules (~24 across ~17 packages) were not measured and are not anchored; their hidden results, if any, stay hidden as today (recorded as a known gap, not a defect of this change).

The contract test `codeql-anchor-contract.test.ts` checks: anchor-imported module set equals the allowlist; each module exists and exports its registrar; the anchor source contains no `listen(`. It does not scan the tree, so it cannot demand more than was measured. It cannot prove the anchor is inert by importing it (the registrars are `.ts` with `.js` specifiers and runtime deps), so inertness is by construction: exported function never called, no top-level call, no `listen(`, checked by the test.

`**/__tests__/**` stays in `paths-ignore`, documented as intentional. The root package tarball `files` list names only two `scripts/*.cjs`, so the anchor is not published. Root `package.json` declares no `fastify`; the anchor's `import Fastify from "fastify"` resolves through hoisted `node_modules`. Implementation runs knip (`npm run quality:changed`) and, if it flags the import, adds `scripts/codeql-anchor/**` to the knip ignore rather than adding a dependency.

CI proof and fallback. The spike clone symlinked `node_modules`; CI runs build-mode none with no install, so the extractor may fail to resolve `fastify` and recover 0 results. Gate, before merge: (1) local run in a clone with no `node_modules`, (2) the PR's own CodeQL run (`pull_request` trigger) shows the measured results as PR alerts. Recovered (go/no-go) means at least one team-plugin `js/path-injection` alert appears. The CI run's full alert set is recorded in `evidence/ci-anchor-alerts.md` and compared to the 18 spike results; any shortfall with ≥1 recovered is documented as a known gap, not a fallback trigger. Fallback if CI recovers 0 team-plugin `js/path-injection` alerts: drop the anchor, its contract test and the anchor-derived baseline entries from this change, **and delete the ADDED requirement "Plugin server route modules are analysed through an anchor" from the spec delta** (otherwise the spec would require an artifact that does not exist), document the finding in `docs/code-quality.md`, keep `Refs #1059` and leave #1059 open with option B as the next step; #1062 ships unaffected. The explicit checklist is in tasks.md after 3.6.

`missing-rate-limiting` (blackhole, roles): one iteration of the anchor's call shape (real deps shape instead of `{}`); if still not recovered, record them as a known gap and move on. No gating on them.

### D3 — Triage before landing

The anchor opens 18 baseline keys (spike) that must carry a real reason (`untriaged` never grows; `--no-growth` blocks headless ships, so this change ships interactively and the closing check runs without `--no-growth`, growth printed and owner-visible). Per result, `security-hardening`: fix, or `false-positive:`/`accepted-risk:` citing the gate, verified in code:
- `team-plugin` `paths.ts:150-153`, `records.ts:65,79,99,109`: `TeamPaths.confine` (`canonicalize` + `isInside`, `paths.ts:93-96`), `isTargetId`, `CONVERSATION_ID_RE`, `ukSeg`.
- `automation-plugin` `automation-writer.ts:48-73`, `run-store.ts:92,102`: `isValidAutomationName` (`automation-writer.ts:37`, a regex that rejects separators and `.`/`..`), `isSafeRunId` (`run-store.ts:85`). `scopeBase` is a parameter of `writeAutomation` (`automation-writer.ts:44`). Callers traced at HEAD: the REST create/update routes admit the cwd first (`routes.ts:169` `admitRouteCwdParam`); the browser `plugin_action` `create` handler (`index.ts:~190`) does not (finding F1, see Risks). The `automation-writer.ts` results are therefore not `false-positive:`; they get an `accepted-risk:` entry citing the separate security issue #1104 (contract-tested) and stay un-dismissed on GitHub. `run-store.ts` (`isSafeRunId`) is triaged normally.
- `goal-plugin` `routes.ts:345`: `console.warn(\`…${id}…\`, err)` puts a path param in the format string. Real, low severity: fix with a `%s` placeholder.

Post-merge dismissal and local-vs-GitHub parity (`--mirror-dismissal` from a clean checkout of the merge SHA, parity numbers in docs, closing #1059) are tracked on #1059, which stays open (`Refs`), not in tasks.md: unchecked post-merge tasks would block archive, and `Fixes` would auto-close #1059 before its parity acceptance is verified.

## Risks / Trade-offs

- **F1 (confirmed, not fixed here): unadmitted `payload.cwd` in the automation `plugin_action` `create` handler.** Traced at HEAD: a browser WS frame `{type:"plugin_action", pluginId:"automation", action:"create", payload:{scope:"folder", cwd, name, config}}` is dispatched by `browser-gateway.ts:2551-2555` to the handler at `automation-plugin/src/server/index.ts:~169-202`, which uses `path.resolve(cwd)` (or `process.cwd()`) as `scopeBase` and calls `writeAutomation`, creating `<cwd>/.pi/automation/<name>/automation.yaml` and `prompt.md` (contents caller-controlled; `name` is validated by `isValidAutomationName`, existing automations are not overwritten). No `admitCwd`/known-folder check runs anywhere on that path (the REST sibling does admit). Upstream gates: WS upgrade auth (host/origin gates, then cookie, local token, trusted-CIDR or ticket); for cookie-session sockets `plugin_action` is `operate` tier (`packages/shared/src/ws-message-tiers.ts:117`, `decideWsTier`), while local/trusted/ticket sockets carry no tier; the optional host policy classifies by `pluginId` only, never `cwd`. Those gates bound WHO can send it (an operate-capable caller, who can already open terminals), not WHERE it writes. Verdict: CONFIRMED-EXPLOITABLE for a write outside the allowed folder roots; severity limited by the operate-tier requirement, so likely low-to-moderate. Disposition: this change does not fix it (no scope expansion). F1 is filed as #1104 (task 3.7 references it); the `automation-writer.ts` baseline entries are `accepted-risk:` citing #1104 and their GitHub alerts stay un-dismissed. Note CodeQL's flagged flow is the REST one; the WS flow is not a modelled source, so the alert alone would not have shown this. Fix direction for the issue: run `admitCwd` in the handler (same helper as `routes.ts:169`).

- A GitHub comment edit is visible and not transactional; a mid-run failure leaves a mixed set. Mitigation: canary alert, dry-run, per-alert idempotent PATCH, resume from the log.
- The 5 map-less alerts keep the wrong premise text. Trade-off accepted: no result and no code at HEAD to cite; #1062's acceptance for them is recorded as "historical, not edited" in `evidence/comment-sync.md`.
- The anchor exists only for the analysis and can rot. Mitigation: the contract test; it never runs, so it cannot affect runtime. Its coverage is bounded to the measured five; new plugin routes are not auto-required (trade-off: a simpler test, a known gap).
- The anchor adds alerts on the next GitHub run before they are dismissed. Mitigation: baseline entries land in the same PR; dismissal is the post-merge follow-up on #1059. CodeQL is not a required check.
- `javascript-all` pack drift between local and CI can make parity measurement show false differences; parity is measured on #1059 with equal pack versions and a re-pin if they differ.
- The reason-text contract checks symbol presence, not exact lines or route tier. Accepted: the wording is evidence for review, not an enforcement point.
- `harden-http-auth-boundaries` may reclassify trust; the reworded reasons describe per-sink gates that stay valid.
- A headless ship of this change is blocked by design (`--no-growth` in ship-it 4.4b vs the anchor's new keys). Mitigation: ship interactively.

## Migration / Rollback

Migration: none (no data, API or runtime change). Compatibility: baseline grammar unchanged; existing `--mirror-dismissal` and `--check-baseline-diff` behave as before.
Rollback: revert the commit. GitHub comments are cosmetic; the old text is recorded in `evidence/comment-sync.md`, restore by re-running the sync script in reverse. Anchor alerts, if any remain, disappear when the file is removed.
