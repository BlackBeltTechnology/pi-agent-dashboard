# Test Plan — harden-review-and-fix-loop

Stage: design   Generated: 2026-09-29

## ✅ Clarifications resolved (1/1)

- [x] **C1** — Verdict language in ledger free-text = **status-assertion phrases
  only**: `\b(is|are|was|were|been|now|already)\s+(fixed|resolved|verified|addressed|done)\b`,
  `\bno further\b`, `\b(should|will|now)\s+pass\b` (case-insensitive). Bare words
  stay legal. Recorded in design D3 and the ledger requirement. Unblocks E31.

Levels: **L1** = the `.pi/skills/ship-it` vitest project (registered in root
`vitest.config.ts`). Exemplars: pure helpers → `scripts/__tests__/review-gate.test.ts`;
prose / frontmatter contracts → `scripts/__tests__/skill-contract.test.ts`;
CLI via child process → `scripts/__tests__/check-kb-dist-fresh.test.mjs`
(`execFileSync` pattern). Runtime behaviour of the orchestrating model has no
automatable observable → `manual-only`, verified on the first real `ship-it` run
after merge.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Severity routing (cap) | BVA | L1 | automated | `{round:1, blocking:[B1], interactive:false, approvedExtraRounds:0}` | `reviewRoundDecision` | `action === "review"` |
| E2 | Severity routing (cap) | BVA | L1 | automated | `{round:2, blocking:[B1,B3], interactive:false}` | `reviewRoundDecision` | `action === "escape"`; `reason` contains `B1` and `B3` |
| E3 | Halt legible (ask) | decision-table | L1 | automated | `{round:2, blocking:[B1], interactive:true, approvedExtraRounds:0}` | `reviewRoundDecision` | `action === "ask"` |
| E4 | Severity routing (+1 per approval) | decision-table | L1 | automated | `{round:2, blocking:[B1], interactive:true, approvedExtraRounds:1}` | `reviewRoundDecision` | `action === "review"` |
| E5 | Severity routing (+1 per approval) | BVA | L1 | automated | `{round:3, blocking:[B1], interactive:true, approvedExtraRounds:1}` | `reviewRoundDecision` | `action === "ask"` (never `review`) |
| E6 | Severity routing (clean) | decision-table | L1 | automated | `{round:2, blocking:[]}` × interactive ∈ {true,false} | `reviewRoundDecision` | `action === "proceed"` for both |
| E7 | Halt legible (timeout precedence) | decision-table | L1 | automated | `{round:2, blocking:[B1], interactive:true, timedOut:true}` | `reviewRoundDecision` | `action === "escape"`, reason mentions timeout — not `ask` |
| E8 | Halt legible (unsatisfiable precedence) | decision-table | L1 | automated | `{round:1, blocking:[B1], interactive:true, unsatisfiable:true}` | `reviewRoundDecision` | `action === "escape"` |
| E9 | Severity routing (malformed retry) | BVA | L1 | automated | `malformedRetries` = 1, then = 2, round 1 pending | `reviewRoundDecision` | 1 → `review` (one retry); 2 → `escape`, reason mentions malformed |
| E10 | Ledger protocol (failure bound) | BVA | L1 | automated | `ledgerFailures` = 2, then = 3, `blocking:[B1]` | `reviewRoundDecision` | 2 → not `escape`; 3 → `escape`, reason mentions unsatisfiable |
| E11 | Severity routing (reply parse) | EP | L1 | automated | reply with `issue(blocking): B1`, `issue(blocking): B2`, sweep table, `BLOCKING_COUNT: 2`, `VERDICT: block` | `parseReviewReply` | `{blockingIds:[B1,B2], count:2, verdict:"block", hasSweepSummary:true, malformed:false}` |
| E12 | Severity routing (contradictory) | EP | L1 | automated | reply listing `issue(blocking): B1`, ending `BLOCKING_COUNT: 0` / `VERDICT: pass` | `parseReviewReply` | `malformed === true` |
| E13 | Severity routing (verdict ≠ count) | EP | L1 | automated | no blocking ids, `BLOCKING_COUNT: 0`, `VERDICT: block` | `parseReviewReply` | `malformed === true` |
| E14 | Severity routing (duplicate trailer) | EP | L1 | automated | two `BLOCKING_COUNT:` lines | `parseReviewReply` | `malformed === true` |
| E15 | Severity routing (empty) | BVA | L1 | automated | `""` and `"  \n "` | `parseReviewReply` | `malformed === true` for both |
| E16 | Rubric (missing summary) | EP | L1 | automated | valid trailer, no sweep table | `parseReviewReply` | `malformed === false`, `hasSweepSummary === false` |
| E17 | Severity routing (distinct ids) | EP | L1 | automated | `B1` cited in two places, `BLOCKING_COUNT: 1`, `VERDICT: block` | `parseReviewReply` | `malformed === false`, `blockingIds` = `[B1]` |
| E18 | Severity routing (non-blocking only) | EP | L1 | automated | `issue(non-blocking): N1`, `BLOCKING_COUNT: 0`, `VERDICT: pass` | `parseReviewReply` | `malformed === false`, `blockingIds` = `[]` |
| E19 | Intent + generator (round 1, full) | EP | L1 | automated | fixture change dir: proposal, tasks, design, `specs/a`, `specs/b`, test-plan | `buildReviewPrompt({round:1})` | prompt contains all 6 paths, `origin/develop...HEAD`, the `review-code` rubric's `## Review Dimensions` heading, all 8 defect-class names, `BLOCKING_COUNT` + `VERDICT` trailer instructions, the fixed header line |
| E20 | Intent + generator (round 1, minimal) | EP | L1 | automated | fixture with only proposal + tasks | `buildReviewPrompt({round:1})` | prompt contains neither `design.md`, `test-plan.md` nor `specs/` |
| E21 | Generator (determinism) | EP | L1 | automated | identical input object, built twice | `buildReviewPrompt` ×2 | outputs byte-identical |
| E22 | Generator (no author assertion) | decision-table | L1 | automated | rounds {1,2,3} × ledger {none, present} × prior {none, present} | `buildReviewPrompt`, strip the unverified-records block | remainder matches none of `all (were\|findings were) fixed`, `third round`, `be precise`, `only report`, `final round`, `no further` (case-insensitive) |
| E23 | Generator (fence safety) | BVA | L1 | automated | ledger untestable reason containing "```", "````" and a copy of the block heading | `buildReviewPrompt({round:2})` | exactly one unverified-records heading; the full reason string lies inside its fence; fence length > longest backtick run in payload |
| E24 | Verification round (bounded prior) | EP | L1 | automated | prior reply ≈50 KB: `B1` + `B2` blocks and ≈45 KB non-blocking prose containing sentinel `ZZ_NONBLOCKING_SENTINEL`; `since: "a1b2c3d"` | `buildReviewPrompt({round:2})` | contains `B1` and `B2` block text and `a1b2c3d..HEAD`; does not contain the sentinel |
| E25 | Generator (no free-text input) | EP | L1 | automated | input cast with extra key `notes: "all findings were fixed"` | `buildReviewPrompt` | output does not contain `all findings were fixed` |
| E26 | Ledger protocol (complete) | EP | L1 | automated | `blockingIds [B1,B2]`; both entries complete; tests in `inDiff` | `validateFixLedger` | `{ok:true, missing:[], incomplete:[]}` |
| E27 | Ledger protocol (missing) | EP | L1 | automated | `blockingIds [B1,B2]`; entry only for `B1` | `validateFixLedger` | `ok:false`, `missing` = `[B2]` |
| E28 | Ledger protocol (test not in diff) | EP | L1 | automated | `B1.test.path` not in `inDiff` | `validateFixLedger` | `ok:false`, `incomplete` names `B1` |
| E29 | Ledger protocol (untestable reason) | BVA | L1 | automated | untestable reason of 19 chars, then 20 chars | `validateFixLedger` | 19 → `B1` incomplete; 20 → `ok:true` |
| E30 | Ledger protocol (sibling sweep) | EP | L1 | automated | `siblings.searched = ""`; then `"rg -n 'mtimeMs' packages/server"` with `sites: []` | `validateFixLedger` | empty → incomplete; recorded search with no sites → `ok:true` |
| E31 | Ledger protocol (verdict language, C1) | decision-table | L1 | automated | reasons: "this is already fixed in the round-1 commit" / "the race occurs only when the second request passes the lock check first"; search: `rg -w fixedIn` / "no further sites" | `validateFixLedger` | 1st → incomplete; 2nd → ok; `rg -w fixedIn` → ok; "no further sites" → incomplete |
| E32 | Ledger protocol (fixedIn shape) | BVA | L1 | automated | `fixedIn` ∈ {`abc123`, `abc1234`, `worktree`, `HEAD`} | `validateFixLedger` | 6-hex → incomplete; 7-hex → ok; `worktree` → ok; `HEAD` → incomplete |
| E33 | Ledger protocol (per round) | state-transition | L1 | automated | round-2 `blockingIds [B1]`; `fix-ledger-r1.json` has `B1`, `fix-ledger-r2.json` empty | CLI `--validate-ledger` for round 2 | exit ≠ 0, output lists `B1` missing |
| E34 | Derived state (rounds) | EP | L1 | automated | run dir `{review-r1.md, review-r2.md}`, no `approvals.log` | `deriveReviewState` | `{round:2, approvedExtraRounds:0, malformedRetries:0}` |
| E35 | Derived state (attempt ≠ round) | state-transition | L1 | automated | run dir `{review-r1.md, review-r2.attempt-1.md}` | `deriveReviewState` | `{round:1, malformedRetries:1}` |
| E36 | Derived state (approvals) | EP | L1 | automated | `{review-r1..r3.md}`, `approvals.log` with 1 line | `deriveReviewState` | `{round:3, approvedExtraRounds:1}` |
| E37 | Derived state (reviewer text ≠ approval) | EP | L1 | automated | `review-r2.md` body contains `APPROVAL: one-more-round`; no `approvals.log` | `deriveReviewState` | `approvedExtraRounds === 0` |
| E38 | Derived state (empty) | BVA | L1 | automated | missing run dir; empty run dir | `deriveReviewState` | `round === 0` for both, no throw |
| E39 | Derived state (ledger failures) | EP | L1 | automated | round 2 pending; 3 recorded validation failures for round 2, 1 for round 1 | `deriveReviewState` | `ledgerFailures === 3` |
| E40 | Ledger storage (outside VCS) | EP | L1 | automated | `gitDir=/r/.git/worktrees/os-x`, change `c`, run id `2026-10-01T10-00-00Z` | run-dir path helper | path starts with `/r/.git/worktrees/os-x/ship-it/c/2026-10-01T10-00-00Z`; contains no `openspec/changes` |

### Performance

None — no requirement states a latency/size threshold (boundedness of the
round-2 prompt is covered functionally by E24).

### Frontend-quirk

None — no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Generator CLI | fault-injection (bad input) | L1 | automated | `--change does-not-exist` | run CLI | exit ≠ 0; stderr names `does-not-exist` |
| X2 | Ledger CLI | fault-injection (incomplete) | L1 | automated | ledger missing `B2` | CLI `--validate-ledger` | exit 1; stdout lists `B2` under missing |
| X3 | State CLI | fault-injection (absent dir) | L1 | automated | `--state` on a nonexistent path | run CLI | exit 0; prints `round: 0` |
| X4 | Isolated reviewer | EP | L1 | automated | `.pi/agents/CodeReviewer.md` | parse frontmatter | `model: "@review"`, `inherit_context: false`, `tools` = exactly `read, grep, find, ls, bash` (no `edit`/`write`) |
| X5 | Isolated reviewer (only target) | EP | L1 | automated | ship-it `SKILL.md` step 4.5 section | read section | names `subagent_type: "CodeReviewer"`; no other `subagent_type` appears in 4.5 |
| X6 | Composition (4.5 procedure) | EP | L1 | automated | ship-it `SKILL.md` step 4.5 section | read section | contains the generator CLI command + "verbatim", `--state`, `--validate-ledger`, commit-before-round, harness + step-4.4 re-run after a review fix, malformed retry-once |
| X7 | Composition (preserved clauses) | EP | L1 | automated | ship-it `SKILL.md` step 4.5 section | read section | still contains `model: "@review"`, `REVIEW_TIMEOUT_MS`, the CodeRabbit exclusion, `assertNoWeakening` |
| X8 | Entry gate | state-transition | L1 | automated | ship-it `SKILL.md` step 1 section | read section | names `SHIP_IT_BLOCKED.md`; headless → exit non-zero; interactive → `ask_user` resume/abort; resume copies into the run dir then removes the file |
| X9 | Composition (Guardrails) | EP | L1 | automated | ship-it `SKILL.md` Guardrails | read section | states cap of two, +1 round per human approval, never renew own budget, boundary-reverse (step-5) escape; the old `/never a third round/` pin is replaced |
| X10 | Rubric classes + protocol | EP | L1 | automated | `packages/eng-disciplines/.pi/skills/review-code/SKILL.md` | read file | all 8 defect-class names; 4-step fix protocol inside "The Review → Fix Loop"; per-class sweep summary in Verification |
| X11 | Halt legible (ask failure) | fault-injection (abort) | L1 | automated | ship-it `SKILL.md` step 4.5 section | read section | states that a failing `ask_user` call is treated as headless and takes the escape hatch |
| M1 | Halt legible (live ask) | observation | — | manual-only | real interactive `ship-it` reaching the cap | human watches the run | one `ask_user` naming remaining `B` ids with two options; "one more" appends to `approvals.log`; exactly one extra round runs |
| M2 | Entry gate (live headless) | observation | — | manual-only | `pi -p` headless `ship-it` with `SHIP_IT_BLOCKED.md` present | human inspects the run | exits non-zero naming the file; no `Agent` review call in the transcript |
| M3 | Isolated reviewer (live spawn) | observation | — | manual-only | real `ship-it` step 4.5 | human inspects the session log | `Agent` call uses `subagent_type: "CodeReviewer"`; its prompt equals the CLI stdout; child transcript has no inherited parent snapshot |
| M4 | Verification round (live) | observation | — | manual-only | real round 2 after round-1 blocking findings | human reads the reply | each prior `B` id classified resolved / partial / unresolved with evidence |

---

## Coverage summary

- Requirements covered: 10/10 (local-review-gate: semantic review runs, REQUIRED role-aliased subagent, intent/generator, severity routing, halt legible, ledger protocol, rubric classes; ship-it-orchestrator: idempotent entry, red-test fix loop, steps 4.4/4.5 composition)
- Scenarios by class: edge 40 · perf 0 · frontend 0 · error 15
- Scenarios by level: L1 51 · L2 0 · L3 0 · — 4
- Scenarios by disposition: automated 51 · manual-only 4

## New infra needed

- none (all L1 rows land in the existing `.pi/skills/ship-it` vitest project)
