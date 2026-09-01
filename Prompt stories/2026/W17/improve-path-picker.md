---
session: 019da84d
week: 2026/W17
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-state-derivation, dashboard-openspec-card-state-and-actions, improve-path-picker]
---

# How we did it: Fixing OpenSpec state derivation on the dashboard card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`/opsx:explore`) — a thinking stance, no code.
The real objective surfaced immediately: the dashboard card for the `improve-path-picker`
change showed a state that didn't match reality. The CLI reported the change as
implementation-complete (Archive-ready), yet the card kept it stuck in an
`IMPLEMENTING`-style state because three unchecked **manual smoke-test** boxes
(`8.3/8.4/8.5 — "for user to verify"`) held the task count at 30/33. The ask became:
**make the dashboard's derived OpenSpec state honor the CLI's real completeness signal,
show that state on the card, and give the operator the right actions (tick tasks,
archive-anyway, bulk archive) in the right places.**

## 2. TL;DR playbook

1. Enter explore mode and **diff the two CLIs** for the same change:
   `openspec list --json` (gives `status` + `completed/total`) vs
   `openspec status --change <name> --json` (gives `isComplete` + per-artifact status).
   The mismatch is the whole story.
2. Trace where the dashboard **throws away** the CLI signal: `pollOpenSpecAsync`
   (`packages/shared/src/openspec-poller.ts`) and `deriveChangeState`
   (`packages/shared/src/types.ts`).
3. `create proposal` → `/opsx:ff` to scaffold all 4 artifacts for a first-cut change.
4. **Sanity-check the proposal against real data before trusting it** — ask "does this
   follow OpenSpec's actual states?" Probe `isComplete` across *several* real changes,
   not just the target one.
5. When the probe breaks your model (it will — `isComplete: true` at 0/75 tasks),
   **discard the flawed change** (`rm -rf openspec/changes/<name>`) rather than patching it.
6. Re-scope into a fresh change that captures all asks at once; regenerate 4/4 artifacts.
7. Map each user ask to a concrete UI/server artifact (StatePill, TasksPopover + toggle
   route, overflow archive-anyway menu, conditional Bulk Archive) in the proposal table.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI read the shared types + poller, then ran
the two OpenSpec CLIs side by side and produced a crisp mismatch table: `list.status =
in-progress`, `completed = 30/33`, but `status.isComplete = true` with all artifacts
`done`. It correctly localized the bug to `pollOpenSpecAsync` discarding `isComplete` and
`deriveChangeState` relying on task counts. *Why it worked:* the AI grounded the claim in
two real CLI outputs instead of reasoning about the code abstractly.

**Phase 2 — First proposal (`create proposal` → `/opsx:ff`).** The AI scaffolded
`fix-openspec-state-derivation` (proposal/design/specs/tasks, 4/4) proposing to carry
`isComplete` into `OpenSpecChange` and make it authoritative for the `COMPLETE` state.

**Phase 3 — Adversarial validation (the pivot).** The human asked *"Is it will follow
openspec possible states and operations?"* The AI re-probed `isComplete` across four real
changes and found the counter-example: `pi-log-miner-skill` had **0/75 tasks ticked but
`isComplete: true`**. `applyRequires: ["tasks"]` means *"the tasks.md artifact exists"*,
**not** *"all checkboxes ticked"*. The naive proposal would have shown Archive on a 0%
change. *Why it worked:* one skeptical prompt forced a data probe that invalidated the
design before any code was written.

**Phase 4 — Session state confirmation.** *"Check session which is not okay"* — the AI
dumped the live server's held state for session `019da559` and walked `deriveChangeState`
line-by-line to show exactly why the card renders `IMPLEMENTING` and hides Archive.

**Phase 5 — Re-scope + regenerate.** The human delivered the consolidated ask (show state
on card; tick tasks; archive-anyway; Bulk Archive only when OpenSpec not attached). The AI
**dropped the flawed change** and created `dashboard-openspec-card-state-and-actions` with
4/4 artifacts, mapping each ask to a component/route in a proposal table.

## 4. Prompts that worked

- **Goal prompt (`/opsx:explore`)** — starting in explore mode kept the AI investigating
  and drafting artifacts instead of prematurely writing code. Effective because the bug was
  a *data-model* conflict that needed diagnosis first.
- **`Is it will follow openspec possible states and operations?`** — the highest-leverage
  turn of the session. A single skeptical question triggered the multi-change probe that
  killed a wrong design. Reusable form: *"Validate this against real data across several
  cases before we commit."*
- **`Check session which is not okay`** — forced a concrete, per-line trace of the actual
  held state rather than a hand-wave.
- **`Both. And I would like to show openspec state in the card. … Bulk Archive … only on
  session where OpenSpec is not attached`** — a compact multi-requirement unlock that let
  the AI regenerate one coherent change covering everything.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust `isComplete` as "implementation done" from the target change alone | "Is it will follow openspec possible states and operations?" | Probe `isComplete` across ≥3 changes up front; know it means *tasks.md authored*, not *all boxes ticked* |
| Propose a fix and treat 4/4 artifacts as validated | Ask it to re-check against real data | State "validate the design against real CLI output before finalizing" in the goal |
| Patch the flawed proposal in place | (AI self-corrected) discard + fresh change | When a design's core assumption breaks, `rm -rf` the change and re-scope — don't layer fixes |
| Leave state derivation invisible on the card | "show openspec state in the card" | List UI-surfacing as an explicit requirement, not just the logic fix |
| Keep Bulk Archive everywhere | "only on session where OpenSpec is not attached" | Specify action placement/gating per card branch (attached vs unattached) |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. The clearly repeatable pattern worth
capturing:

- **A "validate-openspec-state-model" check** — before trusting any `deriveChangeState`
  change, run `openspec status --change <name> --json` across a spread of real changes
  (one complete, one 0-task-but-authored, one no-tasks, one mid-flight) and tabulate
  `list.status` × `completed/total` × `isComplete` × artifact statuses. This single table
  exposes the `isComplete` semantics and prevents the Archive-on-0% bug. Worth a project
  skill under `.pi/skills/`.

## 7. Pitfalls & dead ends

- **`isComplete` is a false friend.** It reflects *artifact authoring completeness*
  (`applyRequires` satisfied), **not** implementation. `pi-log-miner-skill` = `isComplete:
  true` at 0/75 tasks. Never route the Archive/COMPLETE state off `isComplete` alone.
- **First proposal was wrong.** `fix-openspec-state-derivation` was scaffolded 4/4 and then
  discarded — the design premise didn't survive the data probe. If your proposal's core
  assumption fails, delete the change rather than editing around it.
- **Two failed commands** were dead-end session lookups: `ls ~/.pi/dashboard/sessions/…`
  (wrong path) and a `dashboard-api.sh GET /api/sessions` pipe. The working probe is
  `curl -s http://localhost:8000/api/sessions` + a Python filter.
- **Manual-verification tasks hide Archive.** Smoke-test checkboxes marked "for user to
  verify" keep task counts below 100% forever; the state model must not treat them as
  blocking implementation-completeness.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** running dashboard on `:8000`, the OpenSpec CLI, and a target
change name whose card state looks wrong.

- [ ] Diff `openspec list --json` vs `openspec status --change <name> --json` for the change.
- [ ] Probe `isComplete` across ≥3 more changes (one 0-task-authored case) — build the table.
- [ ] Confirm the semantics: `isComplete` = tasks.md authored, **not** all boxes ticked.
- [ ] Trace `pollOpenSpecAsync` (`packages/shared/src/openspec-poller.ts`) +
      `deriveChangeState` (`packages/shared/src/types.ts`) for where the signal is dropped.
- [ ] Dump live server state: `curl -s http://localhost:8000/api/sessions` + filter by id.
- [ ] Scaffold the change (`create proposal` → `/opsx:ff`); if the premise breaks, `rm -rf`
      and re-scope one clean change.
- [ ] In the proposal, map each ask → concrete artifact (StatePill, TasksPopover + `POST
      /api/openspec/tasks/toggle`, overflow archive-anyway menu, conditional Bulk Archive).

**Artifacts produced:** `openspec/changes/dashboard-openspec-card-state-and-actions/`
(proposal.md, design.md, specs/openspec-task-toggle/spec.md,
specs/openspec-attach-combo/spec.md, tasks.md).

---

_Generated from session `019da84d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-20. Source extract: deterministic facts sheet._
