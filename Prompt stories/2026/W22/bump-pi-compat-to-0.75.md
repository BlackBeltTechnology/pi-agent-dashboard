---
session: 019e6ad2
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (22 user prompts); large facts sheet (~13062 tok)"
upgrade_status: pending
openspec_changes: [bump-pi-compat-to-0-75, bump-pi-compat-to-0-76, restore-pi-version-skew-surface, modernize-pi-version-handling, bump-pi-compat-to-0.75]
proposal_excerpt: "Pi shipped `0.75.5` on 2026-05-23. The dashboard's `piCompatibility` block still pins `0.74.0` as both `minimum` and `recommended`. Today, every user running pi 0.75.x sees a stale \"consider upgrading\" framing (no upg…"
---

# How we did it: Bump pi compat floor to 0.75 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was `/skill:openspec-ff-change` — fast-forward all OpenSpec artifacts to
start implementing a change. The real objective, once the steering clarified it: **land
the version-floor bump that tracks upstream pi `0.75.5`.** Concretely — raise the
dashboard's `piCompatibility` floor from `0.74.0` → `0.75.0` (recommended `0.75.5`),
lift `engines.node` from `22.18` → `22.19`, widen the `node-guard` cutoff one minor,
bump bundled-extension peer-deps, and add a repo-lint that keeps the bundled Node ≥ the
pi Node floor. The proposal framed the user pain: *"every user running pi 0.75.x sees a
stale 'consider upgrading' framing."* Simple in principle — but the session's real story
was a 6-hour fight to keep those edits from being **silently reverted by parallel
`jj`/Jujutsu workspace shadowing**.

## 2. TL;DR playbook

1. **Scaffold the change with `openspec-ff-change`** — but first check for a pre-existing
   dot-named directory (`bump-pi-compat-to-0.75/` is invalid for the CLI; rename to
   hyphen `bump-pi-compat-to-0-75/`).
2. **Run a coherence check before applying** — grep the source for every "before" value
   in `tasks.md` (`piCompatibility.minimum`, `engines.node`, `node-guard` cutoff). Catch
   stale anchors (e.g. `offline-packages.json` was already removed) and fix the spec delta.
3. **Apply the change** with `openspec-apply-change`: edit the 6 source files, add the
   `bundled-node-meets-pi-floor` lint test, run the vitest suite (`tee` → `grep`), confirm green.
4. **Split manual smokes from automatable work** — mark banner/`/api/bootstrap/status`
   tasks OBSOLETE (surface removed by `eliminate-electron-runtime-install`); scaffold the
   `restore-pi-version-skew-surface` follow-up proposal to track the dead code.
5. **Drive UI smokes headlessly**: `pi-agent-browser` to position the dashboard, then a raw
   WebSocket `resume_session {mode:"fork"}` when the Fork button click won't propagate.
6. **Commit source edits in a dedicated `jj workspace add` worktree** — NOT the shared
   default working copy — so parallel snapshots can't shadow them.
7. **Archive + sync specs** with `openspec-archive-change`, push, verify develop tip
   actually carries the source bumps (not just the docs).

## 3. How the collaboration unfolded

**Phase 1 — Scaffold & de-dupe (21:04–21:10).** The `openspec new change` call collided
with a pre-existing **dot-named** directory `bump-pi-compat-to-0.75/` holding complete
artifacts. The AI moved them to the CLI-valid hyphen name and re-validated. *Effective bit:*
it noticed the empty new scaffold vs. the populated dot-dir before blindly proceeding.

**Phase 2 — Coherence check (21:10–21:13).** On the human's "check the current source
state and other active proposals" the AI grepped every "before" value in `tasks.md`
against live source. It caught that `offline-packages.json` no longer exists — so the
spec delta needed a `## REMOVED Requirements` block, not a modify-around. It also added
tasks for the `pick-node.ts` mirror predicate and bundled-extension peer-deps.

**Phase 3 — Apply (21:13–22:43).** Six source files edited, a new repo-lint test written
(`bundled-node-meets-pi-floor.test.ts`), full suite run: **6340 passed / 17 skipped**.
Tasks that referenced removed surfaces were left unchecked and later marked OBSOLETE.

**Phase 4 — Smoke tests (23:28–02:00).** The human switched to dev mode ("stop electron
dashboard server and start local one in dev mode") so changes could be tested live. The
AI drove the fork smoke via `pi-agent-browser`; when the UI Fork button click didn't
propagate, it fell back to a **raw WebSocket** `resume_session {mode:"fork"}` and proved
the fork produced a distinct session id / JSONL / REST route. The RPC-keeper slash
dispatch smoke passed the same way. Model-proxy compaction was **deferred** (no custom
provider configured; fix is pi-side, proxy is passthrough).

**Phase 5 — The "lost" saga (02:03–03:26).** The human flagged `bump-pi-compat-to-0.75
lost` — the edits had been reverted. Root cause: **two machines** (`home-imac-9534`,
`home-imac-9574`) interleaving `jj` snapshots; a parallel `jj restore` + bookmark-move
landed only the editor proposals onto develop and shadowed the source edits. The AI
recovered them from unreferenced commit `f3fe9a4e`, but the reversion recurred. Final
fix: a **dedicated `jj workspace add` worktree** (`.shadow/bump-pi-compat-to-0-75/`) with
its own `@`, so future parallel snapshots cannot shadow the edits. 20/20 tests passed
there; committed, bookmarked, pushed.

## 4. Prompts that worked

- **Goal prompt** (`/skill:openspec-ff-change`): fine as a kickoff, but it assumes a clean
  slate. **Stronger:** *"Fast-forward `bump-pi-compat-to-0-75`; first check for a dot-named
  duplicate and reconcile it, then coherence-check every 'before' value against source."*
- **"Check the current source state and other active proposals and check this"** —
  high-leverage. It forced the pre-apply coherence pass that caught the stale
  `offline-packages.json` anchor before it corrupted the spec delta.
- **"There is user tests, I switched dev mode on, so the changes can be tested"** — cleanly
  split the division of labor (human clicks / AI preps) and unblocked the smokes.
- **"There is an extension pi-agent-browser"** — a one-liner that redirected the AI from
  "you'd need to install agent-browser" to actually driving the browser headlessly.
- **"bump-pi-compat-to-0.75 lost"** / **"Some unstaged file was lost"** — terse but
  decisive; each triggered a recovery from the `jj` op log.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the scaffold and skip source verification | "check the current source state … and check this" | Always coherence-check `tasks.md` "before" values vs. live source *before* apply |
| Assume manual smokes need a human at the browser | "There is an extension pi-agent-browser" / "make the tests with browser" | Reach for `pi-agent-browser` + WS bypass for UI smokes up front |
| Commit source edits into the shared default working copy | "bump-...-lost" (twice) → "Create a worktree … and add the source edits there" | Land isolated changes in a dedicated `jj workspace add` worktree, never the shared `@` |
| Add strikethrough/notes but not flip checkboxes | "some tests was made and the tasks was not updated" | Flip `[ ]`→`[x]` (or OBSOLETE) at the moment the work lands, not later |
| Report "done/pushed" before verifying develop tip | "Maybe it is already archived?" / recheck | After push, grep develop's actual files for the bumped values, not just the archive |

Scope also expanded mid-session: a **`bump-pi-compat-to-0-76`** companion (pi 0.76 shipped
that day) and a **`restore-pi-version-skew-surface`** follow-up (the dead
`/api/bootstrap/status` UI surface) were scaffolded as the picture clarified.

## 6. Skills, tools & memory created — and why they're effective

No new skill was created — but the session *screams* for one. **Recommended skill:
`jj-worktree-isolated-edit`** — capturing the hard-won pattern: when multiple pi
sessions/machines share a repo, land any non-openspec source edits in a
`jj workspace add .shadow/<name>` worktree with its own `@`, commit + bookmark + push
from there, then verify the remote tip carries the edits. This removes the exact 90-minute
loss loop this session hit twice. Reusable tools that proved their worth:
- **`pi-agent-browser` + raw WebSocket bypass** for UI smokes when a click won't propagate.
- **`jj op log` + `jj restore --from <commit>`** to recover shadowed edits from an
  unreferenced commit (`f3fe9a4e` here).

## 7. Pitfalls & dead ends

- **Dot vs. hyphen change name:** `openspec new change bump-pi-compat-to-0.75` failed;
  the CLI needs `bump-pi-compat-to-0-75`. If you inherit a dot-named dir, `mv` it first.
- **Parallel-workspace shadowing:** committing source edits to the shared default working
  copy got them silently reverted by another machine's `jj` snapshot — twice. **Fix:**
  dedicated worktree. Symptom to watch: file sizes/timestamps snap back to pristine.
- **Stale spec anchors:** `offline-packages.json` was already removed by
  `eliminate-electron-runtime-install`; the spec delta had to REMOVE the requirement, not
  edit around it. Always grep that referenced files still exist.
- **Removed UI surface:** tasks 3.4 / 6.1 / 6.2 (bootstrap banner) referenced
  `/api/bootstrap/status`, which now returns SPA fallback HTML — mark OBSOLETE, don't try
  to smoke-test them.
- **UI Fork click didn't fire** via agent-browser (a click-target quirk, *not* a 0.75
  regression) — the WS path worked perfectly.
- **`jj restore` scope trap:** an early recovery restored only `openspec/changes/` and
  missed the actual source files — verify *both* docs and source landed.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the upstream pi version to track (`0.75.5`), the pi Node floor
(`22.19.0`), dev-mode dashboard running, `pi-agent-browser` installed for UI smokes.

- [ ] Reconcile any dot-named change dir → hyphen (`bump-pi-compat-to-0-75`).
- [ ] Coherence-check every `tasks.md` "before" value vs. live source; fix stale anchors.
- [ ] Edit the 6 source files (root + server `package.json`, `node-guard.ts` + test,
      `bundled-node-meets-pi-floor.test.ts`, bundled-extension peer-deps, CHANGELOG).
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Tests ' /tmp/pi-test.log` → green.
- [ ] Mark removed-surface tasks OBSOLETE; scaffold follow-up proposals for dead code.
- [ ] Run UI smokes via `pi-agent-browser`; WS-bypass (`resume_session {mode:"fork"}`) if a click won't propagate.
- [ ] **Commit in a `jj workspace add .shadow/<name>` worktree**, bookmark, push.
- [ ] `openspec-archive-change` + sync specs; then **grep develop's files** to confirm the source bumps actually landed.

**Final artifacts:** `openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/`,
source edits in commit `04b6fa2e` on bookmark `bump-pi-compat-to-0-75`, active follow-ups
`bump-pi-compat-to-0-76` + `restore-pi-version-skew-surface`.

---

_Generated from session `019e6ad2-9f12-79c2-949b-c1f1d0bf7331` · `pi-agent-dashboard` · 2026-05-28. Source extract: `/tmp/facts-bump-69130.md`._
