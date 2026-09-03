---
session: 019e0c91
week: 2026/W19
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [redesign-session-card-subcards]
proposal_excerpt: "The session card has accreted many independent feature areas (OpenSpec, workspace/jj, processes, memory, flows) that currently render as a flat sequence of rows separated only by tiny dividers. Visual hierarchy is wea…"
---

# How we did it: Verify → fix → archive the redesign-session-card-subcards change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user ran `/opsx:verify` on the `redesign-session-card-subcards` OpenSpec change: confirm that the *implementation actually matches the artifacts* (proposal, design, tasks, delta specs) before closing it out. The redesign itself had grouped the flat session-card rows (OpenSpec, workspace/jj, processes, memory, flows) into translucent `SessionSubcard` panels with capsule legends. The real objective across the whole session was the **full close-out ritual**: verify the code matches the spec, fix any drift the verification surfaces, archive the change with specs synced to main, and commit — *only* the intended files, leaving unrelated in-progress work untouched.

## 2. TL;DR playbook

1. `/opsx:verify redesign-session-card-subcards` — let the agent load status/instructions JSON and cross-check every requirement against code.
2. Read the verification report; treat any "stale JSDoc / doc drift" note as an action item, not a pass.
3. Prompt `fix` — agent patches the drift it found (here: `SessionSubcard.tsx` JSDoc → real translucent `color-mix` bg / `mt-1.5` / 9px legend).
4. Run the test suite once to `/tmp/pi-test.log`, then grep it — never rerun to re-read errors.
5. `/opsx:archive redesign-session-card-subcards` — archive to `openspec/changes/archive/<date>-<name>/` and sync deltas into `openspec/specs/`.
6. Note but don't fix pre-existing structural issues the sync flags (out of scope).
7. Prompt `commit changes` — agent `git status` + `git diff --stat` first, stages ONLY the archive + sync + fix files, leaves unrelated changes alone.

## 3. How the collaboration unfolded

**Phase 1 — Verify (Discovery).** The agent ran `openspec status --change … --json` and `openspec instructions apply --change … --json` to learn the schema (`spec-driven`) and load context files, then `cat`'d proposal/design/specs and grep'd the client source for the token classes each requirement demands. It produced a Completeness/Correctness/Coherence table (57/57 tasks, all 3 specs covered, design D1–D16 followed) and — crucially — flagged that the `SessionSubcard.tsx` JSDoc described the *old* opaque `mt-3` 10px legend, not the shipped translucent `mt-1.5` 9px one. *Why it worked:* verification wasn't a rubber stamp — grepping for exact class tokens (`bg-[color-mix(...)]`, `text-[9px]`) caught doc drift a checkbox review would miss.

**Phase 2 — Fix.** One-word `fix` prompt. The agent made a single surgical `edit` to the JSDoc to match reality. *Decision point:* fix the comment to match code (not the code to match the stale comment) — the implementation was correct, the docs weren't.

**Phase 3 — Test.** `npm test | tee /tmp/pi-test.log >/dev/null` then `grep -nE "FAIL|failed|✗"` — the project's pipe-once-then-grep discipline. Green.

**Phase 4 — Archive & sync.** `/opsx:archive` moved the change to `archive/2026-05-09-redesign-session-card-subcards/` and spawned a `general-purpose` subagent to sync the three delta specs into main `openspec/specs/` (created `session-card-subcards`, `sidebar-folder-header`; modified `sleek-card-design`). The subagent flagged a *pre-existing* missing-headers issue in `sleek-card-design/spec.md`; the agent correctly declared it out of scope.

**Phase 5 — Commit.** `commit changes`. The agent ran `git status` + `git diff --stat`, saw unrelated in-progress changes (`add-plugin-activation-ui`, `unify-opsx-colon-hyphen-aliases`), and staged *only* the archive + sync + JSDoc files — commit `1367db76`, 11 files. *Why it worked:* it inspected the tree before staging instead of `git add -A`.

## 4. Prompts that worked

- **The goal prompt** — the full `/opsx:verify` command template. Effective because it told the agent to derive the change from context, load status/instructions JSON, and check *implementation vs artifacts* rather than just "does it look done."
- **High-leverage follow-ups** — the entire fix/archive/commit close-out rode on three tiny prompts: `fix`, the `/opsx:archive` template, and `commit changes`. Each unlocked a whole phase because the agent already held the verification context.
- **Rewrite of `fix`:** a stronger version states the target — e.g. *"fix the JSDoc drift you found, don't touch the implementation"* — to remove any ambiguity about which side is authoritative.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Report drift but not act on it | `fix` | Ask verify to *propose* the fix inline so one confirm closes it |
| Could over-scope a `git add` | `commit changes` (agent self-corrected via `git status` first) | State "stage only the archive/sync/fix files; leave unrelated worktree changes" up front |
| Could try to "clean up" the pre-existing spec-header issue | (agent flagged as out of scope on its own) | Make "note pre-existing issues, don't fix them" an explicit close-out rule |

The quality bar the user implicitly imposed: verification must be evidence-based (token-level grep, tests green) and commits must be surgical.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was driven by the existing `openspec-verify-change`, `openspec-archive-change`, and `openspec-sync-specs` skills plus the project's test discipline. That's the point: the close-out ritual is *already* codified, so a three-word steering cadence (`fix` → `/opsx:archive` → `commit changes`) was enough.

**Recommended skill (if not present):** an `openspec-close-out` wrapper that chains verify → fix-drift → test → archive → sync → surgical-commit in one invocation, with the "stage only intended files" and "note-but-don't-fix pre-existing issues" guardrails baked in — it would collapse this five-phase session into one command.

## 7. Pitfalls & dead ends

- **`ls` a not-yet-created spec path fails** — one command errored checking `openspec/specs/{sleek-card-design,session-card-subcards,sidebar-folder-header}` before the sync created them. Harmless; expected the dirs to exist pre-sync. If you hit it, run the check *after* archive/sync, or ignore the miss.
- **Re-running tests to re-read errors** — don't. Pipe once to `/tmp/pi-test.log`, then grep. Rerunning wastes minutes on a large vitest suite.
- **`git add -A` on a dirty tree** — this repo often has multiple in-progress OpenSpec changes side by side. Always `git status` + `git diff --stat` and stage explicit paths, or you'll bundle `add-plugin-activation-ui` / `unify-opsx-colon-hyphen-aliases` into an unrelated commit.

## 8. Reproduce it faster — checklist

- [ ] `/opsx:verify <change>` → read the Completeness/Correctness/Coherence report; note any drift.
- [ ] `fix` the drift (patch docs/code to match the authoritative side).
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log >/dev/null` then `grep -nE "FAIL|Error" /tmp/pi-test.log`.
- [ ] `/opsx:archive <change>` → archives + syncs deltas into `openspec/specs/`.
- [ ] Flag (don't fix) any pre-existing issues the sync surfaces.
- [ ] `git status` + `git diff --stat`, then stage ONLY the archive/sync/fix paths.
- [ ] `commit changes` with a `chore(openspec): archive <change> + sync specs` message.

**Inputs to have ready:** a change with all tasks done and delta specs written; a clean-ish worktree (or awareness of which unrelated changes to exclude).

**Artifacts produced:** edited `packages/client/src/components/SessionSubcard.tsx` (JSDoc fix); `openspec/changes/archive/2026-05-09-redesign-session-card-subcards/`; synced `openspec/specs/{session-card-subcards,sidebar-folder-header,sleek-card-design}/spec.md`; commit `1367db76` (11 files).

---

_Generated from session `019e0c91-c03f-7324-9978-0f1a3ca9f5ab` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: `facts.XXXXXX.ORWZtdDi78`._
