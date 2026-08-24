---
session: 019e7a39
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [fix-changed-files-desktop-route, redesign-session-card-and-composer]
proposal_excerpt: "Clicking the **Changed Files** button in the SessionHeader on desktop navigates to `/session/:id/diff` but the URL change collapses the entire content pane into the global `<LandingPage>` (\"Pick a session on the left…"
---

# How we did it: fix the desktop Changed-Files diff route — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt invoked the `openspec-apply-change` skill against the change
`fix-changed-files-desktop-route`. The real objective: on desktop, clicking **Changed
Files** in the SessionHeader navigates to `/session/:id/diff`, but the route change
collapsed the whole content pane into the global `<LandingPage>` empty state ("Pick a
session on the left…") instead of showing the diff. The user wanted the one-line
routing bug fixed **and driven all the way to a merged PR + archived OpenSpec change** —
with a real manual browser verification along the way, done safely against a live
dashboard that must not be disturbed.

## 2. TL;DR playbook

1. `/opsx-apply fix-changed-files-desktop-route` — announce the change, read
   `openspec status --json`, skip manual/post-merge tasks (1.x, 4.x, 6.x).
2. Read `App.tsx`; discover the `selectedId` derivation ignores the `/diff` match.
   **Don't** write a 200-line full-`<App />` render test — flag it and extract a pure
   helper instead (`deriveSelectedSessionId`).
3. Create `packages/client/src/lib/selectedSessionId.ts` + a 5-case unit test; run
   `npx vitest run` (use `HOME=$(mktemp -d)` if the real HOME poisons the run), then
   the full suite.
4. **Manual verify without killing the live server:** run worktree Vite on port 3000,
   **proxy API/WS to the already-running prod dashboard on 8000** — touch nothing on
   disk. Navigate directly to `/session/<id>/diff` in agent-browser.
5. Revert exploration pollution before committing: `git checkout -- .pi/settings.json
   packages/client/src/generated/plugin-registry.tsx`; restore
   `~/.pi/agent/settings.json` (the `pi-dashboard --help` call injected the worktree
   bridge path).
6. Commit surgically → push branch → `gh pr create --base develop`.
7. On conflicts: `git rebase origin/develop`, resolve the mechanical docs-row merge
   (keep both annotations), retest, `git push --force-with-lease` to retrigger CI.
8. Poll `gh run view <id>` in increasing `sleep` steps until 10/10 green; `gh pr merge
   --squash`; delete remote branch.
9. Archive on **develop in the main worktree** (not the feature branch): sync the delta
   spec into `openspec/specs/…`, `mv` to `archive/<date>-<change>/`, open a second PR
   (#61) rather than pushing to develop, watch CI, merge.

## 3. How the collaboration unfolded

**Phase 1 — Apply the fix (skill-driven).** The AI selected the change, parsed
`openspec status`, and immediately triaged tasks: implement code (3.x), skip the
manual repro (1.1) and post-merge steps. The pivotal move was a **scope objection** —
tasks 2.1/2.2 prescribed rendering the 1,714-line `<App />` (≈80 imports, real
sockets) with no existing fixture to crib. The AI refused to write 200 lines of
`vi.mock` scaffolding for a 1-line bug and proposed **option B**: extract a pure
`deriveSelectedSessionId()` helper and unit-test that. Human approval → 5 tests, full
suite (6785) green.

**Phase 2 — Safe manual verification (human steered).** The human's steering prompt —
*"compile and build the worktree version and perform with browser. Be careful! The pi
settings points to bridge which may be invalid"* — set the guardrail. The AI first
considered running the worktree server on an isolated port+HOME, then chose the
lighter path: **serve the new client via Vite, proxy API/WS to the live dashboard on
8000**, so nothing on disk changed. It drove agent-browser to `/session/<id>/diff` and
confirmed `<FileDiffView>` rendered the exact 4 edited files.

**Phase 3 — Cleanup & commit.** The AI detected the predicted pollution: an early `npx
pi-dashboard --help` had registered the worktree bridge path in
`~/.pi/agent/settings.json`, and Vite had rewritten a generated file. It reverted all
of it (with a `.bak`) before a surgical commit `7bdb09f8`.

**Phase 4 — PR, conflicts, CI.** Steering `monitor CI` drove a rebase onto develop
(only `docs/file-index-client.md` conflicted — both sides appended an annotation to the
same App.tsx row; kept both), a retest (6814 passed), a force-push, and patient
`gh run view` polling to 10/10 green across Linux+Windows smokes.

**Phase 5 — Merge & archive.** `Merge PR` → squash `e75859e2`. The AI correctly moved
archiving to the **main worktree on develop**, synced the MODIFIED delta spec (+2
scenarios) into the canonical spec, navigated around **pre-existing index pollution
from another agent's WIP** (used `git commit --only <paths>` to avoid touching it),
recovered from a detached HEAD, and shipped the archive as its own PR #61 rather than
pushing to develop.

## 4. Prompts that worked

- **Goal prompt** — invoking `/opsx-apply <change>` with an explicit change name gave
  the AI an unambiguous scope and a task ledger to work down. Strong kickoff: name the
  change, let the skill drive.
- **`compile and build the worktree version and perform with browser. Be careful! The
  pi settings points to bridge which may be invalid`** — the highest-leverage prompt.
  It named the *hazard* (invalid bridge) up front, which is exactly why the AI chose a
  disk-safe proxy setup and later hunted down the settings pollution.
- **`monitor CI`** — two words that unlocked the whole rebase→resolve→force-push→poll
  loop.
- **`Merge PR` / `yes`** — terse approvals that let the AI carry a long tail (merge →
  archive → sync → second PR) without re-litigating each step.

Weak-prompt rewrite: instead of `go on`, a future operator should say *"proceed:
commit, push, open PR against develop"* so the AI doesn't have to re-derive scope.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Follow tasks literally (full `<App />` render test) | (AI self-flagged; human approved option B) | State "prefer a pure extracted helper over full-component render tests" as a repo convention |
| Risk touching the live dashboard for manual QA | "Be careful! pi settings points to bridge which may be invalid" | Default to **Vite-proxy-to-live-server** for worktree UI verification; never restart prod |
| Leave exploration side-effects (`pi-dashboard --help` bridge injection, Vite-rewritten generated file) | Implicit "be careful" | Revert `.pi/settings.json`, `plugin-registry.tsx`, and `~/.pi/agent/settings.json` before every commit |
| Commit into a polluted index / push to develop | (AI self-corrected) | Use `git commit --only <paths>`; archive via a PR, never a direct develop push |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session, but the workflow is squarely
repeatable and a skill **should** exist:

- **`isolated-ui-verification`** (already a project skill) captures the exact
  Vite-proxy-to-live-8000 pattern used here — invoke it whenever you need to eyeball a
  worktree client change without disturbing the running dashboard.
- Two subagents (`Explore`, `general-purpose`) were spawned only to append the
  caveman-style annotation to the `App.tsx` row in `docs/file-index-client.md` — the
  docs-update delegation protocol working as designed.
- A memory worth saving: *"For worktree UI QA, run Vite on 3000 and proxy API/WS to the
  live dashboard on 8000; revert `~/.pi/agent/settings.json` bridge pollution from any
  `pi-dashboard` CLI call before committing."*

## 7. Pitfalls & dead ends

- **Vitest reads real HOME** — the first `vitest run` needed `HOME=$(mktemp -d)` to get
  a clean run. Use an isolated HOME when a test picks up host config.
- **`pi-dashboard --help` mutates settings** — it absolutized and registered the
  worktree's `packages/extension` bridge into `~/.pi/agent/settings.json`. Always check
  and revert (a `.bak` was kept).
- **Vite rewrote a generated file** (`plugin-registry.tsx`) — revert generated artifacts
  before staging.
- **PR opened with conflicts → no CI** — a dirty merge state suppressed workflow runs;
  rebasing + force-pushing cleared it and retriggered CI.
- **Pre-existing index pollution in the main worktree** (staged deletes/adds from
  another agent's WIP) — do **not** try to clean it; use `git commit --only <paths>` to
  stage just your files, and recover from any resulting detached HEAD by branching.
- **Archive on the wrong branch** — the feature branch is the merged head; archiving
  belongs on `develop` in the main worktree, shipped as its own PR.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, a running prod dashboard on :8000,
`gh` auth, worktree checked out.

1. `/opsx-apply <change>` — implement code tasks; skip manual/post-merge.
2. Prefer a pure extracted helper + unit test over a full-component render test.
3. `npx vitest run <test>` (isolate HOME if needed) → full suite green.
4. Manual QA: worktree Vite :3000 proxying API/WS to live :8000; agent-browser to
   `/session/<id>/diff`.
5. Revert pollution: `.pi/settings.json`, `plugin-registry.tsx`, `~/.pi/agent/settings.json`.
6. Surgical commit → push → `gh pr create --base develop`.
7. Rebase/resolve/`--force-with-lease` on conflict; poll `gh run view` to 10/10 green.
8. `gh pr merge --squash --delete-branch`.
9. On develop (main worktree): sync delta spec → `mv` to `archive/<date>-<change>/` →
   second PR → CI green → merge.

**Artifacts produced:**
- `packages/client/src/lib/selectedSessionId.ts` (new helper)
- `packages/client/src/__tests__/selectedSessionId.test.ts` (5 tests)
- `packages/client/src/App.tsx` (derive `selectedId` via helper)
- `docs/file-index-client.md` (App.tsx row annotation)
- PR #59 (fix, squash `e75859e2`) · PR #61 (archive + spec sync, `9be8a3fa`)
- `openspec/changes/archive/2026-05-30-fix-changed-files-desktop-route/`

---

_Generated from session `019e7a39-3d4f-7a72-a682-3f014121264b` · `pi-agent-dashboard` · 2026-05-30. Source extract: session-to-guideline facts sheet._
