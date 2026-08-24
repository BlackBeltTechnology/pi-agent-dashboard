---
session: 019ef695
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [distill-session-knowledge, pi-log-miner-skill]
proposal_excerpt: "Every pi session under `~/.pi/agent/sessions/<project>/` is a JSONL trace that already records the things worth keeping — and, critically, an **objective success signal** (`toolResult.isError`). Today that knowledge d…"
---

# How we did it: Build & ship the `session-distiller` from an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a scoping question, not a build order: *"Is this plugin or
extension?"* The user was interrogating the `distill-session-knowledge` OpenSpec
change to understand its **delivery form factor** before committing to build it. Three
quick follow-ups (*"how is this skill delivered?"*, *"is it shipped as npm package?"*)
pinned down that it ships **in-repo** — a project skill plus a TypeScript orchestrator,
**not** a plugin, extension, or published npm package. Once the shape was clear, the
real objective emerged: **implement the entire 18-task OpenSpec change end-to-end
(`/skill:openspec-apply-change`), then ship it (`use skill ship-change`)** — TDD build
of an offline session-miner package, through CodeRabbit review, to a squash-merge on
`develop`.

## 2. TL;DR playbook

1. **Interrogate the proposal first.** Ask "plugin or extension? how delivered? npm or
   in-repo?" and make the AI cite `proposal.md` / `design.md` / `tasks.md`. This fixes
   the form factor before a line of code is written.
2. **Invoke `/skill:openspec-apply-change <change>`** to drive the spec-driven task list.
3. **Force a structural check-in before coding** a greenfield 18-task build — decide
   *where the code lands and whether `npm test` covers it*. Here that meant a **private
   `packages/session-distiller/` workspace** registered in root `vitest.config.ts`
   `test.projects`, not a `.pi/skills/` co-located script (which `npm test` would skip).
4. **Build TDD, stage by stage**: harvest → segment → signals → cluster → distill →
   route → orchestrator CLI. Each module gets a vitest spec + deterministic fixture,
   run green before moving on.
5. **Smoke-test the CLI on real data** (dry-run against this project's ~530 sessions)
   to prove the pipeline end-to-end before wiring live writes.
6. **Match repo conventions late but firmly**: relative imports use `.js` extensions
   (bundler maps to `.ts`); typecheck with `npx tsc --noEmit` before declaring done.
7. **Invoke `use skill ship-change`** to run the verify → archive → commit → PR →
   CI-watch → CodeRabbit-loop → squash-merge pipeline.
8. **Treat every CodeRabbit thread as a real fix**, not a hand-wave. Loop CI + review
   until *green + zero open actionable threads*, then squash-merge and clean the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Form-factor discovery (4 prompts).** The AI read the change docs and
answered each scoping question with citations: it's a skill + TS orchestrator, ships
in-repo under `.pi/skills/`, routes outputs into existing sinks (`skill_manage`,
`memory`, `docs/` via context-mode FTS5), and is explicitly *not* an npm package or
server feature. *Why it worked:* grounding every answer in the proposal text stopped
speculation and locked scope before the build.

**Phase 2 — Structural check-in (decision point).** Before writing code, the AI
surfaced a concrete finding: root `vitest.config.ts` `test.projects` does **not**
include `.pi/skills/...`, so co-locating the orchestrator there would silently exclude
its tests from `npm test`. It proposed a **private workspace package** and paused for
the human's call — honoring the project's "confirm before any major change" rule. This
one pause set where all 24 files landed.

**Phase 3 — TDD build (harvest → route).** The AI scaffolded
`packages/session-distiller/` matching an existing simple package's conventions, then
built each pipeline stage against a deterministically-generated fixture session:
`jsonl-reader` → `trajectory` → `segment`/`watermark` → `signals` (5 detectors) →
`cluster` + recurrence gate → `distill` with confidence-decay → `route`/dedup/dry-run →
`main.ts` orchestrator. Tests grew 20 → 28 → 42 → 46 green in lockstep. *Why it worked:*
one fixture, incremental green, never advancing on red.

**Phase 4 — Real-data smoke + convention fixes.** Dry-run against real sessions (530
sessions → 186 promoted clusters, correct routing) proved the pipeline. Then two
convention corrections: relative imports converted `.ts` → `.js` specifiers, and one
real type-narrowing error fixed. Clean `tsc --noEmit`, 46 green, 18/18 tasks checked.

**Phase 5 — Ship (verify → merge).** `ship-change` ran the full gate. It surfaced 17
pre-existing failures in the **unrelated** `pi-image-fit` package, traced them to a
**stale worktree `node_modules`** (missing per-package `jimp@^1.6.1`; CI installs
fresh, so green there), fixed it with `npm install` in the worktree, and got an honest
**8128→8138 passed**. Then archive + sync 3 delta specs, commit, PR #161, and **3
rounds** of CodeRabbit (11 threads, all fixed in code), squash-merge as `0c2d2669`,
worktree removed.

## 4. Prompts that worked

- **The goal prompt — *"Is this plugin or extension?"*** Effective as a *scoping probe*:
  it forced the AI to classify the deliverable before building. A stronger opener that
  bundles the whole intent: *"Read the `distill-session-knowledge` change docs and tell
  me its delivery form factor (plugin/extension/skill/npm?), then apply and ship it."*
- **High-leverage follow-ups.** *"is it shipped as npm package?"* — a one-line
  disambiguation that eliminated a whole class of wrong assumptions (publish steps,
  workspace registration for distribution).
- **`/skill:openspec-apply-change distill-session-knowledge`** — the single command that
  turned the spec into an executed 18-task build.
- **`use skill ship-change`** — one phrase that ran the entire land-it pipeline
  (verify → archive → PR → CI → review → merge → cleanup).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume a form factor and start building | Asking "plugin or extension? how delivered? npm?" | State the deliverable's form factor in the goal prompt; make the AI cite the proposal |
| Be ready to co-locate scripts under `.pi/skills/` (where `npm test` skips them) | The AI self-caught it and *paused for a decision* on a private workspace | Declare "tests must run under `npm test`" up front — forces the workspace-vs-skill choice early |
| Use `.ts` import extensions | Repo convention is `.js` specifiers (bundler-mapped) | Note the import-extension convention before scaffolding a new package |
| Trust a red gate as a real regression | Trace the 17 image-fit failures to a stale worktree `node_modules`, not code | On worktree ship, `npm install` the worktree first; confirm failures reproduce on `develop` before blaming your change |
| Consider hand-waving review threads | Insisted all 11 CodeRabbit threads be *fixed in code* | Set the bar: "loop until CI green AND zero open actionable threads" |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were *created* in this session — instead it **exercised three
existing skills as the workflow spine**, which is the reusable pattern worth capturing:

- **`openspec-apply-change`** — drives a spec-driven task list to completion. Effective
  because it keeps the build honest against `tasks.md` (0/18 → 18/18) instead of
  free-forming. Invoke when a change has a ready proposal + tasks.
- **`ship-change`** — the land-it pipeline (verify → archive → PR → CI-watch →
  CodeRabbit-loop → squash-merge → worktree cleanup). Effective because it encodes the
  known pitfalls (worktree install gaps, busy-worktree merge failure) so you don't
  rediscover them. Invoke once implementation is green.
- **The deliverable itself, `session-distiller`**, is a *reusable asset*: an offline
  miner that turns session JSONL + `toolResult.isError` signals into promoted
  skills/memories. Run its CLI dry-run to harvest knowledge from past sessions.

**Recommendation:** the "worktree ship shows unrelated red tests → it's a stale
`node_modules`, run `npm install` in the worktree" lesson is a strong **memory**
candidate — it cost ~4 debugging turns here and will recur on every worktree ship.

## 7. Pitfalls & dead ends

- **Stale worktree `node_modules` fakes a regression.** 17 `pi-image-fit` tests failed
  in the worktree (`TypeError: Jimp is not a constructor`) but passed on `develop`. Root
  cause: the worktree lacked the per-package `jimp@^1.6.1`; it fell back to root
  `jimp@0.16.13`. **Fix:** `npm install` inside the worktree, confirm the failure is
  absent on the parent checkout, *then* trust the gate.
- **`.ts` import extensions break the typecheck.** Repo convention is `.js` specifiers
  (mapped to `.ts` by the bundler). A bulk `sed` `.ts` → `.js` fixed source but also
  botched test imports — verify tests still resolve after any bulk rewrite.
- **`.pi/skills/` scripts are invisible to `npm test`.** Root `vitest.config.ts`
  `test.projects` doesn't include them. Put testable code in a registered workspace.
- **Squash-merge cleanup fails from inside the merged worktree.** `gh`'s local branch
  checkout failed because the worktree held `develop`, and the bash tool was pinned to
  the just-removed worktree dir. **Fix:** delete the remote branch manually and finish
  cleanup from a shell that runs in its own temp dir (or the parent checkout).
- **CodeRabbit "success" check ≠ zero comments.** It posted 10 actionable threads while
  the check was green. Always fetch the review threads via GraphQL and loop.

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- A ready OpenSpec change (`proposal.md` + `design.md` + `tasks.md`) on its worktree branch.
- `gh` authenticated; CodeRabbit enabled on the repo.

**Checklist**
1. [ ] Ask the AI to state the change's **form factor**, citing the proposal.
2. [ ] `npx tsc`/read an existing simple package to copy conventions (imports use `.js`).
3. [ ] `/skill:openspec-apply-change <change>`; **pause on a structural decision** —
       land testable code in a **registered workspace package**, not `.pi/skills/`.
4. [ ] Build TDD stage-by-stage against one deterministic fixture; keep tests green.
5. [ ] Dry-run the CLI on real sessions to prove the pipeline end-to-end.
6. [ ] `npx tsc --noEmit` clean; all tasks checked in `tasks.md`.
7. [ ] `use skill ship-change`; if the worktree gate shows unrelated red, `npm install`
       the worktree and re-verify before proceeding.
8. [ ] Loop CI + CodeRabbit until **green + zero open actionable threads**; squash-merge;
       clean branch + worktree (from the parent checkout).

**Final artifacts**
- `packages/session-distiller/` — private workspace, 8 pipeline modules + tests + CLI
  (`bin/distill.mjs`).
- `.pi/skills/distill-session-knowledge/SKILL.md`.
- Merged to `develop` as `0c2d2669` (PR #161); change archived under
  `openspec/changes/archive/2026-06-23-distill-session-knowledge/`.

---

_Generated from session `019ef695` · `pi-agent-dashboard` · 2026-06-24. Source extract: facts sheet (session-to-guideline extract)._
