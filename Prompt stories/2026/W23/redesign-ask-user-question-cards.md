---
session: 019e9538
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [redesign-ask-user-question-cards]
proposal_excerpt: "The `ask_user` interactive cards have two concrete usability problems, both observed live in the dashboard:"
---

# How we did it: Redesign ask_user question cards + batch wizard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single terse line — **"openspec not shown"** — issued inside a
worktree already scaffolded for the `redesign-ask-user-question-cards` OpenSpec change.
The *real* objective, made obvious by the change already sitting in the worktree, was:
implement all 30 tasks across 8 sections of that change end-to-end — redesign the
confirm/select/multiselect/input interactive renderers **and** add a brand-new `batch`
question method that flows through shared protocol → bridge → client wizard. The three
later prompts were pure workflow drivers ("commit and push", "create PR", "is it
merged?"), not scope changes — the AI ran the entire build essentially autonomously off
the OpenSpec spec.

## 2. TL;DR playbook

1. Open the worktree and read the full change context first: `proposal.md`, `design.md`,
   `tasks.md`, the mockups, and every existing renderer + the registry.
2. Work **section by section, TDD**: for each renderer write/adjust the test first, then
   the component, then run just that suite with `HOME=$(mktemp -d) npx vitest run <file>`.
3. Extract shared shells early — `AnsweredCard.tsx` + `option-text.ts` (`splitOption` /
   `isCancelOption`) — so confirm/select/multiselect/input all reuse them (DRY, no fold).
4. For the new `batch` method, add the type in `packages/shared/src/ask-user-types.ts`
   (the exports map auto-exposes `src/*.ts`), then plumb it through `prompt-bus.ts`,
   `bridge.ts` (`ctx.ui.batch` patch), `batch-decode.ts`, `ask-user-tool.ts`, the client
   `useMessageHandler`, `prompt-answer-encoder.ts`, and register `batch` in `registry.ts`.
5. Build the `BatchRenderer` wizard (one question at a time, single bridge request) test-first.
6. Run the full suite once: `npm test 2>&1 | tee /tmp/pi-test.log`; confirm any failures
   are **pre-existing** (here: 17 `pi-image-fit` Jimp failures, unrelated) before proceeding.
7. Type-check touched packages; if a worktree symlink hides new shared types from `tsc`,
   type the runtime util **structurally** instead of importing the shared type.
8. Update the file-index docs + `architecture.md` (caveman style), mark tasks done, be
   honest about deferred manual/runtime tasks (live reload/restart), then commit → push → PR.

## 3. How the collaboration unfolded

**Discovery (read everything before typing).** The AI resisted the temptation to act on
the terse prompt and instead loaded the proposal, design, mockups, existing renderers,
registry, shared protocol, and the current tests. This mapped all 30 tasks to concrete
files before a single edit — the reason the rest of the session ran cleanly.

**Design & generate (section-by-section TDD).** Sections 1–4 (confirm → Yes/No,
select → vertical rows, multiselect answered context, input answered field) were each
built test-first and verified in isolation. The AI factored out `AnsweredCard` and
`option-text.ts` on the second section rather than duplicating logic — the DRY move that
kept four renderers consistent.

**Batch method (the deep vertical slice).** Sections 5–7 threaded a new `batch` method
through every layer: shared types, the PromptBus union, a `batch-decode` helper mirroring
the existing multiselect-decode, the `ctx.ui.batch` bridge patch, the tool branch, the
client handler/encoder, and finally the `BatchRenderer` wizard. The old sequential-loop
batch tests were rewritten for the new **single-request** contract.

**Verify & land.** Full suite → isolate pre-existing failures → build → type-check →
docs → tasks checklist → commit `614377e1` → push → PR #76 → merged to `develop`. The
human's only interventions were the three one-word workflow prompts.

## 4. Prompts that worked

- **Goal prompt — "openspec not shown"** (weak as written; worked only because the
  worktree already carried the change). A stronger kickoff: *"Implement the
  redesign-ask-user-question-cards OpenSpec change end-to-end, TDD, section by section;
  run each suite in isolation and don't stop for pre-existing failures."*
- **"commit and push"** — high-leverage: a single word gate that let the AI produce a
  well-formed conventional commit + branch + tracking without micromanagement.
- **"create PR"** — unlocked a fully-populated PR body (verification status, deferred task).
- **"is it merged?"** — a status check the AI answered against live GitHub state.

## 5. Steering & corrections (what to watch for)

The human barely steered — the value here is what the AI self-corrected. Bake these in.

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a terse prompt as actionable | (AI paused to confirm scope itself) | State the full goal + "work autonomously off the spec" up front |
| Assume shared types resolve in a worktree | (AI hit the symlink, self-corrected) | Save the worktree-symlink quirk as memory (done) and type runtime utils structurally |
| Risk counting pre-existing test failures as regressions | (AI verified they were pre-existing) | Baseline `npm test` first; only new failures block |
| Want to delegate docs to a subagent | (Explore is read-only, `@fast` didn't resolve) | Edit file-index/architecture docs directly in caveman style |
| Silently mark every task done | (AI flagged 8.3 as deferred) | Keep a "deferred manual/runtime" note in the PR body |

## 6. Skills, tools & memory created — and why they're effective

- **Memory (project · tool-quirk):** *In a git worktree under `.worktrees/`, the repo
  shares the parent's `node_modules`; the workspace symlink
  `node_modules/@blackbelt-technology/pi-dashboard-shared` resolves to the MAIN repo's
  `packages/shared`.* This is the single most reusable takeaway: it explains why new
  shared types are invisible to `tsc` from a sibling package **in a worktree only**, and
  it justifies typing runtime helpers structurally. Invoke this understanding any time a
  worktree type-check fails on a freshly-added shared export.
- **No skill was created**, but the session is a textbook repeatable workflow. A
  `implement-openspec-renderer-change` skill *should* exist capturing: read-all-first →
  section-by-section TDD → isolate suites with `HOME=$(mktemp -d)` → baseline full suite →
  structural typing for worktree symlinks → caveman docs → commit/PR. (This session is the
  premium candidate to seed exactly that.)

## 7. Pitfalls & dead ends

- **`npx vitest run` without an isolated HOME** — re-run with `HOME=$(mktemp -d) npx
  vitest run <file>` to avoid environment interference across suites.
- **`tsc --noEmit` reporting errors on a new shared export in a worktree** — it's the
  symlink resolving to the main repo's `packages/shared`. Don't chase the type; type the
  runtime util structurally, or run the check from a normal checkout.
- **Assuming a `FAIL` in the full run is yours** — 17 `pi-image-fit`/Jimp failures were
  pre-existing. Diff against baseline before touching anything.
- **Planning to delegate docs to the `Explore` subagent** — it's read-only and its
  `@fast` role didn't resolve in this environment; make the doc edits directly.
- **`.pi/settings.json` accidentally modified** — `git checkout .pi/settings.json` to revert.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree with the OpenSpec change scaffolded
(`openspec/changes/redesign-ask-user-question-cards/`), the mockups, and push/PR access
to `origin` (`gh` authenticated).

- [ ] Read proposal + design + tasks + mockups + existing renderers/registry/shared before editing.
- [ ] Section-by-section TDD; extract `AnsweredCard` + `option-text.ts` early.
- [ ] Add `ask-user-types.ts` (auto-exported), plumb `batch` through bus → bridge → tool → client → registry.
- [ ] Build `BatchRenderer` (single request, one question at a time) test-first.
- [ ] `HOME=$(mktemp -d) npx vitest run <file>` per suite; `npm test 2>&1 | tee /tmp/pi-test.log` once.
- [ ] Isolate pre-existing failures; structural-type any worktree-symlinked shared usage.
- [ ] Update `docs/file-index-*.md` + `architecture.md` (caveman style); mark tasks; note deferred 8.3.
- [ ] `git commit` (conventional) → `git push -u` → `gh pr create` against `develop`.

**Artifacts produced:** commit `614377e1` — `feat(ask_user): redesign question cards +
batch wizard`; PR #76 (merged to `develop`); 10 new + 19 modified files including
`AnsweredCard.tsx`, `option-text.ts`, `BatchRenderer.tsx`, `ask-user-types.ts`,
`batch-decode.ts`, and 163 passing tests across 13 touched suites.

---

_Generated from session `019e9538` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-05. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.XXXXXX.5R3nXwOAQH`._
