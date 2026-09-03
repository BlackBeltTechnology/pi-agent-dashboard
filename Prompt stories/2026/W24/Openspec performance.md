---
session: 019ec0b6
week: 2026/W24
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [optimize-openspec-poll-derive-artifacts-locally, fix-openspec-worktree-cwd-keying, honcho-remint-proxy-key, redesign-openspec-board]
proposal_excerpt: "The periodic OpenSpec poll spawns `openspec status --change <name> --json` **once per change, per cwd, every tick**. On this machine that is 66 active changes in `pi-agent-dashboard` alone (~96 across 11 pinned dirs).…"
---

# How we did it: Diagnosing an OpenSpec polling stall → two grounded proposals — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — the `openspec-explore` skill, whose contract is
*"think, don't implement; you MAY create OpenSpec artifacts."* The first prompt was the
skill preamble ("Enter explore mode. Think deeply… you must NEVER write code"), so the
*real* objective only crystallized as the human steered: **figure out why the dashboard
server periodically "blocks" / drops sessions, plus why a manually-checked OpenSpec task
in a worktree never shows up on the folder card — then capture both as validated proposals
in the "Current" board group.** The deliverable was not code; it was two root-caused,
spec-delta-carrying OpenSpec changes, committed to `develop`.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore` skill) — you may investigate and create OpenSpec artifacts, but not implement.
2. Map the integration surface first: `grep -rl "openspec" docs/` and the `file-index-*.md` splits, then the server/shared/extension sources.
3. Hunt the **live smoking gun** in `~/.pi/dashboard/server.log` — grep for `slow tick|heartbeat timeout|spawn`. This turned theory into evidence in one command.
4. Quantify the real scale on *this* machine: count active changes per pinned cwd (`for d in <dirs>; do …; done`) — 66 here, ~96 across 11 dirs.
5. Read the hot path (`directory-service.ts`: tick scheduler, `effectiveMtimeOr`, `perChangeArtifactPaths`) to confirm sync `statSync/readdirSync` + `1+N` spawns per tick starve the event loop.
6. Before scaffolding: check `openspec/changes/archive/` for duplicates, read one example change's spec-delta + tasks format, and read the target main-spec capabilities so deltas align.
7. Scaffold with `openspec new change <name>`, write `proposal.md / design.md / tasks.md / specs/<cap>/spec.md`, then `openspec validate <name>`.
8. Assign to the board group by editing `openspec/groups/groups.json` — "Current" = group id `ui`; edit via a `node -e` JSON round-trip, not a fragile text edit.
9. Commit **only your files** with `[ci skip]` in the subject; verify unrelated staged files are excluded before pushing to `develop`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (map the surface).** The AI grepped `docs/` and the `file-index-*`
splits, then the three source packages, to locate where OpenSpec touches the server.
*Why it worked:* starting from the doc index (not source grep) surfaced the polling/watcher
code and the task-toggle path fast, without reading whole files.

**Phase 2 — Evidence (the smoking gun).** Instead of theorizing, the AI tailed the live
`server.log` and found `[openspec-poll] slow tick: 5805ms…8277ms` lined up with
`[gateway] heartbeat timeout`. *Decision point:* this reframed "server blocks" from a
guess into a measured 5–8s event-loop stall that drops WS bridges.

**Phase 3 — Quantify + root-cause.** The AI counted 66 active changes in the dashboard
repo (~96 across 11 pinned dirs), then read the tick scheduler and confirmed each tick
spawns `openspec status` **once per change** (`1+N`, semaphore max=3 → ~22 serial
batches) plus a synchronous `statSync/readdirSync` storm on the main thread. Issue 2 was
grounded the same way: the folder card is keyed by `group.cwd` (main repo), but worktree
edits live in a separate working copy keyed by the worktree cwd, so the card never sees
them and toggles write to the wrong copy.

**Phase 4 — Generate (steered).** On *"create proposals and put them to Current group"*
the AI first learned the group mechanism ("Current" = id `ui`), checked the archive for
dupes, read the example spec-delta format, then scaffolded both changes, wrote all four
artifacts each, validated, and assigned via `groups.json`.

**Phase 5 — Ship (steered twice).** *"commit and push to develop with [ci skip]"* — the
AI discovered a **detached HEAD** at the same commit as `develop` and an unrelated staged
`board.html` from another session, switched cleanly to `develop`, staged only its own 11
files, and pushed. A final *"commit the board.html too"* landed that file separately.

## 4. Prompts that worked

- **Goal prompt (the explore-mode skill preamble).** Effective because it set a hard
  stance — *investigate + capture artifacts, never implement* — which kept the whole
  session on root-causing and proposals instead of drifting into a code fix.
- **"create proposals and put them to Current group"** — a high-leverage 8-word follow-up
  that converted grounded analysis into two concrete, correctly-grouped deliverables.
- **"commit and push to develop with [ci skip]"** — short, unambiguous ship instruction;
  the `[ci skip]` intent was explicit so the AI put it in the commit *subject*.
- **"commit the board.html too"** — a precise scope correction after the AI (correctly)
  excluded an unrelated file on the first commit.

*Stronger goal prompt for next time:* "Explore why the dashboard periodically drops
sessions AND why worktree OpenSpec task-checks don't appear on the folder card. Ground
both in `server.log` + source, then draft OpenSpec proposals in the Current group."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in pure analysis (explore-mode default) | "create proposals and put them to Current group" | State up front that the exploration should end in OpenSpec artifacts in a named group. |
| Not know the board group taxonomy | (implicit) — AI had to look up "Current" = id `ui` | Note in the request that "Current" maps to `groups.json` id `ui`. |
| Commit from a detached HEAD with an unrelated file staged | "commit and push to develop with [ci skip]" | Say the target branch explicitly; AI should always `git status` and stage only its own files. |
| Exclude a file it didn't create | "commit the board.html too" | If a sibling file must go too, name it in the ship instruction. |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *used* the `openspec-explore` skill and
`openspec new/validate` tooling. The workflow is nonetheless repeatable and worth
capturing: **"root-cause a runtime stall from live logs → quantify scale → grounded
OpenSpec proposal."** A `diagnose-then-propose` skill should encode: (1) grep the doc
index before source, (2) tail `~/.pi/dashboard/server.log` for `slow tick|heartbeat` as
the first evidence step, (3) count real per-cwd change scale, (4) read one example
change's spec-delta format before scaffolding, (5) validate + assign via `groups.json`
JSON round-trip. Invoke it whenever "the server blocks / sessions drop" surfaces.

## 7. Pitfalls & dead ends

- **`grep -n "^### Requirement:" openspec/specs/.../spec.md` failed** — don't assume the
  main-spec path/anchors exist; list the spec tree first, then grep.
- **`tail -5 groups.json | cat -A` failed / editing JSON as text is fragile** — assign
  the group with a `node -e` `JSON.parse → mutate → stringify` round-trip instead.
- **Detached HEAD at commit time** — the working changes were fine, but you must
  `git checkout develop` (same commit → changes carry over) before committing, and verify
  the branch with `git rev-parse --abbrev-ref HEAD` because the name didn't print clearly.
- **Unrelated intent-to-add file (`board.html`, second-column `A`) in the index** — it
  won't be included by a plain `git add <your dirs>`, but confirm with `git show --name-only`
  (`grep -c board.html` → 0) before pushing.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore` (capture artifacts, don't implement).
- [ ] `grep -rl "openspec" docs/` + `file-index-*.md` → find the integration surface.
- [ ] `tail ~/.pi/dashboard/server.log | grep -iE "slow tick|heartbeat|spawn"` → evidence.
- [ ] Count active changes per pinned cwd → real scale.
- [ ] Read `directory-service.ts` tick scheduler + sync fs calls → confirm root cause.
- [ ] Check `archive/` for dupes; read one example change's spec-delta + tasks format.
- [ ] `openspec new change <name>` → write proposal/design/tasks/specs → `openspec validate`.
- [ ] Assign to "Current" (id `ui`) via `node -e` edit of `openspec/groups/groups.json`.
- [ ] `git checkout develop`; stage only your files; commit with `[ci skip]` in subject; push.
- **Inputs needed:** running dashboard with populated `server.log`; write access to `openspec/`; `develop` push rights.
- **Artifacts produced:** `openspec/changes/optimize-openspec-poll-derive-artifacts-locally/{proposal,design,tasks}.md` + `specs/server-openspec-polling/spec.md`; `openspec/changes/fix-openspec-worktree-cwd-keying/{proposal,design,tasks}.md` + `specs/openspec-folder-section/spec.md`; `openspec/groups/groups.json`; commits `a96d97ba`, `fca3d0dc` on `develop`.

---

_Generated from session `019ec0b6-4ba9-7521-ade8-441bed4de835` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: session facts sheet._
