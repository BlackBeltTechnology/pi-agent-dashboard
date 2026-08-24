---
session: 019f34c7
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [group-tool-call-bursts]
proposal_excerpt: "A single investigation turn routinely emits 15–40 heterogeneous tool calls (grep → Read → grep → Read …). Today these render as a flat wall of equal-weight rows: no progress signal while running, no summary when done,…"
---

# How we did it: Group heterogeneous tool-call bursts — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash command: `/skill:openspec-apply-change
group-tool-call-bursts`. No prose, no restated requirements — the intent lived
entirely in the already-written OpenSpec change. The *real* objective (from the
proposal): a single investigation turn emits 15–40 heterogeneous tool calls
(grep → Read → grep → Read …) that today render as a flat wall of equal-weight rows —
no progress signal while running, no summary when done. Build **temporal (burst)
grouping** as an *outer* pass over the existing semantic `×N` grouping, collapse the
burst into one summarizable component, and land it end-to-end (implement → test →
review → merge → clean up the worktree). The two later prompts were pure ship-flow
steering, not scope changes.

## 2. TL;DR playbook

1. Have the OpenSpec change fully written first, then trigger it: `/skill:openspec-apply-change <change-name>`. The spec carries the scope; you don't re-explain it.
2. Let the AI read the touched code + every relevant `AGENTS.md` before writing a line — it did discovery first, so its edits landed in the right files.
3. Insist on TDD: write the pure-helper test, run it RED (module missing), then implement to GREEN. Here: `group-tool-bursts.test.ts` → `group-tool-bursts.ts`.
4. Extract shared logic when two copies appear (DRY): a `tool-summary.ts` module replaced two inline copies before the new component consumed it.
5. Characterize pre-existing test failures against a **clean `git stash`** so you can prove "my change introduces zero new failures" — don't let inherited RED block you.
6. Run the local quality gate (`biome check`, `tsc --noEmit -p packages/client/tsconfig.json`, scoped `vitest`) before invoking ship.
7. Say `use ship-change skill` to drive archive → commit → push → PR → CI-watch → CodeRabbit → squash-merge → worktree cleanup.
8. When the base branch (`develop`) is CI-red on an *unrelated* pre-existing bug, **hold** (commit locally, no push) until the fix lands upstream — then `rebase to develop and use ship-change skill` to resume.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before write).** The AI opened the event-reducer, the
client `lib/` + `components/` `AGENTS.md` rows, and an existing e2e spec to model the
new one. Effective because every later edit targeted a file it had actually read —
no speculative edits, correct `AGENTS.md` rows.

**Phase 2 — TDD the pure helper.** Wrote `group-tool-bursts.test.ts`, ran it RED
(module absent), then implemented `groupToolBursts()`: walks raw messages, forms a
burst from a maximal run of `toolResult` rows across transparent rows, bounded by
HARD rows, nests `groupConsecutiveToolCalls` per slice, and only forms at ≥3
post-semantic members (else emits byte-identical output). 17 green.

**Phase 3 — DRY + component.** Extracted `tool-summary.ts` and refactored two inline
copies into it, then built `ToolBurstGroup.tsx` with a derived lifecycle
(`expanded = override ?? isRunning`) and wired it into `ChatView`. CSS scroll
anchoring (`overflowAnchor: "auto"`, already present) handled shrink-preservation —
no new JS needed, which the AI spotted and noted rather than reinventing.

**Phase 4 — Verify + docs.** Ran the full suite, isolated 11 pre-existing failures
against a clean stash (image-fit native-dep + event-reducer "double thinking row"),
proved zero new failures, added caveman-style `AGENTS.md` tree rows + a faux burst
scenario + e2e spec, `openspec validate --strict`, biome + typecheck clean.

**Phase 5 — Ship, with a deliberate hold.** `use ship-change` started the pipeline,
but `develop` was CI-red on the unrelated `fix-double-thinking-row-on-replay-reconstruction`
bug. **Decision point:** the AI refused to unilaterally merge past a red base and
*held* — committed locally, archived specs, no push. Hours later the human said the
fix landed; `rebase to develop and use ship-change skill` resumed it: clean rebase,
green gate, PR #249, CI green, CodeRabbit round (fixed naive `+"s"` pluralization →
`N× <tool>`), squash-merge `c56a4b3`, worktree removed via the dashboard endpoint.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change group-tool-call-bursts`.** Effective *because the change was fully specified beforehand*. The whole "what to build" lived in the proposal/tasks, so a one-line trigger was enough. The lesson: front-load the spec, not the chat.
- **`use ship-change skill`** — a high-leverage 4-word unlock that handed the entire archive → PR → merge → cleanup pipeline to a known skill instead of narrating each git step.
- **`develop fix presented, rebase to develop and use ship-change skill`** — a precise resume: it named the unblocking event *and* the exact next action, so the AI didn't re-litigate the earlier hold.

Weak-prompt rewrite: none were weak — each was terse and unambiguous *because a skill
or spec carried the detail*. If you have no spec yet, don't open with a bare slash
command; write the OpenSpec change first.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation, unsure how to land the change | `use ship-change skill` | Name the ship skill in the kickoff, or add it to the apply-change tail |
| Face a CI-red base branch and pause for a merge decision | (implicit) it self-held; human later said the fix landed | State the "never merge past a red base; hold and wait" rule up front so the pause is expected, not a surprise |
| Need the resume trigger after an upstream fix | `develop fix presented, rebase to develop and use ship-change skill` | Tell it to rebase-then-ship in one prompt once the blocker clears |

The notable non-correction: the AI **correctly refused to merge** past an unrelated
red base and escalated the judgment call instead of forcing it. That instinct is the
guardrail — reinforce it, don't override it.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it *consumed* existing skills
(`openspec-apply-change`, `ship-change`) rather than authoring new ones. Two reusable
code assets emerged instead:

- **`group-tool-bursts.ts` (`groupToolBursts()`)** — a pure, testable outer-pass
  grouping helper with a byte-identical fallback below its ≥3-member threshold. Its
  purity is what let the whole feature be TDD'd and proven regression-free.
- **`tool-summary.ts`** — a shared summary module that killed two inline copies. Invoke
  the DRY-extraction move whenever a second copy of a formatting helper appears.

If you repeat this end-to-end flow often, the *pattern* worth codifying is already
codified: `openspec-apply-change` → local gates → `ship-change`, with a hold-on-red-base
branch. Nothing new to save.

## 7. Pitfalls & dead ends

- **Wrong multi-edit format** on the `ChatView` wiring — the AI used the wrong edit
  shape and had to redo it. If a multi-location edit rejects, re-issue as one edit with
  multiple entries against the *original* file, not incrementally.
- **`biome check --write` failed once** — run `biome check` (read-only) first to see
  the errors, fix `type="button"` (a11y) and import order, then re-check.
- **Local-only test failures masquerading as regressions.** `image-fit-extension`
  fails locally (missing native jimp/`JimpMime` deps) but is green in CI; the
  event-reducer "double thinking row" failures were a tracked upstream bug. Always
  `git stash` and re-run on a clean tree to separate *yours* from *inherited* before
  you let RED block a ship.
- **CodeRabbit "pass" can be a rate-limited ACK, not a review.** It showed "Review
  limit reached… Next review available in: 37 minutes." Wait out the window and
  trigger a *full* review; don't treat the ACK as a green light.
- **Naive `+"s"` pluralization** mangles tool names (`ls`→`lss`, `kb_search`→`kb_searchs`).
  Use the `${n}× ${name}` form instead — CodeRabbit flagged exactly this.
- **The session ran *inside* the worktree it had to remove.** CLI removal from the
  parent may refuse (active session) and removing it invalidates the cwd — use the
  dashboard endpoint fallback, and expect the conversation to end when it succeeds.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-written OpenSpec change (`openspec/changes/<name>/`),
`gh` authenticated, a running dashboard (for the worktree-removal fallback), and a
worktree checked out for the change.

1. `/skill:openspec-apply-change <change-name>`.
2. AI reads touched code + relevant `AGENTS.md` before editing.
3. TDD each pure helper: test → RED → implement → GREEN.
4. Extract a shared module on the second copy of any helper (DRY).
5. `git stash` + re-run suite to characterize pre-existing failures; prove zero new.
6. Local gate: `biome check`, `tsc --noEmit -p packages/client/tsconfig.json`, scoped `vitest`; `openspec validate --strict`.
7. `use ship-change skill` → archive → commit → push → PR → CI-watch → CodeRabbit → squash-merge.
8. If base is CI-red on an unrelated bug: **hold** (commit local, no push); resume with `rebase to develop and use ship-change skill` once the upstream fix lands.
9. Remove the worktree via the dashboard endpoint (the session lives inside it).

**Final artifacts:** `packages/client/src/lib/group-tool-bursts.ts` (+ test),
`packages/client/src/lib/tool-summary.ts`, `packages/client/src/components/ToolBurstGroup.tsx`,
edits to `ToolCallStep.tsx` / `CollapsedToolGroup.tsx` / `ChatView.tsx`,
`tests/e2e/tool-burst.spec.ts`, a faux burst scenario, `AGENTS.md` tree rows.
Merged as PR #249 (`c56a4b3`); specs archived to
`openspec/changes/archive/2026-07-06-group-tool-call-bursts/` (+3 requirements into
`openspec/specs/chat-view/spec.md`).

---

_Generated from session `019f34c7-343e-7390-b70e-4a9c019aacad` · `pi-agent-dashboard/.worktrees/os-group-tool-call-bursts` · 2026-07-06. Source extract: deterministic facts sheet._
