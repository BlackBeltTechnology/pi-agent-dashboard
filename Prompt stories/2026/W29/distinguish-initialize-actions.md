---
session: 019f5aeb
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [distinguish-initialize-actions]
proposal_excerpt: "The sidebar renders a single amber \"Initialize\" button (`WorktreeInitButton.tsx`) that is polymorphic on `init-status.hasHook` and hides two semantically different actions behind an identical label, icon (`mdiCogPlayO…"
---

# How we did it: Distinguish the two "Initialize" actions — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change distinguish-initialize-actions
```

The real objective (already written into the OpenSpec proposal) was a UX/architecture
fix: the sidebar rendered **one** amber "Initialize" button (`WorktreeInitButton.tsx`)
that was *polymorphic* on `init-status.hasHook` — the same label and icon hid two
semantically different actions (scaffold a fresh project vs. run an existing init hook).
The change had to split that one button into two monomorphic components driven by a
single shared status probe, add a `configured` signal to the server's `init-status`
route so the client can tell the three states apart, and land the whole thing green.
The second prompt — `ship-change` — extended the goal from *implement* to *merged on
`develop`*.

## 2. TL;DR playbook

1. **Apply the change task-by-task**: `/skill:openspec-apply-change <name>` — read
   `tasks.md` first, then walk tasks in order (server → shared type → client → wiring →
   docs → verify).
2. **TDD each layer**: write/adjust the failing test, then the implementation, then run
   *only that test file* (`HOME=$(mktemp -d) npx vitest run <file>`) before moving on.
3. **Split the polymorphic component into two monomorphic ones**, fed by one shared
   `useInitStatus(cwd)` hook — "ONE fetch feeds both children" (design D4). Keep the
   old component's standalone tests green with a self-probe fallback.
4. **Gate the new button with strict `=== false`** so a degraded/absent probe *hides* it
   (fail-safe), never shows a wrong action.
5. **Run the full suite once** (`npm test | tee /tmp/pi-test.log`), then **prove any red
   is pre-existing and yours-untouched** with `git status --porcelain` + a base-branch
   diff before proceeding.
6. **Run the security checkpoint over the diff** — confirm the trust gate (`isTrusted`/
   `runInitHook`) is untouched and no new file-content reads were added.
7. **Update the per-file `AGENTS.md` rows** for every new/changed file (project doc rule).
8. **`ship-change`**: verify gate → archive + sync delta specs → commit → push → PR →
   watch CI → drain CodeRabbit → squash-merge → remove worktree.

## 3. How the collaboration unfolded

Two prompts drove a 1h16m, 18-task session. Group the activity into four phases.

### Phase A — Apply (TDD, layer by layer)
**What the AI did:** read `tasks.md`, then implemented in dependency order — server route
(`git-routes.ts` gains `configured:boolean` on every `hasHook:false` response), shared
type (`WorktreeInitStatus.configured?`), new presentational `ProjectInitButton.tsx`,
slimmed `WorktreeInitButton.tsx` (removed the no-hook branch + `onInitializeProject`
prop), a shared `useInitStatus` hook, and `FolderActionBar` wiring both buttons off one
probe. Each step ran its own vitest file in an isolated `HOME`.
**Why it worked:** the *one-fetch-two-buttons* refactor removed the polymorphism at its
root instead of adding another `if` branch; strict `=== false` gating made the new button
fail safe. Running one test file per task caught regressions immediately.

### Phase B — Verify the gate honestly
**What the AI did:** ran the full suite, hit 17 failures, and *proved* they were all in
the untouched `image-fit-extension` (jimp `0.16.13` lockfile vs required `^1.6.1`),
identical on `origin/develop`, zero diff on this branch. Ran the security-hardening
checkpoint over the diff and the Biome quality gate on changed files, then updated the
`AGENTS.md` rows.
**Decision point:** the AI did **not** silently accept red — it distinguished
*pre-existing base-branch drift* from a real regression before continuing.

### Phase C — Ship (archive + PR + CI)
**What the AI did:** on `ship-change`, verified all 18 tasks checked, synced the two delta
specs (`folder-action-bar`, `git-operations-api`) into the main specs, moved the change to
`openspec/changes/archive/2026-07-13-…`, committed, pushed, opened **PR #298**, and
watched CI to green.

### Phase D — Drain review + merge
**What the AI did:** treated CodeRabbit's first "pass/0 comments" as a possible rate-limit
ACK, re-fetched, and found **1 real actionable comment** (a stale `resolveMainPath` →
`resolveConfigRoot` naming in the archived `design.md`). Verified it against the code,
applied the doc-only fix, re-pushed, looped CI green, confirmed **zero unresolved review
threads** via GraphQL, then squash-merged (`f5df270a3b`) and removed the worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change distinguish-initialize-actions`.**
  Effective because the *proposal already existed*: the skill reads `tasks.md` and the
  design doc, so a one-line invocation unlocked a fully-scoped, task-ordered
  implementation. The upstream investment (a good proposal with a D4 "one fetch feeds
  both" design note) is what made this one word enough.
- **The high-leverage follow-up — `ship-change`.** One word promoted the work from
  "implemented" to "merged," delegating the entire archive → PR → CI → CodeRabbit → merge
  pipeline to the skill.
- **Rewrite for a weaker starting point:** if no proposal exists yet, don't jump to
  `openspec-apply-change`. Say: *"Draft an OpenSpec change that splits the polymorphic
  Initialize button into two monomorphic components fed by one shared status probe; add a
  `configured` flag to the init-status route so the client can tell scaffold-vs-run-hook
  apart."*

## 5. Steering & corrections (what to watch for)

This session needed almost no live steering (2 prompts) — the guardrails were pre-baked
into the proposal and the skills. The judgment calls the AI made *on its own* are the ones
worth codifying:

| The AI tended to… | The disciplined move was… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a red full-suite as a blocker | Prove the 17 failures were pre-existing `image-fit-extension` jimp drift, identical on `develop`, zero diff on the branch | State up front: "a red gate must be proven pre-existing (base-branch diff) before proceeding, and never touch dependency/lockfile code to 'fix' it" |
| Trust CodeRabbit's first "0 comments" | Re-fetch — it was a rate-limited ACK; the real review had 1 actionable comment | Always re-poll CodeRabbit; a fast "pass" is suspect |
| Add another `if hasHook` branch | Split into two monomorphic components + one shared `useInitStatus` hook (design D4) | Put the "one fetch feeds both children" rule in the design doc |
| Show a button on a degraded probe | Gate with strict `=== false` so an absent `configured` *hides* the scaffold button | Make fail-safe (`=== false`) the default for action buttons |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a *consumer* of existing project
skills, and that is exactly why it ran on two prompts:

- **`openspec-apply-change`** — walks `tasks.md` in order, enforces TDD per task, and runs
  the quality/security checkpoints. Removes the need to hand-drive an 18-task
  implementation. Invoke it whenever a proposal + `tasks.md` already exist.
- **`ship-change`** — the archive → sync-specs → commit → PR → CI-watch → CodeRabbit-drain
  → squash-merge → worktree-remove pipeline. Invoke it the moment implementation is green.
- **The security-hardening checkpoint** — a diff-scoped trust-gate review (confirm
  `isTrusted`/`runInitHook` untouched, no new file-content reads). Invoke it on any change
  that touches init hooks, auth, or untrusted input.

If you find yourself repeating the "prove red is pre-existing base-branch drift" dance,
that's the candidate worth saving as a memory/skill.

## 7. Pitfalls & dead ends

- **Full suite shows red that isn't yours.** 17 `image-fit-extension` failures were jimp
  version drift (`0.16.13` vs `^1.6.1`) already on `develop`. → Confirm with
  `git status --porcelain | grep <pkg>` and a base-branch diff; do **not** touch the
  lockfile to fix an unrelated package.
- **Biome `--changed` finds 0 files** on an uncommitted worktree (no base diff). → Run
  `npx biome check --write <explicit changed files>` instead.
- **`sed -i ''` on tasks.md failed** (one of the 7 failed commands). → Prefer editing the
  checkbox lines with the `edit` tool, or verify the `sed` portability flag on macOS.
- **CodeRabbit "0 comments" can be a rate-limit ACK**, not a clean review. → Re-fetch the
  review body + inline threads; the real actionable comment may arrive late or land in the
  review body when inline posting fails.
- **Squash-merge trips the worktree-collision pitfall** — `gh pr merge` tries to update the
  local `develop` checkout and errors even though the merge *succeeded* on GitHub. → Check
  the PR state (`MERGED`, commit `f5df270a3b`) directly; the error was only the local
  update.
- **Removing the worktree kills the shell's cwd.** After `git worktree remove`, the bash
  tool's pinned cwd is gone and further commands fail. → Run final cleanup from the parent
  repo path explicitly, or accept that the ship is already verified complete.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- An OpenSpec change with a real `proposal.md` + `design.md` (with the "one fetch feeds
  both" note) + `tasks.md`, in a dedicated worktree.
- `gh` authenticated; branch pushed target = `develop`.

**Steps:**
1. `/skill:openspec-apply-change distinguish-initialize-actions` — walk tasks in
   dependency order (server → type → components → wiring → docs → verify), TDD each.
2. Split the polymorphic button into two monomorphic components + one `useInitStatus`
   hook; gate the new button with strict `=== false`.
3. Add `configured:boolean` to every `hasHook:false` init-status response; leave the
   `hasHook:true` (trust-gate) branch untouched.
4. `npm test | tee /tmp/pi-test.log`; prove any red is pre-existing (base-branch diff),
   run the security checkpoint + `npm run quality:changed`, update `AGENTS.md` rows.
5. `ship-change` → verify gate → sync delta specs + archive → PR → watch CI →
   re-poll CodeRabbit + apply its actionable fix → squash-merge → remove worktree.

**Final artifacts produced:**
- `packages/client/src/components/ProjectInitButton.tsx` (+ test)
- `packages/client/src/hooks/useInitStatus.ts`
- Slimmed `packages/client/src/components/WorktreeInitButton.tsx`
- `packages/server/src/routes/git-routes.ts` (`configured` flag)
- PR **#298** — MERGED (squash `f5df270a3b`) into `develop`.

---

_Generated from session `019f5aeb` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: deterministic facts sheet (mktemp)._
