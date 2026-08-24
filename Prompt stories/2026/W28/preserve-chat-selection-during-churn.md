---
session: 019f547f
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [preserve-streaming-tail-selection, chat-copy-fidelity-intercept, preserve-chat-selection-during-churn]
proposal_excerpt: "Follow-up to `preserve-chat-selection-during-churn` (Path B, D4). That change keeps finished-card selections alive but leaves the **streaming tail** at baseline: a selection anchored inside the actively-streaming card…"
---

# How we did it: Preserve chat selection during transcript churn — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash command:

```
/skill:openspec-apply-change preserve-chat-selection-during-churn
```

The real objective: **implement an already-specced OpenSpec change end-to-end** — keep a
live text selection in the chat transcript from collapsing when the transcript "churns"
(streaming tokens, new cards arriving, auto-scroll pinning to the bottom, and the virtual
window recomputing which rows are mounted). The work was almost fully specified up front;
the human's job was to drive the apply skill, keep quality bars honest, and decide when to
ship. Two short steering turns (below) did all the redirection.

## 2. TL;DR playbook

1. Kick off with the apply skill against the named change: `/skill:openspec-apply-change <change>`.
2. Let the AI read every context file (proposal, spec deltas, source: `ChatView.tsx`,
   `chat-virtual-rows.ts`, existing hooks/tests) **before** it writes anything.
3. Build in dependency order: pure helpers in `chat-virtual-rows.ts` → the
   `useActiveChatSelection` hook → wire both into `ChatView.tsx` (rangeExtractor + gated
   auto-scroll pin).
4. Write tests alongside (hook unit test, `ChatView.selection.test.tsx`, helper cases),
   run them with `HOME=$(mktemp -d) npx vitest run <files>` to dodge home-dir config bleed.
5. Typecheck only your touched files (`npx tsc --noEmit -p packages/client/tsconfig.json`
   then `grep` for your filenames) so pre-existing errors don't distract.
6. Run full `npm test`; **confirm any red is pre-existing** by checking the failing package
   is one your diff never touches (here: `pi-image-fit-extension` / `Jimp is not a constructor`).
7. Run Biome on changed files; refactor to clear real warnings (a cognitive-complexity 26>15
   on the hook got fixed by extracting the eval logic).
8. Update the per-directory `AGENTS.md` tree rows + `See change:` sidecar for new/changed files.
9. When only manual-browser QA remains, tell the AI to mark it "tested later" and ship.
10. Drive `ship-change` inline: archive+sync specs → commit → push → PR → watch CI →
    wait out CodeRabbit's rate limit → merge → clean up worktree/branch.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read everything first).** The AI read the change's proposal, three
spec deltas, and the key source files (`ChatView.tsx`, `chat-virtual-rows.ts`, hooks, existing
tests) before touching code. This is why the later implementation landed in one pass: it
traced the reproduction analysis (Section 1 tasks) from the actual code, not from guesses.

**Phase 2 — Generate (dependency order).** Pure helpers first (`rangeToRowIndexSpan`,
`extendRangeWithSelection` in `chat-virtual-rows.ts`), then the `useActiveChatSelection` hook,
then the `ChatView.tsx` wiring: device-aware ceiling constants, a `rangeExtractor` that keeps
selection-intersecting rows mounted, and gating the bottom-pin `onChange` + auto-scroll
`useLayoutEffect` on `isSelectingRef`. Bottom-up meant each layer typechecked before the next
consumed it.

**Phase 3 — Verify (isolate the noise).** Tests were run with `HOME=$(mktemp -d)` to avoid
config bleed; the two initial failures were **test-harness bugs** (DOM ordering + Range offset
on element nodes), not implementation bugs — the AI correctly diagnosed and fixed the tests,
not the code. The full suite's 17 red tests were proven pre-existing (`Jimp is not a
constructor` in `pi-image-fit-extension`, a package the diff never touches). Biome flagged a
real complexity warning on the hook, fixed by extraction.

**Phase 4 — Document + follow-ups.** Updated `AGENTS.md` rows for the new hook + changed
`chat-virtual-rows.ts`, added a `See change:` line to the `ChatView.tsx` sidecar, and scaffolded
**two follow-up OpenSpec changes** (`preserve-streaming-tail-selection`, `chat-copy-fidelity-intercept`)
capturing the deferred scope — instead of silently dropping it.

**Phase 5 — Ship (human decision point).** The human's "ship change" unlocked the whole
`ship-change` pipeline: archive+sync specs, commit, PR #278, green CI (9m53s), then a long,
patient wait for CodeRabbit's 35-min rate-limit window before triggering a full review
(0 actionable comments), and a squash-merge with worktree/branch cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change preserve-chat-selection-during-churn`.
  Effective because the change was fully specced: naming the change + invoking the apply skill
  gave the AI a bounded, verifiable task list (24 tasks) instead of an open-ended feature ask.
- **High-leverage follow-up** — `I will test later, ship change`. Three words that unlocked the
  entire ship pipeline and resolved the one open question (whether to mark manual QA task 6.3
  done). It converted "23/24 with an honest open item" into an authorized ship.
- **Diagnostic nudge** — `maybe tasks not updated?`. A short check that prompted the AI to
  reconcile the tasks.md checkboxes against `openspec instructions apply --json` progress
  (`23/24 complete`), confirming state rather than assuming it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause at 23/24 and *ask* whether to mark the manual-QA task done | "I will test later, ship change" | State the QA policy up front: "manual-browser tasks → mark tested-later and ship" |
| Present the tasks-state as possibly stale / ambiguous | "maybe tasks not updated?" | Have the AI cross-check `openspec instructions apply --json` progress before reporting done |
| Treat CodeRabbit's rate-limit ACK as a real review | (implicitly) waited it out | Tell the AI: CodeRabbit ACK ≠ review; poll the reviews endpoint, wait the window, confirm 0 threads |

The session needed almost no correction — the change was well-specified, so the human mostly
supplied the *ship authorization* and one *state-check nudge*. The main judgment the human
delegated (and the AI got right) was distinguishing pre-existing red tests from regressions.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session **consumed** existing project skills
rather than producing assets:

- `openspec-apply-change` — turned a specced change into an ordered, checkboxed task run.
- `ship-change` — the archive→PR→CI→review→merge→cleanup pipeline, driven inline.

**Recommendation:** the recurring pattern here — *"prove a full-suite red is pre-existing by
checking the failing package is outside my diff"* — is worth a small memory or checklist entry,
since it recurred (the `Jimp is not a constructor` / `pi-image-fit-extension` false alarm) and
gates the ship decision.

## 7. Pitfalls & dead ends

- **Vitest needs an isolated HOME.** First test run failed on home-dir config; re-run with
  `HOME=$(mktemp -d) npx vitest run <files>`.
- **Full-suite red ≠ your bug.** 17 failures were all `Jimp is not a constructor` in
  `pi-image-fit-extension`, an untouched package (local env quirk; CI's clean install resolves
  it). Confirm with `git diff --name-only origin/develop...HEAD` before blaming your change.
- **Test-harness bugs masquerade as impl bugs.** The two initial failures were DOM ordering +
  Range-offset-on-element-node issues in the *tests*, not the hook. Read the assertion before
  editing production code.
- **`gh pr merge` collides with worktrees.** The squash-merge succeeded server-side (state
  `MERGED`, commit `872e1573`) but the post-merge local branch-delete step errored because
  `develop` was already checked out in the parent repo. Verify merge via
  `gh pr view <n> --json state,mergeCommit` and clean up manually with `git -C <parent>`.
- **Removing your own cwd kills the shell.** The worktree was the session's cwd; after
  `git worktree remove`, subsequent shells couldn't start. Recreate the dir or operate on the
  parent via `git -C <parent>`.
- **Squash merge leaves a "not fully merged" local branch.** Normal — force-delete with
  `git branch -D` once the PR is confirmed merged.

## 8. Reproduce it faster — checklist

- [ ] Invoke `/skill:openspec-apply-change <change>` on a fully-specced change.
- [ ] Read all context (proposal, spec deltas, target source + tests) before writing.
- [ ] Implement bottom-up: pure helpers → hook → component wiring.
- [ ] Write tests alongside; run with `HOME=$(mktemp -d) npx vitest run <files>`.
- [ ] Typecheck touched files only: `npx tsc --noEmit -p packages/client/tsconfig.json` + grep.
- [ ] `npm test`; prove any red is pre-existing via `git diff --name-only origin/develop...HEAD`.
- [ ] `npx biome check <changed files>`; clear real warnings (extract to cut complexity).
- [ ] Update `AGENTS.md` rows + `See change:` sidecars for new/changed files.
- [ ] Scaffold follow-up OpenSpec changes for any deferred scope.
- [ ] Say "ship change" once manual QA is the only remainder → drive `ship-change` inline.
- [ ] After merge: verify via `gh pr view`, remove worktree, force-delete local branch.

**Key inputs to have ready:** a validated OpenSpec change on its own worktree/branch, `gh`
authenticated, awareness of known pre-existing test noise (`pi-image-fit-extension` / Jimp).

**Artifacts produced:** `useActiveChatSelection.ts` (+ tests), `rangeToRowIndexSpan` /
`extendRangeWithSelection` helpers in `chat-virtual-rows.ts`, gated `ChatView.tsx`, two
follow-up change scaffolds, PR #278 (merged, `872e1573`), archived change under
`openspec/changes/archive/2026-07-12-preserve-chat-selection-during-churn/`.

---

_Generated from session `019f547f` · `pi-agent-dashboard` · 2026-07-12. Source extract: session facts sheet (deterministic extract)._
