---
session: 019f397e
week: 2026/W28
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [finalize-event-dispatched-automation-runs]
proposal_excerpt: "Event-dispatched automation runs (`action.kind: flows.run`, which emits a `flow:run` event into the spawned session instead of seeding a prompt) never finalize. The archived `fix-automation-stop-zombie-runs` change ma…"
---

# How we did it: Finalize & archive an event-dispatched-automation-runs change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `Is this implemented?` — a status check on the OpenSpec change
`finalize-event-dispatched-automation-runs`. The *real* objective, once the follow-ups
landed (`archive and synch` → `commit` → `push`), was: **confirm the code matches the
marked task state, then take the change through the full landing pipeline** — sync the
delta specs into the main specs, archive the change, commit only the change-related
files, and push to `develop`. In short: a verify-then-land pass on an already-built
change, with a clean, scoped commit at the end.

## 2. TL;DR playbook

1. Ask the AI to **verify the marked state against the actual code** before trusting the
   checkboxes — grep the concrete symbols (`completion`, `ActionCompletion`,
   `runCompletion`, the Dockerfile line) the tasks claim exist.
2. Note any **unchecked task** (here, task 4.1 — a manual docker end-to-end verify) and
   surface it explicitly rather than silently treating the change as fully done.
3. **Sync delta specs into main specs first, then archive.** Read each
   `changes/<name>/specs/<cap>/spec.md` delta; append the `ADDED` requirements verbatim
   into `openspec/specs/<cap>/spec.md`.
4. Archive with `openspec archive <name> --yes --skip-specs` (specs already synced). If the
   validator blocks on a known repo-wide quirk, fall back to `--no-validate`.
5. `git status` + `git diff --stat` to **separate change-related files from unrelated
   churn** (board-state `groups.json`, stray skills, untracked scratch files).
6. `git add` **only** the archive rename + the synced main specs — never `git add -A`.
7. Commit with a message that lists exactly what was synced; `git push`.

## 3. How the collaboration unfolded

**Phase 1 — Verify the claim (Discovery).** On `Is this implemented?` the AI did not take
the tasks.md checkboxes at face value. It grepped the real symbols across `flows-plugin`
(`completion: { eventType: "flow_complete", … }`), `automation-plugin`
(`ActionCompletion` in `action-registry.ts`, `RunDispatch`/`emitEvent` in `engine.ts`,
`runCompletion` in `index.ts`), and the Dockerfile (`poppler-utils`). It concluded
*implemented but not verified* — code done, only task **4.1** (manual docker end-to-end)
outstanding. Why it worked: the check was grounded in source symbols, not the checklist.

**Phase 2 — Sync then archive (Land).** On `archive and synch` the AI followed the
dedicated openspec-archive skill. It read both delta specs, saw they were pure `ADDED`
requirements (no conflicts), and **synced them into the main specs before archiving** —
`automation-run-lifecycle` (two requirements about declaring and finalizing on the
completion event) and `docker-packaging` (poppler-utils). Then it archived with
`--skip-specs`, and when the validator tripped, fell back to `--no-validate`.

**Phase 3 — Scoped commit (Commit).** On `commit` the AI ran `git status` / `git diff
--stat` and spotted unrelated churn: `openspec/groups/groups.json` board-state, a
`manage-flows/SKILL.md` edit, untracked `b05_*.txt` scratch files. It staged **only** the
archive rename plus the two synced main specs, and wrote a commit message enumerating the
synced requirements. Decision point: the human's earlier "mark 4.1 done per my call" was
honored, but the AI still flagged that it remained unverified in a real container.

**Phase 4 — Push.** On `push`, `git push` → `develop` (`33b04ad90..f51f5a435`).

## 4. Prompts that worked

- **The goal prompt — `Is this implemented?`** Effective because it invited verification,
  not assertion. A stronger version: *"Verify the marked tasks against the actual code —
  grep the symbols each task claims, and tell me what's unverified."*
- **`archive and synch`** — a two-word unlock that triggered the whole sync-then-archive
  sequence via the openspec-archive skill. Effective because the skill encodes the correct
  order (sync deltas → main specs, then archive).
- **`commit` / `push`** — minimal high-leverage follow-ups. They worked *because the AI had
  already earned trust* by scoping the stage set; with a less disciplined agent, `commit`
  alone risks `git add -A`. Safer explicit version: *"commit only the archive + synced
  specs, leave board-state and scratch files untouched."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat tasks.md checkboxes as ground truth | Asking "Is this implemented?" (verify, not trust) | Always grep the claimed symbols before declaring a change done |
| Risk staging unrelated churn on a bare `commit` | Relying on the AI to self-scope (it did) | State "stage only change-related files" up front on any commit |
| Mark manual verify (4.1) done to keep moving | Operator called it done explicitly | Keep manual end-to-end tasks visibly flagged even when marked done |
| Hit the strict spec validator | Fall back to `--no-validate` | Know the repo-wide SHALL/MUST validator quirk (109/367 specs fail it) |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **consumed** an existing one: the
dedicated **openspec-archive skill**, which encodes the correct land order (sync delta
specs into main, then archive + move). It's effective because it removes the two most
common landing mistakes: archiving before syncing (losing the delta requirements) and
validating against a known-flaky check.

If anything should be captured, it's a short note (memory, project scope) that the
OpenSpec **spec validator has a repo-wide false-positive** on the SHALL/MUST check
(109 of 367 specs fail it), so `--no-validate` is the correct escape when the synced delta
text already contains SHALL. That would save the next operator the diagnosis loop.

## 7. Pitfalls & dead ends

- **Validator blocks a clean archive.** `openspec validate automation-run-lifecycle
  docker-packaging --specs` failed on the SHALL/MUST heuristic even though the text
  contains SHALL. → Archive with `--no-validate`; it's a known repo-wide quirk, not a real
  defect. `docker-packaging` validated clean on its own.
- **`git add -A` would have polluted the commit.** Unrelated `groups.json` board-state,
  `manage-flows/SKILL.md`, and untracked `b05_*.txt` were present. → Always `git status`
  first and stage explicit paths.
- **Checkbox drift.** A task marked done (4.1) was never actually run in a container. →
  Distinguish "code + unit tests done" from "manually verified"; keep the latter visible.

## 8. Reproduce it faster — checklist

- [ ] `openspec status --change <name>` — read task completion; note any unchecked manual tasks.
- [ ] Grep the concrete symbols each task claims (functions, config keys, Dockerfile lines) to confirm code matches the marks.
- [ ] Read each `changes/<name>/specs/<cap>/spec.md` delta; confirm `ADDED` (no conflicts).
- [ ] Append the `ADDED` requirements verbatim into `openspec/specs/<cap>/spec.md`.
- [ ] `openspec archive <name> --yes --skip-specs` (specs already synced); on validator quirk add `--no-validate`.
- [ ] `git status` + `git diff --stat`; identify unrelated churn.
- [ ] `git add` only the archive rename + synced main specs; commit with a message enumerating the synced requirements.
- [ ] `git push`.

**Inputs to have ready:** the change name, a clean-ish working tree (know your unrelated
churn), write access to `develop`. **Artifacts produced:** archived change under
`openspec/changes/archive/<date>-<name>/`, edits to
`openspec/specs/automation-run-lifecycle/spec.md` and
`openspec/specs/docker-packaging/spec.md`, one scoped commit, pushed to `develop`.

---

_Generated from session `019f397e` · `pi-agent-dashboard` · 2026-07-07. Source extract: session facts sheet (mktemp)._
