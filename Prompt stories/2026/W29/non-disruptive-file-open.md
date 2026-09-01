---
session: 019f6d11
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~10608 tok)"
upgrade_status: pending
openspec_changes: [non-disruptive-file-open, auto-canvas]
proposal_excerpt: "Opening a file is currently **disruptive** in two ways that fight the user:"
---

# How we did it: Ship `non-disruptive-file-open` end-to-end in a worktree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `ship-it` skill as the prompt: *orchestrate the
implementation phase of an OpenSpec change inside its git worktree* — apply the
change, run the docker harness for e2e, and drive `ship-change` to a merged PR,
runnable headless. The concrete objective: take the `non-disruptive-file-open`
change from **zero implementation** to a **squash-merged PR against `develop`**,
with all automated scenarios green in the docker harness and no actionable review
threads. The feature itself: opening a file should stop fighting the reader —
mode should be *sticky* (never yank a full-screen reader back to split) and
agent-driven canvas opens should land *silently in the background* with an unread
dot instead of stealing focus.

## 2. TL;DR playbook

1. **Orient on filesystem reality, not the checkboxes.** `git status`, `git log`
   vs `origin/develop`, and grep the source to confirm the feature doesn't already
   exist. Unchecked tasks ≠ unstarted work.
2. **Surface cross-change sequencing before coding.** A `redesign-split-layout-controls`
   dependency was still active — flag it via `ask_user` instead of picking silently.
3. **Implement in TDD order, section by section**: reducer (+ folded L1 tests) →
   openers/sticky-mode → CanvasDriver intent split → unread affordance. Run each
   slice green before the next.
4. **Triage the full-suite failures.** 20 failures were all in *unrelated packages*
   (jimp/iconv/type-fixture) — confirm by stashing your client-only diff and running
   the affected package on base.
5. **Run the docker harness with `PW_CHANNEL=chrome`** (system Chrome, no download)
   and always-teardown. Read `.pi-test-harness.json` for the port.
6. **When e2e opens flake, switch the setup path.** The faux-read `OpenFileButton`
   and `page.goto` reloads both break silently — use a no-reload reading context
   (agent url open → background file write).
7. **Fix the real root cause of the 20 failures for the ship gate**: the worktree's
   `node_modules` was incomplete (`jimp` missing). Run `npm ci`, re-verify green.
8. **Rebase the spec deltas after `develop` advanced** — the redesign shipped first,
   so rebase your `split-editor-workspace` delta onto its version, fix ADDED vs
   MODIFIED headers, then `openspec archive`.
9. **Drive `ship-change` inline**: commit → merge develop → resolve conflict →
   re-verify → archive → push → PR → watch CI → wait for the *real* CodeRabbit
   review → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (filesystem reality).** The AI ran `git status`/`git log`/grep
before trusting `tasks.md`, confirmed a clean tree exactly at `origin/develop`, and
read the proposal + source surfaces. *Why it worked:* ship-it gates on filesystem
reality, so "all tasks unchecked" was correctly read as "fresh apply needed," not
"nothing done." **Decision point:** the AI detected that `redesign-split-layout-controls`
was still active and the shared spec still carried the scenario this change overturns
— it stopped and asked rather than guessing. The human answered *"The
split-editor-workspace on develop"* (land this change first; redesign rebases).

**Phase 2 — Implement TDD, section by section.** Reducer first (`openFile.activate`
flag + `OpenFile.unread`, invariant *active tab is never unread*, `isValidState`
type-guard), then openers (sticky `ensureRevealed()` reveals split only from
`closed`), then CanvasDriver (effect = background, chip/click = foreground), then the
unread dot + reduced-motion-gated pulse. Each slice ran green before moving on.
*Why it worked:* folding the planned L1 test IDs (E1–E8, F1–F17) into each slice kept
the surface honest and caught the stale-`api`-capture bug in the CanvasDriver test.

**Phase 3 — Triage full-suite noise.** `npm test` showed 20 failures. The AI proved
they were all in untouched packages (jimp/bus-client/server iconv) by stashing the
client-only diff and running the affected package on base. *Why it worked:* it
refused to attribute unrelated environmental failures to its own diff.

**Phase 4 — Docker harness e2e.** Started the harness with `PW_CHANNEL=chrome` +
always-teardown, read the port from `.pi-test-harness.json`, ran the two specs.
Repeated flakes forced three setup-path pivots (see §7) before all 6 L3 scenarios
(F11–F15, F19) went green. **Decision point:** the human confirmed *"waiting for the
real CodeRabbit review"* at the last reversible point before squash-merge.

**Phase 5 — Ship inline.** The AI found the *real* cause of the 20 failures (incomplete
worktree `node_modules` → `npm ci`), re-ran the full verify gate green (10630 tests),
then committed, merged the 7 advanced develop commits (resolving a `editor-pane.spec.ts`
conflict by unioning its F11 block with the shipped redesign block), **rebased the
spec deltas** onto the redesign, archived, pushed, opened PR #350, watched CI green,
waited out CodeRabbit's rate-limit ACK for the real (clean) review, squash-merged
(`820e159c`), and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** (the `ship-it` skill invocation): effective because it handed
  the AI a complete, mermaid-diagrammed orchestration contract with preconditions
  and escape hatches — the AI never had to guess the phase order.
- **High-leverage follow-up:** *"The split-editor-workspace on develop"* — a
  five-word answer to a sequencing question that unblocked the entire implementation
  (land this change first, redesign rebases). Terse, decisive, unambiguous.

Rewrite of the weak part: the sequencing decision could have been pre-stated in the
proposal's task 0.2 as *"if this lands before the redesign, the redesign rebases the
shared scenario"* — then no mid-session `ask_user` round-trip is needed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause on the cross-change sequencing ambiguity | "The split-editor-workspace on develop" — land this first | Pre-stating the land-order + rebase fallback in the proposal's coordination task |
| Trust `tasks.md` checkboxes as progress | (self-corrected) grep filesystem reality first | ship-it's filesystem-reality gate — keep it |
| Attribute the 20 full-suite failures to the diff | (self-corrected) stash + run on base | Save the "worktree node_modules can be incomplete → npm ci" memory |
| Reuse a flaky e2e setup path repeatedly | (self-corrected) switch to reload-free reading context | Save the "page.goto disables composer → sendPrompt no-ops" memory |

## 6. Skills, tools & memory created — and why they're effective

Two durable **project · tool-quirk** memories were saved (no new skill):

1. *Worktree `node_modules` can be incomplete* (e.g. `jimp` missing → `JimpMime`
   undefined → ~20 false failures in image-fit/bus-client/server). **Why effective:**
   turns a scary red full-suite into a one-command fix (`npm ci`) instead of a
   diff hunt. Invoke it whenever a worktree shows failures in packages you never
   touched.
2. *In the docker e2e harness, `page.goto(...)` full reload leaves the composer
   disabled*, so a later `sendPrompt` silently no-ops. **Why effective:** explains a
   whole class of "the prompt didn't land" e2e flakes and points at the reload-free
   fix. Invoke it when authoring any auto-canvas / composer-driven Playwright spec.

If this exact orchestration recurs, the `ship-it` skill already captures it — these
two memories are the missing runtime-gotcha layer beneath it.

## 7. Pitfalls & dead ends

- **20 full-suite failures looked like regressions** — they were an incomplete
  worktree `node_modules`. *If you hit unrelated-package failures in a worktree, run
  `npm ci` before blaming your diff.*
- **`page.goto` deep-link reload disables the composer** → `sendPrompt` no-ops silently.
  *If a faux canvas write never produces a tab, check the composer isn't `[disabled]`
  from a reload; use a no-reload path.*
- **The faux-read `OpenFileButton` path is flaky** in the harness (same failure hit
  the untouched `editor-pane.spec.ts:24`). *Prefer the deep-link / agent-url open for
  establishing reading context.*
- **Spec-delta headers drift after a dependency ships** — an auto-canvas requirement
  was `MODIFIED` against a header that never existed; it had to be `ADDED`. *After
  develop advances, re-check every delta's ADDED/MODIFIED against the shipped spec.*
- **An atomic multi-edit conflict resolution failed silently** on a subtle mismatch —
  splitting it into single edits worked. *If a multi-edit leaves conflict markers,
  apply the hunks one at a time.*
- **CodeRabbit's first "pass" was a rate-limit ACK**, not a review. *Wait out the
  ~15-min window and request a full review before treating it as a gate.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change worktree (`.worktrees/os-<change>`), Docker +
system Chrome (for `PW_CHANNEL=chrome`), `jq`, and push/PR credentials.

- [ ] `git status` / `git log origin/develop..` / grep source — establish filesystem reality
- [ ] Resolve any cross-change land-order via `ask_user` up front
- [ ] Implement TDD by section; run each L1 slice green
- [ ] Triage full-suite failures against base (stash diff); run `npm ci` if worktree deps are incomplete
- [ ] Harness up: `PW_CHANNEL=chrome`, port from `.pi-test-harness.json`, always-teardown
- [ ] Use a reload-free reading context for auto-canvas e2e (agent url → background file write)
- [ ] Rebase spec deltas onto shipped dependency; fix ADDED/MODIFIED; `openspec archive`
- [ ] Commit → merge develop → resolve → re-verify green → push → PR
- [ ] Watch CI green + wait for the *real* CodeRabbit review → squash-merge → remove worktree

**Final artifacts:** PR #350 (squash `820e159c`) merged to `develop`; 12 client files +
2 spec deltas; L1 reducer/opener/CanvasDriver/EditorPane tests; L3 specs F11–F15, F19.

---

_Generated from session `019f6d11` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: session facts sheet._
