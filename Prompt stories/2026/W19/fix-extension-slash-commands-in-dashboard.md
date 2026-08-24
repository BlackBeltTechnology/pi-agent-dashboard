---
session: 019e0e28
week: 2026/W19
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-extension-slash-commands-in-dashboard, unify-opsx-colon-hyphen-aliases, add-session-status-to-folder-proposal-rows, add-rpc-stdin-dispatch-with-keeper-sidecar]
proposal_excerpt: "Pi extensions that register slash commands via `pi.registerCommand(name, { handler })` are silently broken in dashboard sessions. When the user types e.g. `/ctx-stats` or `/curator` in chat, the registered handler n…"
---

# How we did it: Land, archive, and commit the "fix-extension-slash-commands-in-dashboard" change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a `/opsx-apply` invocation against the OpenSpec change
`fix-extension-slash-commands-in-dashboard` — the underlying bug being that pi
extensions registering slash commands via `pi.registerCommand(name, { handler })`
are silently swallowed in dashboard sessions (typing `/ctx-stats`, `/curator`, etc.
never fires the handler). But the *real* objective that emerged across the steering
turns was broader than "apply the change": it was **to finish the change end-to-end
in a messy shared workspace** — apply what could be applied autonomously, archive it,
then untangle a working tree that had uncommitted changes from *four different
sessions and several proposals* and route each file to the correct commit.

## 2. TL;DR playbook

1. Run `/opsx-apply <change>` — let the agent complete every autonomous code/test/doc
   task and **explicitly report which remaining tasks are non-autonomous** (manual
   smoke tests, upstream PRs, future follow-ups).
2. Ask it to opportunistically resolve any "investigable" manual task at the code
   level (here: confirm the client renderer already shows `command_feedback.message`
   on error — it did, no work needed).
3. Run `/opsx-archive <change>` — accept the "archived with N incomplete tasks"
   warning **when those tasks are pre-marked "separate change, not blocking."**
4. Before committing, tell the agent: **"collect ALL uncommitted changes related to
   this proposal across sessions."** It greps `~/.pi/agent/sessions/*.meta.json` for
   the proposal name to prove ownership.
5. Have it `git reset HEAD -- .` then stage **only** this proposal's files, run the
   affected tests (`HOME=$(mktemp -d) npx vitest run …` to avoid polluting real HOME),
   and commit with a scoped message.
6. Then: **"commit all remaining uncommitted files that have NO owning session to
   their related proposals."** Orphan proposal scaffolds and build-tooling changes get
   their own commits; files owned by *other* live sessions stay uncommitted.
7. Verify with `git log --oneline -5` + `git status --short | wc -l`.

## 3. How the collaboration unfolded

**Phase 1 — Apply (autonomous slice).** The agent ran `openspec status` +
`openspec instructions apply`, saw 19/28 tasks already done, and — crucially —
*classified the remaining 9* rather than faking completion: §7.1–7.5 are manual
smoke tests needing a live dashboard, §8.1–8.2 are an upstream pi PR and a
post-pi-0.71 follow-up. It then found the one code-investigable item (7.4a) and
verified `CommandFeedbackCard.tsx` + `event-reducer.ts` already render the error
`message`. *Why it worked:* the agent refused to check boxes it couldn't honestly
complete, and mined the "manual" list for anything actually doable in code.

**Phase 2 — Archive.** `/opsx-archive` moved the change to
`openspec/changes/archive/2026-05-09-…`, synced 2 modified + 2 added requirements
into `openspec/specs/command-routing/spec.md` (via a `general-purpose` subagent for
the delta-spec sync), and surfaced the incomplete-task warning honestly.

**Phase 3 — Cross-session commit hunt.** The human said: commit this proposal's
changes, but first *collect everything related across sessions*. The agent grepped
session meta files for the proposal name, discovered **4 sessions all share one git
working tree** (no worktree/shadow clones), so every related edit was already local.
It did `git reset HEAD -- .`, staged only the 17 proposal files, ran the extension
tests (88 pass), and committed `87ef7306`.

**Phase 4 — Orphan sweep.** Final steer: commit the *ownerless* remainder. The agent
distinguished (a) files owned by *other live sessions* → leave uncommitted, from
(b) true orphans → commit. It shipped `fcea0a6f` (an `add-rpc-stdin-dispatch…`
proposal scaffold with 0 sessions) and `b73a1c5d` (Electron Node-version
centralization, no proposal at all), then reported the ownership table.

## 4. Prompts that worked

- **The goal prompt** (`/opsx-apply fix-extension-slash-commands-in-dashboard`): a
  slash command carrying the full apply protocol. Effective because it hands the agent
  a deterministic status→instructions→tasks pipeline instead of a vague "fix the bug."
- **High-leverage follow-up #1:** *"commit changes. Check other sessions which have set
  the fix-extension-slash-commands-in-dashboard proposal and collect all changes
  related to this proposal and not committed yet."* This single sentence forced the
  agent to prove file ownership by session, not guess — the move that kept unrelated
  proposals out of the commit.
- **High-leverage follow-up #2:** *"commit all uncommitted which have no session to the
  related proposals."* Short, but it defined the exact partition rule (owner-session →
  leave; no session → commit) that made the orphan sweep safe.

**Stronger rewrite of the goal prompt for next time:** *"/opsx-apply
fix-extension-slash-commands-in-dashboard — complete every autonomous task, and for
each task you can't finish, tell me exactly why (manual / upstream / blocked) before
archiving."* Make the honest-classification behavior an instruction, not a hope.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "apply" without committing | "commit changes" + "collect all changes related to this proposal" | Add "then commit only this proposal's files" to the apply prompt |
| Consider only the current session's edits | "Check other sessions which have set this proposal" | Grep `~/.pi/agent/sessions/*.meta.json` for the proposal name to establish ownership |
| Risk sweeping unrelated staged files into the commit | (agent self-corrected: `git reset HEAD -- .` then selective `git add`) | Always reset the index before a scoped commit in a shared tree |
| Leave truly ownerless files stranded | "commit all uncommitted which have no session to the related proposals" | State the partition rule: owner-session → leave; no session → commit |

Also note the quality bars the human implicitly imposed: run the affected tests before
committing, and keep each proposal's changes in a **separate, scoped commit**.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow is clearly
repeatable and **should be captured as a skill** — call it
`commit-proposal-changes-across-sessions`:

- **What it would capture:** in a single shared git working tree used by multiple pi
  sessions, partition uncommitted files by proposal ownership (grep session
  `*.meta.json` for the proposal name), stage only one proposal's files after
  `git reset HEAD -- .`, run affected tests with an isolated `HOME`, commit scoped;
  then sweep true orphans (proposals with 0 sessions, or build-tooling with no
  proposal) into their own commits, leaving other-session-owned files untouched.
- **Why it's effective:** it removes the risky manual triage of "whose change is this?"
  and prevents the classic mistake of committing four proposals' worth of churn into
  one blob.
- **When to invoke it:** any time `git status` is noisy in a workspace shared by
  concurrent sessions, before archiving or landing a change.

(One subagent *was* used: a `general-purpose` agent to sync delta specs during
archive — a good pattern for isolating the spec-merge from the main context.)

## 7. Pitfalls & dead ends

- **`curl http://localhost:8000/api/health` / `/api/sessions` failed** (3 command
  errors) — the live dashboard API wasn't the right source of session→proposal
  mapping. *If you hit this, do:* grep the on-disk session meta files
  (`~/.pi/agent/sessions/**/*.meta.json`) for the proposal name instead.
- **`ls *.meta.json` in the wrong cwd returned nothing** — the meta files live under
  the project-slug session dir. *Fix:* `find ~/.pi/agent/sessions -name "*.meta.json"`
  first to locate them.
- **Running vitest against the real `$HOME`** can touch user state — the agent
  re-ran with `HOME=$(mktemp -d) npx vitest run …` to sandbox it.
- **Archiving with incomplete tasks throws a warning** — this is *fine* when the
  incomplete tasks are pre-marked "separate change, not blocking this one." Don't try
  to force-complete manual smoke tests you can't drive.
- **Don't sweep too wide on the orphan commit:** files owned by another live session's
  proposal must stay uncommitted; only 0-session proposals and no-proposal build
  tooling are true orphans.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change name.
- Access to `~/.pi/agent/sessions/<project-slug>/*.meta.json` (session→proposal map).
- A clean-ish index (be ready to `git reset HEAD -- .`).

**Checklist:**
1. `/opsx-apply <change>` → complete autonomous tasks; get the honest non-autonomous list.
2. Resolve any code-investigable "manual" task; otherwise leave it flagged.
3. `/opsx-archive <change>` → accept the incomplete-task warning if pre-marked non-blocking.
4. `grep -l "<change>" ~/.pi/agent/sessions/<slug>/*.meta.json` → list owning sessions.
5. `git reset HEAD -- .` → stage **only** this proposal's files.
6. `HOME=$(mktemp -d) npx vitest run <affected tests>` → then commit scoped.
7. Sweep orphans (0-session proposals, no-proposal tooling) into their own commits;
   leave other-session-owned files alone.
8. Verify: `git log --oneline -5` + `git status --short | wc -l`.

**Final artifacts produced this session:**
- Commit `87ef7306` — 17 files, +665/−107: extension slash-command routing
  (`bridge.ts`, `bridge-context.ts`, `command-handler.ts`, new `slash-dispatch.ts`),
  tests, `event-reducer.ts`, `AGENTS.md`, `CHANGELOG.md`, synced
  `openspec/specs/command-routing/spec.md`, and the 6-file archive rename.
- Commit `fcea0a6f` — `add-rpc-stdin-dispatch-with-keeper-sidecar` proposal scaffold.
- Commit `b73a1c5d` — Electron bundled-Node centralization + bump v22.18.0 → v24.15.0.

---

_Generated from session `019e0e28-487f-765f-b78d-8987896a3108` · `pi-agent-dashboard` · 2026-05-09. Source extract: `/tmp/facts-1784850449N.md`._
