---
session: 019f0a47
week: 2026/W26
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [git-root-file-containment]
proposal_excerpt: "The file-read/preview/raw routes contain every request to the **single session `cwd`** passed in the request:"
---

# How we did it: Verifying & cleaning up an already-shipped OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a short, load-bearing prompt:

> "proposal git-root-file-containment seems implemented, the spec stays. Check"

The *real* objective, once the two steering turns landed, was not "implement a
feature" — the feature was already shipped. It was a **verification-then-cleanup**
task: confirm that the `git-root-file-containment` change (route path-containment
guards funneled through a single `path-containment.ts` helper) was genuinely
implemented, mark its `tasks.md` accordingly, then archive/sync/commit. The twist
that emerged mid-session: the change had **already been archived and committed in PR
#176** — what lived in `openspec/changes/` was a *stale duplicate* reintroduced by a
later commit. So "archive" quietly became "clean up the leftover without re-archiving
and without clobbering unrelated `groups.json` regrouping."

## 2. TL;DR playbook

1. **Read the change first.** `cat` the proposal + `tasks.md`, then grep the codebase
   for the promised helper (`path-containment.ts`) and every guard site.
2. **Verify against the design, not vibes.** Build a small table: each guard site →
   its anchors → its error string. Confirm each routes through the helper and that
   per-site behavior (e.g. pinned-dir anchor on exists-only) matches the design deltas.
3. **Run the exact tests the change touches** before claiming green (see §7 for the
   vitest-resolution dance in this repo).
4. **Only then mark `tasks.md`** — complete the in-scope items, and *leave the
   explicitly out-of-scope follow-up unchecked* (task 4.1 here).
5. **Before archiving, check whether it's already archived.** `ls
   openspec/changes/archive/ | grep <change>` and `git log` the archive dir. If a
   canonical archive exists, do **not** re-archive.
6. **Diagnose the duplicate.** `git log`/`git diff` the stray dir and `groups.json` to
   find which commit reintroduced it and what unrelated churn rides along.
7. **Surgical cleanup:** `git rm -rf` the stale dir, hand-edit `groups.json` to drop
   only the archived change from `assignments` + `changeOrder`, keep unrelated
   regrouping, validate the JSON, commit with a message that names both offending SHAs.

## 3. How the collaboration unfolded

**Phase A — Verify implementation (prompt 1).** The AI read the proposal and tasks,
located `packages/server/src/lib/path-containment.ts` (exports `within`, `gitRoot`,
`isAllowed({ anchors })`), and grepped every guard site: `/api/file`,
`/api/file/exists`, `/api/file/raw`, `/api/file/render`, and `system-routes`. It built
a site→anchors→error-string table, confirmed the pinned-dir anchor stayed exists-only
(design D7), and checked for stray `startsWith(cwd` guards (the survivors were
unrelated session-matching, not containment). It then ran the three relevant vitest
files — **40 passed**. *Why it worked:* the verification was evidence-based and
mapped 1:1 to the design deltas, not a hand-wave "looks done."

**Phase B — Update tasks (prompt 2, "update tasks").** The AI marked tasks 1.1–3.3
complete (12 items) and deliberately **left 4.1 unchecked** — the out-of-scope
link-origin follow-up. *Decision point:* not all tasks get checked; the AI correctly
distinguished in-scope done from out-of-scope deferred.

**Phase C — Archive/sync/commit (prompt 3, "archive sync and commit").** This is where
the session earned its keep. `openspec archive` surfaced that the change was **already
archived** in PR #176 (`f3f7a24e`), with the spec already synced to
`openspec/specs/file-read-containment/` — which is *why the operator's opening note
said "the spec stays."* The stray `openspec/changes/git-root-file-containment/` was a
duplicate reintroduced by `0892e22d`. Rather than blindly re-archiving, the AI
`git rm -rf`'d the stale dir and hand-edited `groups.json` to drop the archived change
from both `assignments` and `changeOrder.ui` — **preserving** the unrelated regrouping
of 6 other active changes that shared the uncommitted diff. It validated the JSON and
committed (`af41b62d`) with a message citing both `f3f7a24e` and `0892e22d`.

## 4. Prompts that worked

- **Goal prompt** — *"proposal git-root-file-containment seems implemented, the spec
  stays. Check"*: terse but high-signal. It named the change, stated a hypothesis
  ("seems implemented"), and pinned an invariant ("the spec stays") that later
  explained the archive state. A future operator should keep this shape: **name the
  artifact + state your hypothesis + name any invariant you already know.**
- **High-leverage follow-ups** — *"update tasks"* and *"archive sync and commit"*:
  each is three words yet unlocked a full phase, because phase A had already
  established the ground truth. Short follow-ups work *because* the verification was
  thorough first.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "archive" as a fresh `openspec archive` run | The pre-stated invariant "the spec stays" hinted it was already synced | Always `ls openspec/changes/archive/ \| grep <change>` + `git log` the archive dir BEFORE archiving |
| Assume the dir in `openspec/changes/` is the live source of truth | (self-corrected via git forensics) | On any archive task, diff the stray dir's history to find whether it's a re-introduced duplicate |
| Risk clobbering the whole `groups.json` diff | Choice to keep the unrelated regrouping of 6 other changes | Hand-edit `groups.json` surgically (drop only the target from `assignments` + `changeOrder`), never `git checkout` the whole file |

The steering here was light in *words* but heavy in *judgment* — the operator's one
invariant ("the spec stays") was the thread that unraveled the "already archived"
reality.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. But the workflow is clearly
repeatable and **a skill should exist**: *"reconcile-openspec-archive-state"* — given
a change that "seems done," verify implementation against design deltas, detect an
already-archived + duplicated state via `git log` on the archive dir, and clean up the
stray copy + `groups.json` without re-archiving or clobbering sibling churn. It would
remove the manual git-forensics each time a duplicate change dir reappears.

## 7. Pitfalls & dead ends

- **vitest isn't on `PATH` / has no npm script here.** `cat package.json | grep test`
  and `ls node_modules/.bin/vitest` both came up empty. The working invocation was to
  run the runner module directly with an isolated HOME/localstorage:
  `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" node
  node_modules/vitest/vitest.mjs run <patterns>`. Reach for this when `npx vitest`
  won't resolve.
- **`openspec archive` on an already-archived change is a no-op trap.** It won't
  cleanly "re-archive"; the fix is to delete the stale dir, not to fight the CLI.
- **`git rm -r -q` failed; `git rm -rf -q` worked.** The stale dir had modified/
  untracked content, so `-f` was required to force removal.
- **Don't `git checkout openspec/groups/groups.json` to undo churn** — it carries
  legitimate regrouping of other active changes. Edit by hand and re-validate with
  `python3 -c "import json;json.load(open(...))"`.

## 8. Reproduce it faster — checklist

- [ ] `cat` the proposal + `tasks.md`; grep the promised helper + every guard site.
- [ ] Build a site → anchors → error-string table; confirm each routes through the
      helper and matches the design deltas.
- [ ] Run the change's tests via `node node_modules/vitest/vitest.mjs run <patterns>`
      with a temp HOME/localstorage.
- [ ] Mark in-scope tasks done; leave explicitly out-of-scope follow-ups unchecked.
- [ ] **Before archiving:** `ls openspec/changes/archive/ | grep <change>` and
      `git log` the archive dir. If canonical archive exists → do NOT re-archive.
- [ ] If a stale duplicate dir exists: `git log`/`git diff` to find the reintroducing
      commit; `git rm -rf` the dir.
- [ ] Hand-edit `groups.json` (drop target from `assignments` + `changeOrder` only);
      validate JSON; keep unrelated regrouping.
- [ ] Commit citing both the archive SHA and the duplicate-reintroducing SHA.

**Key inputs:** the change name, the design deltas (for per-site verification),
repo-local vitest module path. **Artifacts produced:** edited
`openspec/changes/git-root-file-containment/tasks.md` (before removal), edited
`openspec/groups/groups.json`, cleanup commit `af41b62d`.

---

_Generated from session `019f0a47-46c9-78a8-9158-4b7cb130bb31` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: deterministic facts sheet._
