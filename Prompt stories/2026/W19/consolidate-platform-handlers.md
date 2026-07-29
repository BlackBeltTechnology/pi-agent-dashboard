---
session: 019e0f61
week: 2026/W19
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [electron-platform-extraction, consolidate-platform-handlers]
proposal_excerpt: "Step 6 of `consolidate-platform-handlers` was deferred with explicit rationale: the Electron-API-bound platform branches (tray icon, app menu, bundled Node path, app-lifecycle hooks) deserved their own review cycle pl…"
---

# How we did it: Verifying a proposal against code, then carving out the deferred remainder — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a verification request, not a build request:

> *"Proposal: consolidate-platform-handlers. Rechek that the proposal is fulfill the current state of code"*

The real objective, once the steering turns clarified it, was three-staged: **(1)** confirm the `consolidate-platform-handlers` OpenSpec change actually matches the shipped code; **(2)** identify what the change deliberately *deferred* (Step 6 — the Electron-API-bound platform branches); and **(3)** promote that deferred remainder into its own first-class follow-up change (`electron-platform-extraction`) with full artifacts, then reconcile the parent change's task list and commit only the new work. It went from "audit a proposal" to "close the loop on a deferral" in six short steering turns.

## 2. TL;DR playbook

1. **Audit before you build.** Prompt: *"Recheck that proposal `<name>` fulfills the current state of code."* Let the AI grep each proposal step against real files and return a per-step ✅/⏸️ status table.
2. **Ask what's left.** Prompt: *"Which deferred tasks are still missing?"* Force the AI to isolate the *deferred* scope (here: Step 6) from the *done* scope, with source-line citations for each remaining extraction.
3. **Spin up a follow-up change** for the deferred remainder: `openspec new change "<follow-up-name>"`.
4. **Drive the artifacts in order** — proposal → design + specs → tasks — approving each with a terse `1` / `yes` at the offered decision points. Validate with `openspec validate <name> --strict`.
5. **Reconcile the parent.** Prompt: *"In proposal `<parent>` set the deferred tasks to done."* Rewrite the "Deferred" preamble to "Carved out into follow-up change" and check each sub-task with a cross-reference to the new change's task ids.
6. **Commit surgically.** Prompt: *"commit"* — but stage *only* the files this conversation touched, never `git add -A`, because the working tree held unrelated in-progress work.

## 3. How the collaboration unfolded

**Phase 1 — Verification audit (Discovery).** The AI ran a battery of `grep`/`ls` probes (`resolveJitiFromAnchor`, `tool-resolver`, `process.platform` branches, `platform/` in `AGENTS.md` and `docs/architecture.md`) to map each of the 8 proposal steps onto real files. It returned a per-step status table: 7 steps ✅, Step 6 ⏸️ deferred, and even flagged *bonus* scope where `packages/shared/src/platform/` had grown beyond the proposal. **Why it worked:** the AI treated the proposal as a checklist and cited a concrete file/line for every verdict — no hand-waving.

**Phase 2 — Isolate the deferral.** Steering prompt #1 ("Which is missing to be the deferred tasks implemented?") pushed the AI to enumerate Step 6's four narrow `process.platform` branches (tray icon, app menu, bundled-node path, app-lifecycle hooks) with source locations and an effort estimate, and to name the *real* gating concern: the manual Electron smoke build that caused the deferral in the first place.

**Phase 3 — Generate the follow-up change.** A single `yes` unlocked `openspec new change electron-platform-extraction`. The AI then walked the OpenSpec artifact ladder — proposal → design (6 decisions D1–D6) → specs (8 requirements, 16 scenarios) → tasks (8 groups, ~25 tasks) — pausing at each `openspec instructions` gate and offering a numbered menu; the operator answered `1` twice to say "continue and write everything." Each artifact was validated (`--strict`) before moving on.

**Phase 4 — Reconcile the parent.** Prompt #5 ("set the deferred tasks to done") had the AI edit `consolidate-platform-handlers/tasks.md`: rewrite the "Deferred" preamble to "Carved out into follow-up change" and check 6.1–6.7, each with a `→` cross-reference to the new change's task ids. `openspec validate` confirmed the parent was now 4/4 complete.

**Phase 5 — Surgical commit (13h later).** Prompt #6 ("commit") arrived after a long gap. The AI discovered the working tree had unrelated "honcho" changes and — critically — that the parent change had been *archived between turns* (to `openspec/changes/archive/2026-05-10-consolidate-platform-handlers/`) by another agent/jj snapshot. It staged only the new `electron-platform-extraction/` files, landing commit `85334083` (5 files, 340 insertions) without disturbing anything else.

## 4. Prompts that worked

- **The goal prompt** — *"Recheck that the proposal fulfills the current state of code."* Effective because it framed the task as **audit-against-reality**, which forces the AI to open files and grep rather than trust the proposal's own prose. Stronger phrasing to reuse: *"Verify each step of proposal `<name>` against the current code; return a per-step status table with a file/line citation for every verdict, and flag any deferred or out-of-scope work."*
- **High-leverage follow-up** — *"Which is missing to be the deferred tasks implemented?"* One question turned a passive audit into an actionable remainder list with effort estimates.
- **The unlock prompts** — `yes`, `1`, `1`. These terse approvals at the AI's offered decision menus are the OpenSpec fast-path: the AI proposes "1. continue and write everything / 2. write one, you review / 3. stop," and a single digit keeps momentum without re-typing intent.
- **The reconciliation prompt** — *"In proposal `<parent>` set the deferred tasks to done."* Explicit about *which* change and *what* state, so the AI didn't have to guess whether "done" meant delete, check, or annotate.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Report the audit and stop | "Which deferred tasks are still missing?" | State up front: *"audit AND enumerate the remaining/deferred work with source citations."* |
| Offer a decision menu and wait | Answering `1` / `yes` to say "do all of it" | Kick off with *"generate all OpenSpec artifacts (proposal→design→specs→tasks) without pausing; validate `--strict` at the end."* |
| Leave the parent change's deferral note stale | "Set the deferred tasks to done" | Ask for the parent reconciliation in the same breath as spinning up the follow-up change. |
| Reach for a broad `git add` on a dirty tree | (Implicit) — the AI self-corrected on discovering unrelated "honcho" changes | State *"commit ONLY the files from this conversation; never `git add -A` — the working tree has unrelated work."* |

The standout guardrail: **when the working tree is shared/dirty, commits must be file-scoped.** The AI also had to cope with the parent change being *archived between turns* by another actor — a good reminder that in a multi-agent repo, re-verify filesystem state right before committing rather than trusting your earlier view.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created in this session. The workflow, however, is clearly repeatable and worth a skill:

**Recommended skill — `carve-out-deferred-change`:** given a proposal with a deferred step, (1) verify the parent against code, (2) enumerate the deferred remainder with source citations, (3) `openspec new change` for it and drive proposal→design→specs→tasks non-interactively, (4) rewrite the parent's deferral preamble to "Carved out into follow-up change" and check its sub-tasks with cross-references, (5) commit only the new change's files. This removes the repeated hand-holding through the OpenSpec artifact ladder and codifies the "reconcile the parent + surgical commit" tail that a naive run forgets.

The session leaned on existing OpenSpec tooling — `openspec new change`, `openspec instructions <artifact>`, `openspec status`, `openspec validate --strict` — which already make the artifact ladder reproducible; the missing piece is the orchestration around it.

## 7. Pitfalls & dead ends

- **`ls` on not-yet-created directories fails loudly.** Early probes for `packages/electron/src/platform/` and `packages/shared/src/platform/` returned errors (3 failed commands) — expected, since the whole point was that the directory *didn't exist yet*. If you're verifying absence, `ls … 2>&1` and read the error as a signal, don't treat it as a blocker.
- **A broad `git add` on a shared working tree is a trap.** The first staging attempt failed / was too wide; the fix was to `git add` only the `electron-platform-extraction/` path. If you hit unrelated changes in `git status`, stage by explicit path.
- **Changes can be archived between turns in a multi-agent repo.** The parent `consolidate-platform-handlers` moved to `openspec/changes/archive/2026-05-10-…/` mid-session. If your earlier edits "disappear," check the archive path (`openspec/changes/archive/<date>-<name>/`) before re-editing — the edits were already committed there.
- **Long real-time gaps (13h here) mean stale assumptions.** Re-run `git status` / `find` to reconcile reality before the commit rather than acting on a view from hours ago.

## 8. Reproduce it faster — checklist

- [ ] **Audit:** *"Verify each step of proposal `<name>` against current code; per-step status table + file/line citations; flag deferred/out-of-scope work."*
- [ ] **Enumerate the deferral:** *"List the remaining/deferred tasks with source locations and the real gating concern."*
- [ ] **Spin up follow-up:** `openspec new change "<follow-up-name>"`.
- [ ] **Drive artifacts non-interactively:** *"Write proposal→design→specs→tasks; validate `openspec validate <name> --strict` at the end."*
- [ ] **Reconcile parent:** *"In `<parent>/tasks.md`, rewrite the Deferred note to 'Carved out into follow-up change' and check each sub-task with a cross-reference to the new change's task ids."* Then `openspec validate <parent>`.
- [ ] **Commit surgically:** stage ONLY this change's files (`git add openspec/changes/<follow-up-name>/`), never `-A`; re-run `git status` first if the tree is dirty or time has passed.

**Key inputs to have ready:** the parent OpenSpec change name, write access to `openspec/changes/`, the `openspec` CLI, and a clean sense of which files belong to *this* task (for the surgical commit).

**Final artifacts produced:**
- `openspec/changes/electron-platform-extraction/proposal.md`
- `openspec/changes/electron-platform-extraction/design.md`
- `openspec/changes/electron-platform-extraction/specs/electron-platform-primitives/spec.md`
- `openspec/changes/electron-platform-extraction/tasks.md`
- edited `openspec/changes/consolidate-platform-handlers/tasks.md` (now in the archive)
- commit `85334083` on `develop` (5 files, 340 insertions)

---

_Generated from session `019e0f61` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-10. Source extract: deterministic facts sheet via `extract_session.ts`._
