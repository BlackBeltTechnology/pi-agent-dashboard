---
session: 019f0659
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [improve-frontmatter-rendering]
proposal_excerpt: "`MarkdownContent` loads only `remark-gfm` + `remark-math` — no frontmatter plugin. So CommonMark misparses every YAML frontmatter block: the leading `---` becomes a thematic break (`<hr>`), the YAML lines become a par…"
---

# How we did it: Ship an OpenSpec change through a pre-existing CI break — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change improve-frontmatter-rendering
```

The real objective: render YAML frontmatter in markdown previews as an Obsidian-style
**Properties panel** instead of the CommonMark misparse (leading `---` → `<hr>`, YAML
lines → a paragraph). Then — via one steering turn — **actually land it**: implement all
16 tasks, verify, archive the change, open a PR, and drive it green through CI to merge.
The twist that dominated the second half: CI was already red on `develop` for a reason
unrelated to the feature, and the session had to diagnose and fix *that* without
smuggling scope into the feature PR.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <name>` — let the apply skill read the proposal, spec
   deltas, mockups, and existing code before writing anything.
2. Implement task-by-task against `tasks.md`; add the two deps (`remark-frontmatter`,
   `yaml`), keep `package.json` alphabetically ordered, confirm all icons resolve.
3. Write the component + tests **first**, run the scoped vitest file, then the full suite.
   Isolate any failure — re-run the single suspect test to prove it's flaky/unrelated.
4. Run the quality gate on the **touched files directly** (`npx biome check --write …`)
   when `biome --changed` finds nothing because the work is uncommitted.
5. For a visual check, build a **throwaway scratch harness** that mounts the *real*
   component with sample data, serve via Vite, screenshot light + dark, then delete it.
6. `use ship-change skill` — verify → archive+sync specs → commit → push → PR → watch CI.
7. When CI goes red, **first prove whether it's yours**: compare your lockfile diff to the
   failure, and check whether `develop`'s own recent runs fail identically.
8. If it's a pre-existing infra break, fix it as a **separate PR from `develop`** in its
   own worktree, merge that first, then rebase the feature branch onto the fix.
9. Merge the feature PR only when CI is green *and* review is clean; remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (implement the feature).** The apply skill read the proposal, spec
scenarios, mockups, and the existing `MarkdownContent`/preview call sites before touching
code. It added `remark-frontmatter` + `yaml`, kept `package.json` alphabetical (caught
`yaml` sorting after `wouter`), and built `FrontmatterProperties.tsx`: an
`extractFrontmatter` that matches **only** a leading `---…---` block (CRLF-tolerant) so
mid-document `---` still renders as `<hr>`; typed rows (text/num/date/list/bool/link/obj/
empty); a `status` badge; nested objects as sub-grids; and a malformed-YAML fallback to an
orange warn banner + raw lines. It degraded to an empty fragment (not the default error
box) via `ErrorBoundary`. *Why it worked:* reading all context first meant the opt-in
surfaces (file/spec/inline preview, chat stays hidden) were wired correctly on the first
pass.

**Phase 2 — Verify.** Scoped tests first, then full suite. One failure (`recovery-server`
"no free port") was proven **flaky/unrelated** by re-running it in isolation. The quality
gate needed manual scoping because `biome --changed` saw 0 files (work uncommitted) — so
biome ran on the explicit file list. A cognitive-complexity warning in `formatRelativeDate`
was cleared by a table-driven refactor. tsc + production build both green.

**Phase 3 — Visual check.** Rather than eyeball a mockup, the AI mounted the **real**
`MarkdownContent` in a scratch Vite harness with sample frontmatter and screenshotted both
themes. It hit the `ThemeProvider` overriding a manual `data-theme` (dark = no attr,
default light in headless) and forced dark via `localStorage`. Then it **deleted the
scratch files** — no artifacts leaked into the change.

**Phase 4 — Ship.** `use ship-change` ran verify → archive. Archive aborted on a
**pre-existing** structural defect in two main specs (`## ADDED Requirements` delta header
where `## Requirements` belonged, missing `## Purpose`). The AI repaired those, reverted a
partially-applied delta so all three synced atomically, archived, committed, pushed, opened
**PR #169**.

**Phase 5 — The CI blocker.** CI died at `npm ci` on `@rollup/rollup-linux-x64-gnu`. The AI
resisted the reflex "regenerate the lockfile": it proved the feature lockfile diff touched
**zero** rollup entries and that `develop`'s last 4 runs failed **identically** — a
repo-wide macOS-generated-lockfile bug ([npm/cli#4828]). A full regen *would* fix it but
churned ~39k lines / 223 transitive bumps — out of scope. **Decision point:** the human
approved fixing the **CI workflow** instead. The AI opened **PR #170** from `develop` (own
worktree) making `npm ci` fall back to a clean install, merged it, rebased #169 onto the
fix, watched the new run green, and squash-merged. Worktree removed.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change improve-frontmatter-rendering`. Effective
  because the change already had a proposal + spec deltas + mockups; the skill supplies all
  context deterministically, so no hand-holding was needed to start.
- **High-leverage follow-up** — `use ship-change skill`. Four words that unlocked the entire
  verify→archive→PR→CI→merge pipeline. The lesson: name the *terminal* skill explicitly
  rather than asking "now what" — the skill carries the guardrails (don't merge red CI,
  scope discipline).
- A stronger opening for a fresh operator: *"Apply improve-frontmatter-rendering, then ship
  it; if CI is red, prove whether it's my change before touching the lockfile."* — folds the
  hardest guardrail of this session into the kickoff.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "implementation complete" | `use ship-change skill` | State the terminal goal (merge) in the first prompt |
| Reach for "regenerate the lockfile" to fix red CI | approve the **workflow** fix, not the lockfile bump | Rule: *never full-regen a lockfile inside a feature PR* |
| Risk mixing infra churn into the feature PR | keep the CI fix as its own PR from `develop` | One PR = one concern; infra fixes branch off `develop` |

Corrections were light because the AI self-guarded well: it isolated the flaky test, proved
the CI break was pre-existing, and refused the disproportionate fix on its own — the human
only had to bless the scoped-workflow-fix direction.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a **consumer** of existing
skills (`openspec-apply-change`, `ship-change`, `implement`'s review harness). What's worth
capturing as reusable knowledge:

- **The pre-existing-CI-break triage** (prove it's not yours → fix as separate `develop` PR
  → rebase) is exactly the pattern the repo's `ci-troubleshoot` skill documents
  (npm optional-deps / lockfile-missing-linux-node failure mode). Reach for it the moment
  `npm ci` fails on `@rollup/rollup-linux-*` or `@esbuild/linux-*`.
- **The scratch-harness visual check** (mount the real component, screenshot both themes,
  delete the harness) is a repeatable move worth a small skill if it recurs.

## 7. Pitfalls & dead ends

- **`biome --changed` finds 0 files** when the work is uncommitted → run biome on the
  explicit touched-file list instead.
- **Headless theme = light** — `ThemeProvider` overrides a manual `data-theme`; force dark
  via `localStorage` before screenshotting.
- **`openspec archive` is not idempotent** — a partial run leaves one delta applied. Revert
  the applied delta so all specs sync atomically, then re-archive.
- **Pre-existing broken main specs** (`## ADDED Requirements` delta header, missing
  `## Purpose`) abort archive — repair the header/section, don't work around it.
- **`npm ci` red on `@rollup/rollup-linux-x64-gnu`** = macOS-generated lockfile missing
  Linux platform nodes ([npm/cli#4828]). **Do not** full-regen inside a feature PR (~39k
  lines, 223 transitive bumps). Fix the workflow (clean-install fallback) as a `develop` PR.
- **Local `--delete-branch` on merge fails in a worktree** (worktree-collision) even though
  the **remote** merge succeeded — verify remote state, then clean up manually.

## 8. Reproduce it faster — checklist

- [ ] `git worktree` for the change exists; proposal + spec deltas + mockups present.
- [ ] `/skill:openspec-apply-change <name>` — implement task-by-task against `tasks.md`.
- [ ] Add deps in alphabetical `package.json` order; confirm icon/module resolution.
- [ ] Tests first → scoped vitest → full suite; isolate any failure to prove it's unrelated.
- [ ] Quality gate on touched files directly if `biome --changed` is empty; clear warnings.
- [ ] Scratch harness for visual check (both themes) → screenshot → **delete** it.
- [ ] `use ship-change skill` → verify, archive+sync specs, commit, push, PR.
- [ ] On red CI: diff your lockfile vs the failure; check `develop`'s recent runs.
- [ ] Pre-existing infra break → separate PR from `develop`, merge, rebase feature onto it.
- [ ] Merge feature PR on green CI + clean review; `git worktree remove`.

**Inputs needed:** a prepared OpenSpec change with proposal/spec/mockups, `gh` auth, and a
worktree. **Artifacts produced:** `FrontmatterProperties.tsx` + tests, updated
`MarkdownContent`/preview surfaces, synced specs, archived change
`2026-06-27-improve-frontmatter-rendering`, merged **PR #169** (feature) and **PR #170**
(CI fix).

[npm/cli#4828]: https://github.com/npm/cli/issues/4828

---

_Generated from session `019f0659` · `pi-agent-dashboard` · 2026-06-27. Source extract: session-to-guideline facts sheet._
