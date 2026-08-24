---
session: 019f868e
week: 2026/W30
type: planning
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 4 memory(ies); heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-goal-detail-turns-and-spend, persist-goal-status-and-progress]
proposal_excerpt: "The goal detail page shows no execution statistics once the loop is not live, and never shows spend at all. Reproduced on a completed goal (`achieved`, 1 turn):"
---

# How we did it: From a "test goal" smoke test to a strict-validated OpenSpec plan — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was deliberately small: *"Create a versy simple test goal with @fast model to test a goal execution."* The user wanted a smoke test — spin up a dashboard goal, drive it with a cheap model, confirm the goal-execution loop actually reaches `achieved`.

But the **real** objective emerged through steering. The smoke test surfaced a UI bug (a screenshot of a completed goal showing `—/3` turns and blank spend), and the session pivoted into a full diagnosis and then a **strict-validated OpenSpec planning change** (`fix-goal-detail-turns-and-spend`) — proposal + design + spec + tasks + test-plan, hardened by a two-cycle cross-model doubt review. The one-line ask became: *prove the loop works, find why the detail page lies about turns/spend, and plan the fix to house standard.*

## 2. TL;DR playbook

1. **Create + spawn the goal via the REST API**, not the UI: `POST /api/folders/goals?cwd=$CWD` then `POST /api/folders/goals/:id/sessions?cwd=$CWD {spawn:true, model}`. Give it a trivially verifiable objective ("Write DONE into /tmp/goal-exec-test.txt", maxTurns 3).
2. **When the driver never registers, don't retry blindly** — read the newest keeper log (`~/.pi/dashboard/sessions/keeper-*.log`). It will show `pi --mode rpc --model @fast` exiting code=1.
3. **Expand the role alias before spawning.** Headless `pi --mode rpc` does NOT resolve `@fast`; pass the concrete `provider/modelId` (here `deepseek/deepseek-v4-flash`). Re-spawn → goal flips to `achieved`, target file contains `DONE`.
4. **Diagnose the UI bug by tracing the data, not the pixels.** Fetch the full persisted `GoalRecord` (`GET /api/folders/goals?cwd=$CWD` + `jq`). Confirm the data IS there (`lastKnownTurnsUsed: 1`) → it's a client display bug, not a persistence bug.
5. **Separate "display bug" from "feature gap."** Turns = client reads only the live `snap` and never falls back to the persisted record. Spend = no spend number is produced anywhere. Save both findings to project memory.
6. **Before proposing Spend, prove feasibility from source**: `DashboardSession` already carries `cost` (`types.ts:101`, populated `0.29` on the driver session) → spend is a read-time Σ over linked sessions, no projector needed.
7. **Draft the OpenSpec change** matching the nearest archived precedent's format; `openspec validate <name> --strict` until clean.
8. **Run `plan-proposal`**: doubt-review (single-model + auto cross-model `@propose-review-1`), then `scenario-design` → `test-plan.md` manifest → fold every automated row into `tasks.md`, then commit scoped to the change dir and STOP at the worktree boundary.

## 3. How the collaboration unfolded

**Phase 1 — Smoke test (Discovery).** The AI created a goal and spawned a `@fast` driver via the REST API, then polled for the linked session. Nothing registered. **Why it worked:** it treated "spawn accepted but no session" as a known failure class (spawn-register-timeout) and consulted the diagnosis skill rather than re-POSTing.

**Phase 2 — Root-cause the crash (Debug).** It read the newest keeper log, saw `pi --mode rpc --model @fast` exit code=1, and reproduced the crash manually: `Model "@fast" not found`. **Decision point:** expand `@fast` → `deepseek/deepseek-v4-flash` and re-spawn. Goal reached `achieved`; `/tmp/goal-exec-test.txt` held `DONE`. The quirk was saved to memory immediately.

**Phase 3 — The UI lies (Diagnosis).** The user posted a screenshot: `t1 satisfied` in the verdict timeline but `—/3` turns and empty spend. The AI traced the projector and the persisted record, discovering the turn data DID persist (`lastKnownTurnsUsed: 1`) — so `GoalDetailClaim.tsx:211` renders turns only from the live `snap=deriveSnapshot(driverEvents)`, which goes `null` once the driver ends. Spend, by contrast, is never produced at all. **Why it worked:** it distinguished a *client display bug* (data exists, UI ignores it) from a *feature gap* (no data source), which later shaped a two-part proposal with different fix strategies.

**Phase 4 — Feasibility + draft (Design).** Prompted with `propose`, the AI first verified `DashboardSession.cost` exists and is populated, studied the archived `persist-goal-status-and-progress` change for house format, drafted the change, and strict-validated it.

**Phase 5 — Harden via plan-proposal (Verify).** The user invoked the `plan-proposal` skill. The AI ran a **two-cycle doubt review** with an automatic cross-model reviewer (`@propose-review-1` = glm-5.2). This wasn't theater — it caught a second undecorated delivery path (WS `goals_update` broadcast), a wrong type name (`SessionRecord` → `DashboardSession`), a board-surface parity gap, and a cache-aliasing hazard that forced a **pure** decorate helper. Then `scenario-design` produced an 18-row all-automated `test-plan.md`, folded 18→18 into `tasks.md`, and committed scoped to the change dir, stopping at the worktree boundary.

## 4. Prompts that worked

- **Goal prompt** — *"Create a versy simple test goal with @fast model to test a goal execution."* Effective because it named the model and a concrete, verifiable outcome (goal execution). Stronger version: *"...test goal that writes DONE to a tmp file, maxTurns 3, and confirm it reaches `achieved`."* — bake the pass/fail check into the ask.
- **High-leverage follow-up: the screenshot + one line** — *"The goal does not shows execution statistics and spend [image]."* A screenshot of the exact broken panel is worth paragraphs; it anchored the AI on the precise component.
- **`propose`** — a one-word unlock that converted a diagnosis into a full OpenSpec change. Works because the diagnosis phase had already established the two-part root cause.
- **Pasting the `plan-proposal` skill body** — invoking the orchestration by name/skill triggered the doubt-review + scenario-design + fold discipline without the operator spelling out each step.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Spawn `@fast` verbatim and wait/retry when nothing registered | (implicit) the crash forced the fix — but retry-blind wasted ~1 min | State up front: dashboard role aliases must be expanded to `provider/modelId` before headless spawn (memory now saved) |
| Stop at the smoke-test summary | *"The goal does not shows execution statistics and spend [image]"* | Treat a green loop test as incomplete until the detail page renders the stats it just produced |
| Offer to code the fix | *"propose"* — keep it to a planned change, no code | Ask whether the outcome is a fix or a plan before editing source |
| Assume the canvas panel was visible | *"I don't see canvas"* | Canvas is a dashboard-only panel; always also give the on-disk file paths, never rely on canvas alone |
| Accept its own draft as done | invoking `plan-proposal` (doubt-review) | Route non-trivial proposals through doubt-review + scenario-design before calling them done |

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **4 memories** were saved — the reusable assets of this session:

- **Role-alias-not-resolved-in-headless-spawn (×2, tool-quirk/failure).** Dashboard goal/session spawn passes `model` VERBATIM to `pi --mode rpc --model <X>`; a bare headless pi does NOT resolve `@fast` → `Model "@fast" not found`, keeper exits code=1, no session. *Why effective:* this is the single gotcha that blocks every goal-execution test; recording it turns a 5-minute debug into a 0-second recall.
- **Turns display bug (project).** `GoalDetailClaim.tsx:~211` renders turns only from live `snap=deriveSnapshot(driverEvents)`; once the driver session ends `snap=null` → `—/maxTurns` even though the record has `lastKnownTurnsUsed`. *Why effective:* pins the exact file/line and the correct fix (fall back to the persisted field).
- **Spend feature gap (project).** No spend number is produced anywhere; the projector never reads spend and `GoalRecord` has no spend field; the UI only shows the cap. But `DashboardSession.cost` is durable → spend is a read-time Σ. *Why effective:* records both the gap and the feasible fix path so the next session skips re-discovery.

**Skill that should exist:** a `goal-exec-smoke-test` skill capturing the create→spawn(concrete ref)→poll→verify-file loop, since the alias-expansion trap will bite anyone who tries `@fast` again.

## 7. Pitfalls & dead ends

- **`@fast` in a headless spawn crashes pi code=1.** If a goal driver never registers, read `~/.pi/dashboard/sessions/keeper-*.log` and expand the alias to `provider/modelId` before re-spawning.
- **Querying the wrong record fields.** An early `jq '.turnsUsed'` returned nothing — the record fields are `lastKnownTurnsUsed` / `totalTurnsUsed`. Fetch the FULL record first, then read the real field names.
- **Trusting the canvas.** The canvas panel is dashboard-only and may not be on the operator's view — always print the on-disk paths too.
- **Doubt-review factual disputes.** The cross-model reviewer claimed `cost` was only replayed, not persisted. Resolve such disputes by reading source (`session-to-meta.ts:36` maps it, `session-scanner.ts:84` reads it back) rather than picking a reviewer to believe.
- **Cache-aliasing in decorate helpers.** `create/update/linkSession` return records aliased into the store cache; an in-place mutation would persist a "non-persisted" field. Mandate a PURE helper (`g => ({...g, totalSpendUsd})`) on all paths.
- **Committing WIP that isn't yours.** `develop` had unrelated modified files; stage ONLY the change dir (`git add openspec/changes/<name>/`).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** dashboard server up (`GET /api/health` → `mode`), `$CWD` = project root, a concrete model ref (expand `@fast` → `deepseek/deepseek-v4-flash` via `list_roles`).

- [ ] `POST /api/folders/goals?cwd=$CWD` with a file-write objective + `maxTurns 3`.
- [ ] `POST /api/folders/goals/:id/sessions?cwd=$CWD {spawn:true, model:"<provider/modelId>"}` — concrete ref, NOT `@fast`.
- [ ] Poll `GET /api/folders/goals?cwd=$CWD`; on no-register, read newest `keeper-*.log`.
- [ ] Verify goal `achieved` + target file contents.
- [ ] For UI bugs, fetch the FULL `GoalRecord` and confirm data presence before blaming persistence.
- [ ] `openspec validate <change> --strict` until clean.
- [ ] Run `plan-proposal`: doubt-review (cross-model) → `scenario-design` → fold `test-plan.md` into `tasks.md` → commit scoped → stop at worktree boundary.

**Artifacts produced:** `openspec/changes/fix-goal-detail-turns-and-spend/{proposal,design,tasks,test-plan}.md` + `specs/goal-detail-stats/spec.md` (3 requirements, ~14 scenarios; 18 automated rows folded), committed to `develop` at `e89703d4b`. Test goal `dcf86d69` (`achieved`) + `/tmp/goal-exec-test.txt` (`DONE`).

---

_Generated from session `019f868e-12de-7977-aacc-49a9c12def45` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/session_facts_uFkgcl.md`._
