---
session: 019f154b
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-expanded-pinned-group-drag]
proposal_excerpt: "Pinned directory groups in the sidebar cannot be reordered by drag-and-drop **when they (or the intended drop target) are expanded**. Collapsing first, dragging, then expanding works — but the friction is hostile and…"
---

# How we did it: rechecking a stale OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a three-word prompt — **"Recheck this proposal"** — pointed at the
OpenSpec change `fix-expanded-pinned-group-drag`. The proposal claimed that pinned
directory groups in the sidebar couldn't be drag-reordered while expanded, and proposed
a type-aware collision-detection fix.

The *real* objective, once the recheck ran, was not "implement the proposal" but
**"figure out whether this proposal is still true, and close it out correctly."** It
turned out the fix had already shipped weeks earlier under a different change. The genuine
work became: prove staleness with evidence, backfill the one missing regression test,
repair pre-existing spec corruption blocking the archive, and land a clean commit.

## 2. TL;DR playbook

1. **Read the whole change dir first.** `cat proposal.md design.md tasks.md` and any
   `specs/` deltas — get the claimed mechanism and file/line references in one pass.
2. **Verify each claim against live source.** Grep for the proposed helper
   (`sameTypeClosestCenter`), confirm it exists and is wired into the real `DndContext`.
   Use `git log -S "<symbol>"` to find *when/where* it actually shipped.
3. **State the verdict early.** "This proposal is already fixed / stale" — with the exact
   file:line evidence — before doing any more work. Let the human choose the close-out path.
4. **On "option 1", backfill only the true gap.** Here: a component-level regression test.
   Study the existing test style first, then mock `@dnd-kit/core`'s `DndContext` to capture
   the live `onDragEnd` and drive the reorder branch directly (jsdom can't do geometric hits).
5. **Run the exact test with the repo's runner invocation** (vitest wasn't on PATH — call
   `node node_modules/vitest/vitest.mjs run <file>` with isolated `HOME`/localstorage temp).
6. **Reflect reality in tasks.md**, then `openspec validate` → `openspec archive -y`.
7. **Fix pre-existing archive blockers surgically** (delta header leaked into main spec,
   missing `## Purpose`, a requirement with no scenario) — note each as pre-existing.
8. **Commit only files you touched.** Diff `git status`, exclude unrelated working-tree
   edits (`groups.json`, other change dirs), write a commit body explaining the recheck.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / verify the claim (Prompt 1).** The AI read the full change dir,
then grepped the client source for the proposed collision-detection helper. It found
`sameTypeClosestCenter` already living in `packages/client/src/lib/sidebar-dnd.ts:24`,
already wired into the single sidebar `DndContext` at `SessionList.tsx:1051`, with the
cross-type guard intact. `git log -S "sameTypeClose…"` pinned the actual ship: commit
`ccbcb105` on 2026-06-20 under `workspace-directory-drag-reorder`. **Why it worked:** the
AI treated the proposal's "Why" as a hypothesis to falsify, not a spec to build, and
produced file:line + commit-hash evidence instead of a vibe.

**Phase 2 — Verdict + decision point (Prompt 2 = "1").** The AI delivered a crisp "stale,
recommend archive" verdict and surfaced the *one* real gap: no component-level regression
test for the expanded pinned-group case. The human picked option 1 with a single character.

**Phase 3 — Backfill the test.** The AI studied the existing drag tests
(`workspace-drag-reorder.test.tsx`), learned they only assert rendering, and wrote a new
test that mocks `@dnd-kit/core` to capture `onDragEnd` and drive the pinned-group + session
branches directly. **Why it worked:** it matched existing test conventions before inventing,
and understood the environment constraint (jsdom has no geometry) rather than fighting it.

**Phase 4 — Archive + spec repair.** `openspec archive` aborted on a *pre-existing*
structural defect: a delta `## ADDED Requirements` header had leaked into the live main
spec, hiding every requirement; the spec also lacked `## Purpose` and had a scenario-less
requirement. The AI fixed all three surgically, re-ran archive successfully, and confirmed
the 4 new expand-state scenarios merged into the main spec.

**Phase 5 — Commit (Prompt 3 = "commit").** The AI diffed the working tree, spotted that
`groups.json` and a separate untracked change dir were unrelated, staged only the relevant
files, and committed with a body explaining the recheck finding.

## 4. Prompts that worked

- **The goal prompt — "Recheck this proposal."** Terse but effective *because the context
  was unambiguous* (one active change dir). A stronger version for a noisier repo:
  *"Recheck OpenSpec change `fix-expanded-pinned-group-drag` against live source — is its
  claimed fix still needed? Give file:line evidence and a keep/close verdict."*
- **"1"** — a high-leverage one-character follow-up. It worked only because the AI had
  *presented explicit numbered options* with the verdict. Lesson: when you expect a fork,
  end your report with numbered choices so the human can steer in one keystroke.
- **"commit"** — trusted the AI to scope the commit itself. Worked because the AI had been
  transparent about what it touched; it still re-verified staging before committing.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the proposal describes work to *do* | The task was "recheck" — verify before building | Treat any "recheck/review" ask as falsify-the-claim, not implement-the-spec |
| Present a verdict and want to keep going | "1" — pick the close-out path | End recheck reports with numbered options and STOP for the choice |
| Risk committing unrelated working-tree edits | (self-caught) excluded `groups.json` + other change dir | Always `git status` + explicit `git add <paths>`; never `git add -A` on a shared tree |
| Get blocked by pre-existing spec corruption | (self-caught) fixed header/Purpose/scenario inline | Expect legacy delta-header leakage in main specs; repair minimally and label pre-existing |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this was a one-off recheck. The reusable pattern,
though, is worth a skill: **"recheck-openspec-proposal"** — read change dir → falsify each
claim against live source with `git log -S` → verdict with numbered close-out options →
backfill only the true gap → archive (repairing pre-existing spec defects) → scoped commit.
A `general-purpose` subagent was spawned once to add file-index rows per the repo's
Documentation Update Protocol (per-file docs must be delegated) — the right call, keeping
the main context focused on the fix.

## 7. Pitfalls & dead ends

- **vitest not on PATH.** `npx vitest` / `node_modules/.bin/vitest` failed. Working
  invocation: `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" node
  node_modules/vitest/vitest.mjs run <file>`. The temp HOME/localstorage avoids polluting
  the real profile.
- **jsdom can't reproduce geometric drag collisions.** Don't try to simulate pointer
  geometry — mock `@dnd-kit/core`'s `DndContext` to capture the live `onDragEnd` and call
  the reorder branch directly.
- **`openspec archive` aborts on pre-existing main-spec corruption.** A leaked
  `## ADDED Requirements` delta header, a missing `## Purpose`, and a scenario-less
  requirement all block archive. Fix them surgically; they are not caused by your change.
- **Shared working tree has unrelated edits.** `groups.json` had board reassignments the
  session never made. Stage explicit paths only.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a clean-ish idea of the proposed
mechanism (helper/symbol name) to grep for.

- [ ] `cat` the full change dir (proposal + design + tasks + specs deltas)
- [ ] Grep live source for the proposed symbol; confirm it exists + is wired in
- [ ] `git log -S "<symbol>" --oneline` → find the actual ship commit/date
- [ ] Write the verdict (stale/valid) with file:line + commit evidence, **numbered options**
- [ ] On close-out: backfill only the missing test (match existing test style; mock `DndContext`)
- [ ] Run it: `node node_modules/vitest/vitest.mjs run <file>` with temp HOME/localstorage
- [ ] Update tasks.md to reality → `openspec validate` → `openspec archive -y`
- [ ] Repair any pre-existing spec defects blocking archive (label them pre-existing)
- [ ] `git status` → stage explicit paths only → commit with a recheck-explaining body

**Artifacts produced:**
`packages/client/src/components/__tests__/SessionList.expanded-pinned-drag.test.tsx`,
edited `openspec/specs/pinned-directories-ui/spec.md` + `.../tasks.md`, archived change
`2026-06-29-fix-expanded-pinned-group-drag`, commit `d62c7c4e`.

---

_Generated from session `019f154b-2acb-7eb7-9f61-bac163b33b34` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-29. Source extract: session-to-guideline facts sheet._
