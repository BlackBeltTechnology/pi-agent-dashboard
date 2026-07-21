# How we did it: Clean up a stray OpenSpec duplicate — an AI collaboration guideline

> A reusable playbook reconstructed from session `019f6c7a`. It explains how to
> **diagnose OpenSpec state anomalies** (a change showing as active when it's already
> archived) and clean them up safely without losing work.

---

## 1. Goal (the ask)

The user asked: *"Check this, it may be implemented"* — referring to the OpenSpec change
`add-dashboard-bus-client-scripting`, which showed tasks unchecked but appeared in the
active list. The real question was: **Is this change actually done in the codebase, or
does it still need work?**

What unfolded was a **diagnosis and cleanup** task: the change was already fully
implemented and merged (PR #341), but a bookkeeping artifact left it appearing as an
active "incomplete" change. The session became about verifying the implementation was
real, confirming the archive state, and safely removing the duplicate.

---

## 2. TL;DR playbook

If you inherit an OpenSpec change that looks "incomplete" (unchecked tasks) but claims
to be "Complete" in `openspec status`:

1. **List the change directory:** `ls -la openspec/changes/<name>/` and
   `ls -la openspec/changes/archive/<timestamp>-<name>/` to see if both exist.
2. **Check for a matching archive.** If both exist, they may be duplicates from a PR
   that committed the change into both locations without removing the active copy.
3. **Verify the implementation is real** (don't assume stale):
   - Run the package tests: `npx vitest run packages/<name>` (should be green).
   - Check the codebase for the key deliverables named in `tasks.md`.
   - Run E2E: `npm run test:e2e <pattern>` if the change has a spec.
4. **Compare the two copies** (if both exist):
   ```bash
   diff -rq openspec/changes/add-dashboard-bus-client-scripting/ \
             openspec/changes/archive/2026-07-16-add-dashboard-bus-client-scripting/
   ```
   If identical (or near-identical), the active copy is a stray duplicate.
5. **Confirm the archived copy is authoritative:**
   - All tasks in the archive are checked: `grep '^- \[x\]' archive/<...>/tasks.md | wc -l`
   - The main spec is synced: `diff openspec/specs/<name>/spec.md archive/<...>/specs/...`
6. **Remove the stray active copy:**
   ```bash
   git rm -rf openspec/changes/<name>/
   git commit -m "chore(openspec): remove stray active copy of archived <name>"
   ```
7. **Verify:** `openspec list` should no longer show the change as active.

---

## 3. How the collaboration unfolded

### Phase 1: Diagnosis (commands 1–5)

The AI started by exploring the codebase structure. The user's vague prompt ("check
this") meant the AI had to first *understand the landscape* before answering. It ran:

- Directory listings for `packages/bus-client/` (exists, is tracked in git).
- Git log on that package (commit `3792cdade` landed it in PR #341).
- Grepped for references in Tier 1 skills (`dashboard-api.sh`, `debug-dashboard`).

**Why this worked:** The AI didn't jump to conclusions. It gathered evidence first:
bus-client exists, is committed, is in multiple skill scripts. That ruled out "not yet
implemented" immediately. The vague prompt ("may implemented") actually meant the AI
needed to build a picture before answering.

### Phase 2: Verification of implementation (commands 6–8)

The AI ran the bus-client test suite: **17/17 passing**. This was the critical signal
that the implementation is live and working, not stale.

**Why this worked:** Instead of just checking file presence, the AI tested the code.
Tests are the ground truth — if they pass, the feature works. This prevented the false
conclusion "files exist but the code doesn't work" and grounded the diagnosis in reality.

### Phase 3: OpenSpec state inspection (commands 9–12)

The AI examined the OpenSpec artifact itself:

- Listed E2E specs and qa tests (all present, all green).
- Ran `openspec status` to see the overall state.
- Checked delta vs main specs for sync state.

**Why this worked:** The AI didn't just look at git; it read the OpenSpec metadata.
The `status` output revealed: all tasks are *marked* Complete, but `tasks.md` shows
unchecked boxes — a red flag. The AI then pivoted to: "something is inconsistent."

### Phase 4: Root cause — the duplicate (commands 13–15)

The AI discovered that **both** exist:
- `openspec/changes/add-dashboard-bus-client-scripting/` (the stray active copy, unchecked tasks)
- `openspec/changes/archive/2026-07-16-add-dashboard-bus-client-scripting/` (the archived copy, all tasks checked)

A `diff -rq` showed them identical except for the tasks.md checkbox state. The
**root cause**: PR #341 committed the change into both locations and never cleaned up
the active copy.

**Why this worked:** The AI didn't assume stale data. It compared the *actual files*
and found they were duplicates. This avoided the trap of assuming the archive was old
or the active copy was a newer iteration.

### Phase 5: Safe removal (commands 16–18)

The user steered: *"commit"* — confirming the AI's diagnosis. The AI then:

1. `git rm -r` the stray active copy (forced, since local edits to tasks.md were in the way).
2. Staged only the deletions: `git diff --cached` to verify.
3. Committed with a clear message explaining the artifact.

**Why this worked:** The AI staged *only* the deletions, leaving unrelated working-tree
changes (groups.json, package-lock.json, live-server-proxy.ts) untouched. This kept
the commit focused and saved the user from manually untangling files.

---

## 4. Prompts that worked

| Prompt | Why it was effective |
|--------|-----|
| *"check this, it may implemented"* (Goal) | Vague enough to force the AI to discover the landscape, but specific enough (the change name is there) to guide exploration. The AI couldn't assume anything and had to build a complete picture. |
| *"commit"* (Steering) | A one-word confirmation that moved the work from diagnosis to execution. The AI had already proposed the fix clearly; this unlocked the commit. Efficient. |

**Stronger versions for next time:**

- **For diagnosis:** *"I found this OpenSpec change in my active list with unchecked tasks. Can you verify it's actually done in the codebase and fix any state issues?"* (More explicit about the symptom.)
- **For commit:** Same — one word is sufficient once the diagnosis is agreed.

---

## 5. Steering & corrections (what to watch for)

This session had minimal steering — only one word ("commit") — because the AI's
diagnosis was sound and the fix obvious. No guardrails were needed.

**However, a future operator should be aware:**

| The AI might… | To steer, say… | To prevent next time, bake in… |
|---|---|---|
| Over-assume old/stale code when specs are checked but tasks aren't | "run the tests to verify it's not just ghost metadata" | Always run tests before deciding an implementation is stale. Test results beat task-checklist state. |
| Hesitate to remove "duplicate" directories if one is newer-looking | "the archive dir is authoritative once specs are synced; the active copy is the stray one to remove" | Always `diff -rq` before deciding which copy is authoritative. Content identity beats timestamp. |
| Leave unrelated changes staged alongside the cleanup | "stage and commit only the deletions, leave working-tree changes out" | Always `git status` and manually pick what to stage: `git add <path>` for each file. Use `--staged` to verify before commit. |

---

## 6. Skills, tools & memory created — and why they're effective

**No skills were created in this session.** The work was diagnostic and cleanup — a
one-off for this artifact. However:

**Opportunity for a reusable skill:** If this pattern recurs (stray duplicates
appearing after PRs that archive changes), a small automation could help:

- A skill that runs `openspec list --active` and compares each active change against
  its archive; flags duplicates and optionally removes them.
- Why it would be effective: Catches the pattern automatically during a release
  checklist or nightly CI run, so humans never see stray duplicates in the first place.

**Memories:** None created, but the session itself is a template for how to diagnose
OpenSpec anomalies safely.

---

## 7. Pitfalls & dead ends

| What went wrong | What we did | Lesson |
|---|---|---|
| `git rm` blocked: local edit to `tasks.md` (the AI had marked checkboxes) conflicted with the rm. | Used `git rm -rf` (force) to delete anyway, then relied on the archived copy's tasks.md. | When removing a directory, don't edit files inside it first. The archive is authoritative — trust it and remove cleanly. |
| One `openspec` command failed (no `find` in the delta spec dir). | Skipped it and moved to `grep`. | Not all delta specs may have a `specs/` subdir if the change is modifications-only; check the directory tree first. |

---

## 8. Reproduce it faster — checklist

**Inputs:**
- The OpenSpec change name (e.g., `add-dashboard-bus-client-scripting`).
- The cwd (this project, `/Users/robson/Project/pi-agent-dashboard`).
- Git access to see PR history and commits.

**Steps:**

- [ ] Run `ls -la openspec/changes/<name>/ openspec/changes/archive/` to see if both exist.
- [ ] `diff -rq` to check if they're duplicates.
- [ ] `npx vitest run packages/<name>` to verify tests pass.
- [ ] `grep -c '^- \[x\]' openspec/changes/archive/<name>/tasks.md` to confirm archive has all tasks checked.
- [ ] `git rm -rf openspec/changes/<name>/` to remove the stray active copy.
- [ ] `git status` to verify only the deletions are staged.
- [ ] `git commit -m "chore(openspec): remove stray active copy of archived <name>"`.
- [ ] `openspec list --json | jq '.[] | select(.name == "<name>")'` to confirm it no longer appears.

**Artifacts:**
- Commit hash removing the duplicate (e.g., `8558bfadf`).
- Clean `openspec list` output (no stray entry).

---

*Generated from session `019f6c7a-0d69-7781-b3b9-673bcf51ab09` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-16. Duration: 15m 12s. Cost: $2.05. Source extract: `/tmp/facts_019f6c7a.md`.*
