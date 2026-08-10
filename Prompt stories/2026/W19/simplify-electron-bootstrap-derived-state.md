---
session: 019e1236
week: 2026/W19
type: other
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [simplify-electron-bootstrap-derived-state]
proposal_excerpt: "The Electron bootstrap encodes startup decisions in `~/.pi-dashboard/mode.json` plus `isFirstRun()`. Both are persistent state that re-encodes facts already discoverable from the filesystem (`which pi`, `which pi-dash…"
---

# How we did it: Verify → archive → commit an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a status check: *"Proposal: simplify-electron-bootstrap-derived-state — What is the status?"* The real objective — clarified across the next four turns — was the **closeout half of an OpenSpec change**: confirm the implementation was actually done, run a strict verification of code against the artifacts, then archive the change (sync deltas into main specs) and land a **scoped** commit that touched *only* this change's files, leaving unrelated work in the tree untouched. Implementation was already complete; this session was the disciplined path from "code merged" to "change archived + committed."

## 2. TL;DR playbook

1. **Ask for status first**, don't assume. `openspec status --change <name> --json` → read `state`, `progress`, artifacts. Here: 83/83 tasks, only manual QA unchecked.
2. **Decide QA honestly.** The 7 unchecked items were all manual cross-platform smoke tests. The user said "QA pass" → mark them done (tested-later convention), don't fake-run them.
3. **Run strict verification** with the `openspec-verify-change` skill: does the *tree* implement every ADDED requirement? `openspec validate --strict` + spot-check the named symbols/files exist.
4. **Archive** via `openspec-archive-change`: `mkdir -p openspec/changes/archive`, move to `archive/<date>-<name>/`, and **delegate delta→main-spec sync to a subagent** (created 4 caps, modified `first-run-wizard`).
5. **Scope the commit.** `git status --short` first — the tree had unrelated honcho/plugin work. `git add` **only** the archive rename + new main specs + the modified spec; never `git add -A`.
6. **Commit + confirm the SHA.** `git log -1 --oneline` → tell the user the hash and explicitly note what stayed uncommitted.

## 3. How the collaboration unfolded

Four phases, ~28 minutes, 14 shell commands, 0 failures.

- **Phase 1 · Status triage.** The AI ran `openspec status --json` and `head`/`cat` on the proposal + tasks, then reported *implementation complete; QA pending* with the exact 7 unchecked manual-QA items enumerated. **Why it worked:** it separated "code done" from "checkboxes done" instead of declaring victory on progress alone.
- **Phase 2 · QA decision.** On the user's terse "QA pass", the AI marked all 7 manual QA tasks complete (the sole `edit` of the session, on `tasks.md`) — applying the project convention that manual cross-platform smoke is tested-later, not blocking archive. **Decision point:** the human owns the QA-pass call; the AI just records it.
- **Phase 3 · Strict verification.** Driven by the pasted `/opsx-verify` skill prompt, the AI produced a Completeness/Correctness/Coherence report: `state: all_done` (83/83), all 5 spec deltas present, every ADDED requirement's implementation file located on disk (`dashboard-starter.ts`, `bundle-extract.ts`, `SURVIVE_EXTRACT_DIRS` whitelist, etc.), and `validate --strict` green. **Why it worked:** correctness was proven by *finding the symbols in the tree*, not by trusting the checkboxes.
- **Phase 4 · Archive + scoped commit.** The `/opsx-archive` skill drove the move to `archive/2026-05-10-…/` and spawned a `general-purpose` subagent to sync deltas into main specs (ADD 4 caps, REMOVE 3 requirement blocks from `first-run-wizard`). Then `git status --short` revealed unrelated changes, so the AI hand-picked the paths to `git add`, committed `25916a80`, and reported the SHA plus a clear note that honcho/plugin work stayed uncommitted.

## 4. Prompts that worked

- **The goal prompt — "What is the status?"** A good, cheap kickoff: it forces the AI to inventory reality before acting. Reproduce it any time you resume an OpenSpec change — never assume where it left off.
- **"QA pass" (high-leverage, 2 words).** Unlocked the whole tasks.md closeout in one edit. Effective *because* the AI had already enumerated exactly which items that verb applied to, so the terse instruction was unambiguous.
- **Pasting the `/opsx-verify` and `/opsx-archive` skill prompts.** These carried the full procedure (status → load artifacts → validate → sync → archive), so the AI followed a known-good pipeline instead of improvising. Prefer invoking the named skills (`openspec-verify-change`, `openspec-archive-change`) directly next time.
- **"got commit" → (implicit) commit it.** Stronger version to reuse: *"Commit ONLY this archive's files; list anything you leave uncommitted."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after status report | "QA pass" | Say up front: "status, then close it out — verify, archive, commit" |
| Treat manual QA as a blocker | Explicit "QA pass" to mark tested-later | State the tested-later convention when unchecked items are manual smoke |
| Risk a broad `git add` in a dirty tree | (AI self-corrected on `git status`) | Always say "scope the commit to this change's files only" |
| Leave the outcome implicit | "got commit" | Ask for the SHA + a list of what stayed uncommitted |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session **consumed** existing OpenSpec skills rather than producing one. The reusable assets exercised:

- **`openspec-verify-change`** — proves the tree implements the artifacts (Completeness/Correctness/Coherence). Invoke before any archive so you never archive a spec the code doesn't match.
- **`openspec-archive-change`** — moves the change to `archive/<date>-<name>/` and syncs deltas into main specs, delegating the sync to an isolated subagent. Invoke when tasks are all done and verification is green.
- **The `general-purpose` sync subagent** — isolates the delta→main-spec merge (ADD/REMOVE requirement blocks) so that reasoning stays out of the main context. Effective because spec-sync is self-contained: deltas in, main specs out.

If you close out OpenSpec changes often, the *should-exist* skill is a single **"ship-openspec-change"** wrapper chaining verify → archive → scoped-commit → report-SHA — which is exactly the pipeline this session ran by hand.

## 7. Pitfalls & dead ends

- **Dirty working tree.** The repo had unrelated honcho/plugin edits. `git add -A` would have swept them into the archive commit. **If you hit a dirty tree, run `git status --short` and `git add` explicit paths** — never `-A`.
- **Pre-existing spec heading issue.** The sync subagent flagged `openspec/specs/first-run-wizard/spec.md` missing its `## Purpose` / `## Requirements` envelope. It predates this change and doesn't block `--strict`. **Don't fix drive-by** — note it as a follow-up, keep the commit scoped.
- **Checkbox ≠ done.** Progress `83/83` still left 7 manual-QA items; verify by locating symbols on disk, not by trusting the count.

## 8. Reproduce it faster — checklist

- [ ] `openspec status --change <name> --json` → confirm `state`, `progress`, artifacts.
- [ ] If only manual QA remains and the human says "QA pass", mark those tasks done (tested-later).
- [ ] Run `openspec-verify-change`: `validate --strict` + locate every ADDED requirement's file/symbol on disk.
- [ ] Run `openspec-archive-change`: move to `archive/<date>-<name>/`, delegate delta→main-spec sync to a subagent.
- [ ] `git status --short` → `git add` **only** the archive rename + new/modified main specs.
- [ ] Commit, then `git log -1 --oneline`; report the SHA and list what stayed uncommitted.

**Inputs to have ready:** the change name; a clean-enough tree or awareness of what else is uncommitted; the QA-pass call from the human.
**Artifacts produced:** `openspec/changes/archive/2026-05-10-simplify-electron-bootstrap-derived-state/`, synced main specs (4 new caps + modified `first-run-wizard`), commit `25916a80`.

---

_Generated from session `019e1236` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-10. Source extract: deterministic facts sheet._
