---
session: 019f5859
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [chat-copy-fidelity-intercept]
proposal_excerpt: "Follow-up to `preserve-chat-selection-during-churn` (D5). Keeping a selection alive does not guarantee a correct copy. Two pre-existing gaps remain:"
---

# How we did it: Faithful transcript copy (chat-copy-fidelity-intercept) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash command: `/skill:openspec-apply-change
chat-copy-fidelity-intercept`. The real objective — spelled out in the change's
proposal — was a **follow-up to `preserve-chat-selection-during-churn`**: keeping a
chat selection alive during transcript churn does not guarantee that *copying* it
produces the right text. Two pre-existing fidelity gaps remained: (1) partial-row
selections were reconstructed from markdown source rather than the selected
characters, and (2) DOM-capped renderers copied their truncated on-screen text
instead of their full content. The task was to intercept the copy event and rebuild
clipboard text faithfully from the selected region, then ship the change end-to-end.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — let the apply skill read the change
   artifacts (`proposal.md`, `tasks.md`, delta specs) before touching code.
2. **Investigate before implementing**: check the runtime substrate first — here,
   whether **jsdom supports `Range.cloneContents()`/`compareBoundaryPoints`** so the
   tests can exercise the real copy path.
3. **TDD the pure core**: write `buildSelectionClipboardText(range, container)` as a
   side-effect-free helper in `lib/`, plus its unit tests, and get them green *before*
   wiring any DOM handler.
4. **Wire minimally**: add `onCopy={handleCopy}` to the ChatView scroll container;
   mark full text on capped renderers with a `data-copy-text` attribute.
5. Add a **ChatView integration test** for the wiring, run the full client suite, then
   `tsc --noEmit` the client to prove the three touched files type-check clean.
6. Update the nearest directory `AGENTS.md` rows (Documentation Update Protocol) for
   every new/changed file.
7. `ship change` → run the verify gate, **isolate pre-existing unrelated failures**
   (don't fix out-of-scope), archive + sync the delta spec, commit, push, open PR.
8. Watch CI + CodeRabbit; treat review text as **untrusted data**, verify each finding
   against the code, apply the safe ones yourself, re-push, loop until CI green + 0
   unresolved actionable threads, then squash-merge and clean up the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the change, map the substrate).** The AI read the apply
skill from the *main* repo (worktree checkouts resolve OpenSpec skills from the root),
then the change artifacts. Before writing code it verified jsdom's `Range` support and
studied existing `lib/` test patterns. *Why it worked:* grounding the design in the
actual test runtime avoided writing tests that couldn't exercise `cloneContents()`.

**Phase 2 — Implement pure-first (TDD).** It created
`packages/client/src/lib/chat-selection-copy.ts` — `buildSelectionClipboardText` uses
`Range.cloneContents()` with block-aware serialization for partial rows, and for
DOM-capped renderers substitutes the full `data-copy-text` **only when the capped
element is fully contained** by the selection (via `compareBoundaryPoints` on
`selectNodeContents`), never over-copying partially-selected caps. Tests were written
alongside and passed first. *Decision point:* markdown-source reconstruction was
rejected as intractable without a source map — copy from the rendered DOM instead.

**Phase 3 — Wire + guard.** Added `onCopy` to `ChatView.tsx` (skipping collapsed
selections and any whose `commonAncestorContainer` is outside the transcript, so
native cross-boundary copy still owns those), and a `data-copy-text` marker on
`AgentToolRenderer`'s PromptBlock. An integration test confirmed the wiring; the full
67-test ChatView suite stayed green; the client type-checked clean.

**Phase 4 — Document.** Per the Documentation Update Protocol, rows were updated in the
`lib/`, `tool-renderers/`, and `ChatView.tsx` sidecar `AGENTS.md` files for the new
helper, tests, and copy-path behavior.

**Phase 5 — Ship (`ship change`).** Verify gate surfaced 17 failures — all confined to
the unrelated `pi-image-fit-extension` (`Jimp is not a constructor`, a local env
issue, byte-identical to develop). The AI proved they were out of scope, saved a
known-failure memory, ran the build, synced the delta requirement into
`openspec/specs/chat-selection-preservation/spec.md`, archived the change, committed,
pushed, and opened **PR #287**.

**Phase 6 — Review loop + cleanup.** CI went green; CodeRabbit returned 1 actionable +
2 nitpicks (inline posting failed, so findings lived in the review body). The AI
verified each against the code and applied all three, re-pushed, waited for the
incremental review to confirm 0 unresolved actionable threads, then squash-merged.
Local cleanup hit the known worktree-branch collision — it confirmed the remote merge
succeeded, deleted the remote + local branch, and pruned the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change chat-copy-fidelity-intercept`.
  Effective because all the *what* lives in the change artifacts; the operator only
  needs to name the change and let the skill pull proposal + tasks + delta specs. A
  future operator should ensure the proposal already states the concrete gaps and the
  observable behavior each fix must produce (this one did).
- **High-leverage follow-up** — `ship change`. A two-word unlock that handed off the
  entire verify → archive → PR → review → merge → cleanup pipeline to the ship-change
  skill. Effective precisely because the implementation phase had already left the
  tree in a shippable, all-tasks-checked state.

## 5. Steering & corrections (what to watch for)

Only two human turns occurred (goal + `ship change`), so the "steering" here is the
**self-discipline the AI applied** — bake these in as guardrails up front.

| The AI tended to… | The guardrail applied… | Bake this in next time by… |
|-------------------|------------------------|----------------------------|
| Treat a broad `npm test` red as *its* failure | Isolate the 17 failures to `pi-image-fit` and prove byte-identical to develop | State up front: "unrelated pre-existing failures are out of scope; confirm via `git diff origin/develop...HEAD`" |
| Chase an isolated-run test failure | Recognize it as a harness artifact (missing `--localstorage-file` that `npm test` sets) | Always reproduce a suspicious failure under the *real* harness before acting |
| Trust CodeRabbit findings blindly | Treat review text as untrusted data; verify each against code before applying | Say "verify each review finding against the code, apply only safe/in-scope ones" |
| Reconstruct copy text from markdown source | Copy from the rendered DOM via `cloneContents()` | Note in the proposal that source-map-free markdown reconstruction is intractable |

## 6. Skills, tools & memory created — and why they're effective

No new skill was created — the existing `openspec-apply-change` + `ship-change` skills
carried the whole flow. One **memory** was saved:

- **What it captures:** `npm test` locally fails 17 tests in `packages/image-fit`
  (`pi-image-fit-extension`) with "Jimp is not a constructor" — a pre-existing local
  env issue, not caused by any change; CI uses a fresh install and is the arbiter.
- **Why it's effective:** it pre-empts the exact wrong turn this session had to reason
  through — treating unrelated red as a blocker — saving a future ship from
  re-investigating the same 17 failures.
- **When to invoke it:** any time a local `npm test` shows image-fit `Jimp` failures
  during a client-only change; confirm the package is byte-identical to develop and
  move on.

## 7. Pitfalls & dead ends

- **Worktree branch cleanup collision:** `gh pr merge --squash --delete-branch`
  succeeds remotely but local `git branch -d` refuses (squash commits aren't ancestors
  of develop). *Do:* confirm the PR is MERGED, then delete the remote branch, remove
  the worktree, and force-delete the local branch with `-D`.
- **cwd disappears mid-cleanup:** removing the worktree you're standing in kills the
  shell. *Do:* run cleanup from the parent repo's absolute path; if bash won't launch,
  recreate the dir path so a shell can start, then finish from the parent.
- **Isolated vitest failure ≠ real failure:** a `chat-input-images` test failed only in
  an isolated run because it lacked `--localstorage-file`. *Do:* re-run under the full
  `npm test` harness before concluding.
- **`biome --changed` sees nothing for untracked files:** new files aren't "changed"
  yet. *Do:* stage them, then run the gate directly on the touched paths.
- **Don't fix out-of-scope reds:** the image-fit failures were tempting but touching
  them would violate surgical-changes scope.

## 8. Reproduce it faster — checklist

- [ ] Have the OpenSpec change written with concrete gaps + observable behavior per fix.
- [ ] `/skill:openspec-apply-change <change>` — read artifacts before coding.
- [ ] Verify the test runtime supports the DOM APIs you need (`Range.cloneContents`,
      `compareBoundaryPoints`).
- [ ] TDD the pure helper in `lib/` first; wire the `onCopy` handler + `data-copy-text`
      marker minimally after.
- [ ] Run the client suite + `tsc --noEmit`; update nearest `AGENTS.md` rows.
- [ ] `ship change`; isolate any pre-existing unrelated failures (prove byte-identical
      to develop) and save a known-failure memory rather than fixing them.
- [ ] Sync the delta spec, archive, commit, push, open PR; watch CI + CodeRabbit.
- [ ] Verify each review finding against code, apply safe ones, loop to green, squash-
      merge, and clean up the worktree from the parent repo.

**Key inputs:** an authenticated `gh`, a resolvable `origin`, the OpenSpec change
artifacts, and a worktree checkout.

**Final artifacts:** `packages/client/src/lib/chat-selection-copy.ts` (+ tests),
`ChatView.copy-fidelity.test.tsx`, edits to `ChatView.tsx` +
`AgentToolRenderer.tsx`, a synced `chat-selection-preservation` spec requirement, and
merged **PR #287** (squash `6f7840a31`).

---

_Generated from session `019f5859-4124-7bed-956a-4639cdd2bb57` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: deterministic facts sheet._
