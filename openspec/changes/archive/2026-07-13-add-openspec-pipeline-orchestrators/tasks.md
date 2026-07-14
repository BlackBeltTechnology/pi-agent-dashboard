## 1. Manifest schema + scenario-design edit

- [x] 1.1 Add a `disposition` column (`automated` | `manual-only`) and confirm the `level` column in `scenario-design`'s `references/test-plan-schema.md` (the manifest is the source of truth for automated-vs-manual)
- [x] 1.2 Add a `manual-only` routing outcome to `scenario-design` Phase 4 (aesthetics / hardware / subjective — no automatable observable), additive to existing L1/L2/L3 logic
- [x] 1.3 Emit the `disposition` per scenario row in `scenario-design` Phase 5 output
- [x] 1.4 Fix the stale `:18000` in the `scenario-design` routing table → dynamic harness port (read from `.pi-test-harness.json`)

## 2. Pure, unit-testable helper logic

- [x] 2.1 Implement a manifest parser: read `test-plan.md` rows → `{id, level, disposition}` (tolerant of malformed / missing rows)
- [x] 2.2 Implement the defer-decision: given leftover `- [ ]` tasks + parsed manifest → `defer` (all map to `manual-only`) or `stop` (any non-manual leftover); no manifest → legacy keyword defer
- [x] 2.3 Implement the no-weakening diff-assert: given a test-file diff → reject added `.only` / `skip` / deletion / weakened assertion, allow a genuine fix
- [x] 2.4 Implement the filesystem-reality check: an `automated` scenario is satisfied only when its test file exists (checkbox `- [x]` alone is insufficient)

## 3. plan-proposal skill (develop, main session)

- [x] 3.1 Author `.pi/skills/plan-proposal/SKILL.md` — main-session-only guard, refuses to run as a subagent
- [x] 3.2 Wire the doubt-review trigger: invoke `doubt-driven-review` on `proposal.md` / `design.md` when drafted or modified (ARTIFACT + CONTRACT only, surface cross-model offer), reconcile before folding
- [x] 3.3 Wire `scenario-design` + category-routed fold: write `automated` scenarios as vanilla `- [ ]` tasks with a harness-exemplar pointer + the Triple; keep `tasks.md` parser-safe (no custom token)
- [x] 3.4 Stop at the worktree boundary: after planning artifacts are committed and the worktree spawns, report readiness and hand off to `ship-it`

## 4. ship-it skill (worktree, headless-capable)

- [x] 4.1 Author `.pi/skills/ship-it/SKILL.md` — idempotent entry: `openspec status` for orientation, but gate `automated` scenarios on the filesystem-reality check (2.4), not the checkbox
- [x] 4.2 Red-test fix loop OWNED by ship-it: drive fixes directly (never re-invoke apply on a checked task), bound by progress-making cycles, escalate on a no-progress cycle, enforce the no-weakening diff-assert (2.3)
- [x] 4.3 Harness lifecycle: call `docker/test-up.sh`, read the port from `.pi-test-harness.json`, run the suite, wrap in `trap`/finally so `test-down.sh` always runs (red / abort / partial start)
- [x] 4.4 Drive `ship-change` INLINE with manifest-aware defer (2.2); tear the harness down BEFORE `ship-change` worktree removal (ordering contract)
- [x] 4.5 Boundary-reverse escape hatch: on apply-design-issue OR fix-bound exhaustion → write `SHIP_IT_BLOCKED.md`, leave worktree intact, exit non-zero, surface via dashboard

## 5. ship-change edit

- [x] 5.1 Update the `ship-change` skill defer rule: manifest-aware (defer only `manual-only` manifest rows when `test-plan.md` exists) with the legacy keyword defer preserved verbatim when no manifest exists
- [x] 5.2 Document the teardown-before-worktree-removal ordering contract with `ship-it` in the `ship-change` skill

## 6. Tests (automated — L1 unit on the pure logic)

- [x] 6.1 Unit: manifest parser — well-formed rows, malformed rows, missing `disposition` (test-plan: automated)
- [x] 6.2 Unit: defer-decision — all-manual→defer, non-manual leftover→stop, no-manifest→keyword fallback (test-plan: automated)
- [x] 6.3 Unit: no-weakening diff-assert — rejects `.only`/`skip`/delete/weakened assertion, accepts a real fix (test-plan: automated)
- [x] 6.4 Unit: filesystem-reality check — `- [x]` but missing test file → not satisfied (test-plan: automated)

## 7. Validate (manual — deferred to post-merge; disposition manual-only)

- [x] 7.1 Manual: dry-run `plan-proposal` on a sample change on `develop` — confirm doubt-review fires, fold writes vanilla tasks, `test-plan.md` carries dispositions (test-plan: manual-only)
- [x] 7.2 Manual: run `ship-it` end-to-end in a worktree on a trivial change — confirm dynamic port, teardown precedes removal, PR merges (test-plan: manual-only)
- [x] 7.3 Manual: force a red authored test — confirm bounded fix loop, no-weakening rejection, and `SHIP_IT_BLOCKED.md` on bound exhaustion (test-plan: manual-only)
