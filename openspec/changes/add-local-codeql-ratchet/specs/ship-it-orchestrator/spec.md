## MODIFIED Requirements

### Requirement: Steps 4.4 and 4.5 sit between the harness gate and the inline ship-change drive

`ship-it`'s procedure SHALL contain a deterministic enforcer step 4.4 and a
semantic review step 4.5, in that order, executed only after every automated
scenario is harness-green and strictly before any `ship-change` step runs. Step
4.4 SHALL run `check-conventions.mjs --base origin/develop`, the `kb dox lint`
byte-arm gate, `i18n:lint --strict`, and `i18n:parity`. Step 4.4 SHALL also run `node scripts/codeql-local.mjs --check-baseline-diff origin/develop`. A step 4.4b SHALL run between 4.4 and 4.5: it runs the local CodeQL ratchet; when CodeQL is unavailable it logs the skip and continues; it prunes stale baseline entries with `--prune` and stages the lowered baseline; on new alerts it asks the user, per alert, to fix it or accept it into the baseline with a reason (offering the `operator-authz` reason as a preset only for `js/path-injection`, `js/command-line-injection` and `js/shell-command-constructed-from-input`), stages the baseline after each accept, applies accepts before routing fixes to the fix loop, and ends with a closing `--check-baseline-diff origin/develop` (with `--no-growth` in a headless run) that gates step 4.5; in a headless run new alerts are written to `SHIP_IT_BLOCKED.md` and the run stops. A script error (exit 2) is shown with retry/abort in an interactive run and written to `SHIP_IT_BLOCKED.md` in a headless run; a baseline-diff violation in step 4.4 or in the closing check is shown with revert/abort in an interactive run and written to `SHIP_IT_BLOCKED.md` in a headless run; neither enters the red-test fix loop. Step 4.4b SHALL change `codeql-baseline.json` only through the script's `--prune` and `--accept`. Step 4.4b SHALL NOT make a model call. The skill's
composed-skills list SHALL name `review-code`. Step 4.5 SHALL obtain the
reviewer prompt from the skill's prompt generator and pass it verbatim, and
SHALL validate the fix ledger before requesting any verification round.

#### Scenario: Ordering is enforced

- **WHEN** `ship-it` runs to completion
- **THEN** step 4.4 executes after the harness gate
- **AND** step 4.5 executes after step 4.4
- **AND** both execute before the first `ship-change` step

#### Scenario: Cheap deterministic failure precedes the model call

- **WHEN** a step-4.4 enforcer exits non-zero
- **THEN** step 4.5 does not run
- **AND** no reviewer model call is spent

#### Scenario: Skill documents the composition

- **WHEN** `.pi/skills/ship-it/SKILL.md` is read
- **THEN** it describes steps 4.4 and 4.5
- **AND** its Composed skills section names `review-code`
- **AND** step 4.5 instructs running the prompt generator and passing its output verbatim
- **AND** step 4.5 instructs validating the fix ledger before any verification round
- **AND** it describes step 4.4b and the CodeQL baseline-diff check in step 4.4
- **AND** its Guardrails state that review rounds are capped at two, that only a human approval at the cap adds a round (one per approval), that the orchestrator never renews its own budget, and that headless runs and hand-backs escalate via the boundary-reverse (step-5) escape hatch

#### Scenario: Step 4.4b sits between 4.4 and 4.5

- **WHEN** `ship-it` runs to completion with CodeQL installed
- **THEN** step 4.4b executes after step 4.4 and before step 4.5
- **AND** a step-4.4b failure prevents step 4.5 from running

#### Scenario: New CodeQL alert in an interactive run

- **WHEN** step 4.4b reports a new alert in an interactive run
- **THEN** the user is asked whether to fix it or accept it with a typed reason, plus an `operator-authz` preset when the alert's rule is one of the three preset rules
- **AND** an accepted alert is written with `--accept` and its reason, and `codeql-baseline.json` is staged
- **AND** a fix routes to the step-4 fix loop, after which steps 4.4 and 4.4b run again

#### Scenario: New CodeQL alert in a headless run

- **WHEN** step 4.4b reports a new alert in a headless run
- **THEN** `SHIP_IT_BLOCKED.md` is written naming each new alert's rule, file and line
- **AND** the run exits non-zero without asking

#### Scenario: CodeQL unavailable

- **WHEN** step 4.4b's script prints `CODEQL SKIPPED:`
- **THEN** ship-it records the skip in its output, runs the closing baseline-diff check, and continues to step 4.5 when it passes

#### Scenario: Stale entries pruned with the change

- **WHEN** step 4.4b finds baseline entries with fewer current results than recorded
- **THEN** it runs `--prune` and stages `codeql-baseline.json` with the change

#### Scenario: Headless run never grows the baseline

- **WHEN** a headless run reaches the closing check of step 4.4b with a baseline that adds a key or raises a count relative to `origin/develop`
- **THEN** the check runs with `--no-growth` and fails
- **AND** `SHIP_IT_BLOCKED.md` names the entry and step 4.5 does not run

### Requirement: Boundary-reverse escape hatch

`ship-it` SHALL provide a reverse path across the worktree boundary. When
`openspec-apply` reveals a design issue, or the fix-loop bound is exhausted,
`ship-it` MUST NOT headlessly rewrite planning artifacts. It SHALL leave the
worktree intact, write a `SHIP_IT_BLOCKED.md` report in the change directory
naming the failing scenario or design gap, exit non-zero, and surface via the
dashboard so a human re-enters `plan-proposal`/`doubt-driven-review` on
`develop`. A headless run that stops in step 4.4b on new CodeQL alerts SHALL use the
same report, listing each alert's rule, file, line and message and how to
resolve it — resume `ship-it` interactively, after which step 4.4b asks per
alert, or fix or `--accept` by hand and delete the report — not by re-planning.

#### Scenario: Apply surfaces a design issue
- **WHEN** apply reports that implementation reveals a design issue
- **THEN** `ship-it` writes `SHIP_IT_BLOCKED.md`, exits non-zero, leaves the worktree unmodified beyond the report, and does not edit `proposal.md`/`design.md`

#### Scenario: Fix bound exhausted
- **WHEN** the red-test fix loop exhausts its progress-making bound
- **THEN** `ship-it` writes `SHIP_IT_BLOCKED.md` naming the failing scenario and stops for human handoff

#### Scenario: Headless CodeQL stop
- **WHEN** a headless run stops in step 4.4b on new CodeQL alerts
- **THEN** `ship-it` writes `SHIP_IT_BLOCKED.md` listing each alert's rule, file, line and message, exits non-zero, and does not edit `proposal.md`/`design.md`
