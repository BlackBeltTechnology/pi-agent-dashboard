---
session: 019ea150
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [elevate-dashboard-add-buttons]
proposal_excerpt: "Dashboard-scope \"add\" gestures are scattered and hard to find. Pinning a new top-level folder lives in a 10px `📌 Folder` text chip wedged between two search inputs and the `Hidden` toggle in the sidebar header. Creat…"
---

# How we did it: Elevate the dashboard "add" buttons — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single slash command:

```
/skill:openspec-apply-change elevate-dashboard-add-buttons
```

The real objective, spelled out in the attached proposal: the dashboard's "add"
gestures were scattered and hard to find. Pinning a new top-level folder was buried
in a 10px `📌 Folder` text chip wedged between two search inputs and a `Hidden`
toggle; "new workspace" was a dashed mid-list `<li>`; per-workspace add was a tiny
`mdiPin` icon. The task was to **elevate all of them into clear, full-width buttons**
in the sidebar scroll list, remove the legacy affordances, keep tests green, then
carry the change all the way to a merged PR and a cleaned-up worktree. So the goal
was not just "write the component" — it was the **entire apply → archive → PR →
review → merge → cleanup lifecycle** of one OpenSpec change.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — let the skill read
   the proposal, design, and tasks.md before touching code.
2. Read the real source files first (`SessionList.tsx`, `WorkspaceHeader.tsx`, the
   existing tests) so testids and props match the tasks.md contract exactly.
3. Build the new component to mirror the closest existing one
   (`DashboardSpawnButtons` ← `FolderSpawnButtons`); expose a `testId` prop instead
   of hard-coding.
4. Update tests alongside the edits; run `npm test`, then **grep the log** for
   failures and prove the failing suites are pre-existing/unrelated to your diff.
5. Build + restart via the single source of truth:
   `npm run build && curl -X POST http://localhost:8000/api/restart`, confirm
   `uptime` is fresh.
6. `/skill:openspec-archive-change <change-name>` — if a subagent sync stalls, run
   `openspec archive <name> -y` directly (it does sync + move in one step).
7. `commit, push, create PR and monitor CI` — revert unrelated harness edits
   (`.pi/settings.json`) first so the commit stays surgical.
8. Pull CodeRabbit findings, **verify each against the code**, fix only the real
   ones, and record why you skipped the rest.
9. `gh pr merge <n> --squash --delete-branch`, then `git worktree remove` + prune.

## 3. How the collaboration unfolded

**Phase 1 — Apply (implement the change).** The AI read the context files and the
five relevant sources, then implemented tasks 1–3: created
`DashboardSpawnButtons.tsx` (mirroring `FolderSpawnButtons` styling), wired the
elevated pair as the first `<li>` in the scroll list, removed the `📌 Folder` chip,
the dashed `+ New workspace…` `<li>`, and the `mdiPin` icon button, and added a
workspace-scope `+ Add Folder`. Tests were updated in the same pass. *Why it worked:*
reading tasks.md's exact testids up front (`workspace-add-folder-btn-<id>`) meant the
component exposed a `testId` prop rather than being rewritten later.

**Phase 2 — Verify.** `npm test` piped to `/tmp/pi-test.log`, then grepped. 19
failures existed, but all were in unrelated packages (jimp/`image-fit`,
`browse-endpoint`, `doctor-route` — env/timing). The AI explicitly proved none came
from the diff before declaring done. Build succeeded; `/api/restart` confirmed a
fresh process via `uptime`.

**Phase 3 — Archive.** The archive skill wanted a delta-spec sync. The inline
subagent stalled ("sync stucked"), so the AI pivoted to `openspec archive -y`
directly. That surfaced a **pre-existing** structural defect: main
`sidebar-header/spec.md` lacked `# Title` / `## Purpose` / `## Requirements`
scaffolding, so openspec couldn't parse it. The AI added the minimal scaffolding,
re-ran, and the archive synced both specs.

**Phase 4 — PR + CI.** Committed surgically (reverting an unrelated
`.pi/settings.json` local-path edit), pushed, opened PR #89, and polled `gh pr checks`
until CI + CodeRabbit went green.

**Phase 5 — Review triage.** On "is there anything CodeRabbit have to fix?", the AI
pulled all 4 findings and verified each against the code: F1 (spec `TBD` placeholder)
and F3 (button gated on the wrong handler) were real and fixed; F2 (Tailwind
`(--var)` syntax) was a **false positive** — `[var(--x)]` is valid v4 and used by 148
files, 0 use the parenthesis form; F4 was an immutable archived artifact. Fixed F1+F3,
re-ran the 24 SessionList tests with an ephemeral HOME, pushed, CI green again.

**Phase 6 — Merge + cleanup.** Squash-merged with branch delete, removed the
worktree and pruned. The session's shell was rooted in the now-deleted worktree, so
the AI switched to `git -C`/sandbox shell to finish verification.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change elevate-dashboard-add-buttons`.
  Effective because it hands the AI a fully-specified change (proposal + design +
  tasks.md); the AI didn't have to guess scope. Lesson: **do the OpenSpec planning
  first**, then let the apply skill drive.
- **`commit, push, create PR and monitor CI`** — one short prompt that unlocked the
  whole ship phase, including CI polling. High leverage because the AI already knew
  the repo's PR conventions.
- **`IS there anythig oin coderabbit have to fix?`** — turned the AI into a reviewer
  triager. The win was demanding *per-finding verification against the code*, not
  blind application. Stronger phrasing: *"Pull CodeRabbit's findings, verify each
  against the actual code, fix only the valid ones, and tell me why you skipped the
  rest."*
- **`fix`** — one word, because the prior turn had already produced the verified
  fix/skip table. The context made it unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stall on a subagent sync mid-archive | "sync stucked" → AI fell back to `openspec archive -y` directly | Prefer the direct CLI archive (sync + move in one step); reserve the subagent only for large multi-spec syncs |
| Treat every CodeRabbit finding as actionable | "IS there anything coderabbit have to fix?" forced a real-vs-false-positive audit | State up front: verify each bot finding against the code before applying; a valid-in-v4 pattern used by 148 files is not a bug |
| Leave unrelated harness edits in the diff | (self-caught) reverted `.pi/settings.json` before commit | Always `git diff` and revert local-path/harness noise so the commit is surgical |
| Declare "tests pass" with 19 red suites | (self-caught) grepped the log, proved failures pre-existing | Pipe `npm test` to a log, grep `FAIL`, and attribute every failure before claiming green |

Two of these were self-corrections the AI made without prompting — good behavior to
reinforce by asking for it explicitly.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a **pure consumption**
run of the existing OpenSpec lifecycle skills:

- `openspec-apply-change` — drives implementation from a fully-specified change.
- `openspec-archive-change` / `openspec archive -y` — the direct CLI is the reliable
  path; it does sync + move atomically and is a good fallback when a sync subagent
  stalls.

Recommended memory to save from this run: **"CodeRabbit's Tailwind `(--var)` vs
`[var(--x)]` suggestion is a false positive in this repo — `[var(--x)]` is valid v4
and used by 148 files, 0 use the parenthesis form."** That single fact would let a
future session skip re-verifying F2 from scratch.

## 7. Pitfalls & dead ends

- **Subagent sync stalls.** If an OpenSpec sync subagent hangs, don't wait — run
  `openspec archive <name> -y` directly.
- **Pre-existing invalid main specs block archive.** `sidebar-header/spec.md` was
  missing `# Title`/`## Purpose`/`## Requirements`. Add the minimal scaffolding, then
  re-run the archive.
- **Vitest needs an ephemeral HOME.** SessionList tests only passed reliably with
  `HOME=$(mktemp -d) npx vitest run …` — a test-isolation guard.
- **Restart via the API, not by hand.** `curl -X POST http://localhost:8000/api/restart`
  is the single source of truth; confirm a fresh `uptime`.
- **Deleted-worktree shell trap.** After `git worktree remove`, the Bash tool's cwd
  points at a directory that no longer exists. Switch to `git -C <main-repo>` or the
  sandbox shell to finish.
- **Unrelated diff noise.** The harness rewrites `.pi/settings.json` local paths;
  revert it before committing.

## 8. Reproduce it faster — checklist

**Inputs you need ready:**
- A fully-specified OpenSpec change (`openspec/changes/<name>/` with proposal +
  design + tasks.md).
- The dashboard server running locally on `:8000`.
- `gh` authenticated for the repo.

**Checklist:**
- [ ] `/skill:openspec-apply-change <name>` — read sources, match testids from tasks.md.
- [ ] Mirror the nearest existing component; expose `testId` props, don't hard-code.
- [ ] Update tests in the same pass; `npm test | tee /tmp/pi-test.log`; grep `FAIL`;
      attribute every failure.
- [ ] `npm run build && curl -X POST localhost:8000/api/restart`; confirm fresh uptime.
- [ ] `openspec archive <name> -y` (direct); fix any invalid main-spec scaffolding.
- [ ] `git diff` → revert `.pi/settings.json` noise → commit surgical.
- [ ] Push, `gh pr create`, poll `gh pr checks <n>` until green.
- [ ] Pull CodeRabbit findings, verify each vs code, fix real ones, record skips.
- [ ] `gh pr merge <n> --squash --delete-branch`; `git worktree remove` + prune (use
      `git -C` after removing the worktree you're standing in).

**Final artifacts produced:**
- `packages/client/src/components/DashboardSpawnButtons.tsx` (new)
- edits to `SessionList.tsx`, `WorkspaceHeader.tsx`, `SessionList.test.tsx`
- synced main specs `dashboard-add-buttons/spec.md`, `sidebar-header/spec.md`
- archived change `openspec/changes/archive/2026-06-07-elevate-dashboard-add-buttons/`
- merged PR #89 (squash, 11 files, +279/−72)

---

_Generated from session `019ea150` · `pi-agent-dashboard/.worktrees/os-elevate-dashboard-add-buttons` · 2026-06-07. Source extract: deterministic facts sheet (stdout)._
