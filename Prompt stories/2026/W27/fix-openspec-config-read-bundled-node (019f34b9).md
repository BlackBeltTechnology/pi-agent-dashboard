---
session: 019f34b9
week: 2026/W28
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-openspec-config-read-bundled-node]
proposal_excerpt: "The global OpenSpec profile section in the dashboard Settings panel shows \"not found\" / fails to load the current profile when the dashboard runs as a bundled Electron app on macOS (and Windows) — even though the…"
---

# How we did it: Archiving an OpenSpec change whose code already shipped — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a deceptively small question: **"Is this merged already?"** —
about the `fix-openspec-config-read-bundled-node` OpenSpec change. The *real* objective
emerged over the next two prompts: confirm whether the change's code was actually in the
codebase, and if so, **close out the OpenSpec bookkeeping** (mark deferred QA tasks done,
sync delta specs, archive the change) and land it — without touching the code, and without
disturbing the operator's unrelated uncommitted work. The twist that drove the whole
session: the code had **already merged to `develop` under a separate PR (#230)**, so the
usual "ship-change" happy path (worktree → PR → CI → CodeRabbit → squash-merge) did not
apply. Only the archive remained.

## 2. TL;DR playbook

1. **Ask "is it merged?" and make the AI prove it with evidence**, not vibes: change dir
   still under `openspec/changes/` (not `archive/`), `git log --all` for the change name,
   checked-vs-open task count in `tasks.md`.
2. **Force a code-reality check** — "are the checked tasks actually in the codebase?"
   Make the AI grep each claimed artifact (functions, test files) and produce a
   task → artifact → present? table.
3. **Reconcile the surprise**: if `git log` shows the code already merged under another PR,
   stop and state it — the ship-change worktree flow is now the wrong tool.
4. **Choose the landing style explicitly** ("ship-change skill", direct-on-develop) since
   there's no worktree.
5. **Mark the remaining tasks done** only if they are genuinely deferred QA/manual (e.g.
   physical bundle capture, manual DOM check, post-merge deploy).
6. **Run `npx openspec archive <name> --yes`**; when it fails on a spec-sync mismatch,
   inspect delta vs current spec headers.
7. **Fix `MODIFIED` → `ADDED`** when a delta's requirement header does not exist in the
   current spec (it's a genuinely new requirement, not an edit). Re-run archive.
8. **Stage ONLY the openspec files** (`git add openspec/`), explicitly excluding the
   operator's unrelated work, commit with a `chore(openspec): archive …` message, push.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (is it merged?).** The AI ran `ls` on the change + archive dirs,
`git log --oneline --all | grep` for the change name, and counted `[x]` tasks. Verdict:
not archived, no commit references it by name, 18/21 tasks checked. *Why it worked:* the
answer was grounded in three independent signals, not a single lookup.

**Phase 2 — Code-reality audit.** Prompted by "The checked task are in code base?", the AI
grepped each claimed artifact — `resolveJsScript` + `realpathSync` in `definitions.ts`,
`buildSpawnEnvForArgv` + `ELECTRON_RUN_AS_NODE` in `platform/runner.ts`, the 502-on-failure
route, and the named test files — and produced a task→artifact→present table. One path in
`tasks.md` was stale (`runner.ts` lived under `platform/`, not `tool-registry/`) but content
matched. *Decision point:* the code exists and is in-tree → the change is *done*, just
*not archived*.

**Phase 3 — The surprise + pause.** Before running any pipeline the AI checked git state
and found the code **already merged via PR #230** with **no worktree and no `os/` branch**.
It explicitly paused: this does not match ship-change's assumptions, so it asked how the
operator wanted the archive to land rather than blindly executing the skill.

**Phase 4 — Archive + spec-sync fix.** The AI marked the 3 deferred QA/manual tasks done,
ran `npx openspec archive`, and hit a spec-sync mismatch. It inspected both delta specs and
found their requirement headers **did not exist** in the current specs — meaning they were
new requirements mis-tagged as `## MODIFIED Requirements`. It retagged both to
`## ADDED Requirements`, which unblocked archiving (+2 requirements synced into
`openspec/specs/`).

**Phase 5 — Surgical commit.** Recognizing this was spec-only (no code), the AI skipped the
test/build gate, staged **only** openspec files via `git add openspec/` (verifying the
operator's `manage-flows`, `groups.json`, `b05_*` changes stayed unstaged), committed with a
descriptive `chore(openspec):` message, and pushed to `develop`.

## 4. Prompts that worked

- **Goal prompt — "Is this merged already?"** Short but effective because it forces a
  binary, evidence-backed answer. A stronger version bakes in the proof standard up front:
  *"Is `<change>` merged? Check the archive dir, `git log --all` for the name, and the
  checked/open task count, and show me the evidence."*
- **High-leverage follow-up — "The checked task are in code base?"** This single question
  flipped the investigation from OpenSpec bookkeeping to *code reality* and produced the
  audit table. Reusable form: *"Verify each checked task's claimed artifact actually exists
  in the code — grep for it and give me a task→file→present table."*
- **High-leverage follow-up — "I will test later. ship-change skill".** Two moves in five
  words: defer the manual QA, and name the intended landing pipeline. It let the AI proceed
  without re-litigating the deferred tasks.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer "merged?" from the change dir alone | Implicitly demanded proof (the AI self-corrected to 3 signals) | State the proof standard: archive dir + `git log --all` + task count |
| Trust `tasks.md` "checked" as "in code" | "The checked task are in code base?" | Always audit checked tasks against real files before archiving |
| Assume ship-change's worktree/PR happy path | (AI caught it) — code already merged via #230, no worktree | Check git state FIRST; if code already merged, archive direct-on-develop |
| `git add openspec/` could sweep unrelated work | (AI pre-empted) staged only openspec, verified exclusions | Explicitly grep-exclude unrelated dirty paths before commit |
| Run the test/build gate reflexively | (AI reasoned) spec-only change → no gate needed | Skip the gate for markdown-only archives; state why |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **consumed** the existing `ship-change`
skill and correctly recognized when it *didn't* apply. The reusable lesson worth capturing:

- **A "close out an already-merged OpenSpec change" branch of ship-change.** When the code
  landed under a separate PR and there is no worktree, the pipeline collapses to: mark
  deferred tasks → `openspec archive` → fix `MODIFIED`→`ADDED` mismatches → stage only
  openspec files → commit + push. If this recurs, add it to `ship-change` as an explicit
  "code already merged" fast path so the next operator doesn't rediscover it.

## 7. Pitfalls & dead ends

- **`openspec archive` fails on a spec-sync mismatch** when a delta's requirement header is
  not present in the current spec → the delta is a **new** requirement mis-tagged
  `## MODIFIED Requirements`. Fix: retag to `## ADDED Requirements` and re-run. (Common when
  a sibling PR already added differently-named requirements to the same spec.)
- **Stale artifact paths in `tasks.md`** — task 2.3 pointed at `tool-registry/runner.ts` but
  the code lived at `platform/runner.ts`. Grep by symbol, not by the path the task claims.
- **`git add openspec/` can capture unrelated dirty files.** Verify with
  `git status --short | grep -vE "<unrelated patterns>"` before committing.
- **Don't run ship-change's worktree/PR/CI loop for an already-merged change** — it has no
  worktree to operate on and the PR gates are already satisfied. Archive direct-on-develop.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, a clean-enough working tree (know which
dirty paths are unrelated), push access to `develop`.

1. `ls openspec/changes/ openspec/changes/archive/` + `git log --all | grep <name>` +
   `grep -c "\[x\]" tasks.md` → is it merged? archived? how many tasks open?
2. Grep each checked task's claimed artifact in the code → task→file→present table.
3. `git worktree list` + `git branch -a | grep <name>` → is there a worktree/branch, or did
   the code merge under another PR? If already merged → **direct-on-develop archive**.
4. Mark deferred QA/manual tasks `[x]` in `tasks.md`.
5. `npx openspec archive <name> --yes` → on spec-sync failure, diff delta headers vs current
   specs; retag `MODIFIED`→`ADDED` for genuinely-new requirements; re-run.
6. `git add openspec/`; `git status --short | grep -vE "<unrelated>"` to confirm clean stage.
7. Commit `chore(openspec): archive <name>` + push. **Artifacts:** archived change under
   `openspec/changes/archive/<date>-<name>/`, synced requirements in `openspec/specs/`.

---

_Generated from session `019f34b9` · `pi-agent-dashboard` · 2026-07-06. Source extract: `/tmp/facts.KUDo2a`._
