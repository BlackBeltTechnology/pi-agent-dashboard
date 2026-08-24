---
session: 019f34c9
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [open-loopback-links-in-split-viewer]
proposal_excerpt: "Loopback dev-server URLs surface on two chat surfaces: (1) assistant/user prose via `MarkdownContent`, and (2) the `serve_mockup` MCP result card, which renders through `GenericToolRenderer` → `LinkifiedText` → `UrlLi…"
---

# How we did it: Open loopback links in the split viewer — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single skill invocation:

```
/skill:openspec-apply-change open-loopback-links-in-split-viewer
```

No prose, no scope description — the entire specification lived in the OpenSpec change
already on disk. The *real* objective: implement the `open-loopback-links-in-split-viewer`
change end-to-end so that clicking a loopback dev-server URL (`http://localhost:3000`,
`http://[::1]:…`, `http://127.0.0.1:…`) on **either** chat surface — assistant/user prose
rendered by `MarkdownContent`, and the `serve_mockup` tool-result card rendered through
`UrlLink` — opens that URL **inside the split-workspace live viewer** instead of punching
out to the system browser, while preserving the deep-link path and keeping a browser
escape hatch. Then, on later instruction, ship it (PR → CI → CodeRabbit → squash-merge).

## 2. TL;DR playbook

1. **Kick off with the apply skill against the named change:** `/skill:openspec-apply-change <change-name>`. The skill reads `tasks.md` + `design.md` and drives the implementation task-by-task in dependency order.
2. **State the ship intent up front:** tell the AI *"I will test later / use ship-change"* so it defers the one manual smoke task and heads straight for the ship pipeline instead of stalling on a human-only step.
3. **Let it build the shared primitive first** (`isLoopbackUrl` in `packages/shared/src/live-server.ts`) with a spoofing-vector truth table, then the consumers (viewer, context method, hook, both anchor surfaces) — TDD each with a co-located `*.test.ts`.
4. **Expect the worktree tsc/type-resolution artifact:** the workspace symlink resolves `@blackbelt-technology/pi-dashboard-shared` to the **main** repo's `packages/shared` (missing the new export until merge). Create a worktree-local symlink so `tsc` resolves, while vitest already passes via its alias.
5. **Triage the full-suite failures against clean `develop`** — re-run the failing files in the untouched main repo to prove they're pre-existing (here: `event-reducer` + `image-fit-extension` Jimp), never attempt to fix out-of-scope red.
6. **Run ship-change:** archive + sync specs, commit, PR against `develop`, watch CI.
7. **If CI is red only from a pre-existing base failure, PAUSE and report** — do not merge, do not fix unrelated code. Resume with `rebase onto develop` once the upstream fix lands.
8. **After rebase → green CI → CodeRabbit:** apply the real bug + the idiomatic test-robustness fixes, re-push, loop until CI green + 0 actionable threads, then squash-merge and clean up the worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Apply (Discovery → TDD implementation).** The AI read the change's context/source
files, then implemented in dependency order: shared `isLoopbackUrl` classifier (with a 12-case
truth table including credential-in-host, `0.0.0.0`, IPv4-mapped IPv6, trailing-dot, suffix-trick
and punycode spoofing vectors), the `LiveServerViewer` auto-launch (parse a `live:<url>` preset,
skip the picker, append `pathname+search` for the deep link), the `openLiveTarget()` context method
+ `useLoopbackLinkOpen()` hook (modifier/middle-click and null-context no-ops), and the wiring into
both `MarkdownContent.a()` and tool-output `UrlLink`. Each got a co-located test; 6 test files,
102 assertions, all green. It also updated the directory `AGENTS.md` rows + a `MarkdownContent`
sidecar and passed `kb dox lint` + the Biome changed-files gate. **Why it worked:** building the
pure classifier first, with the adversarial truth table, made every downstream consumer trivial
and secure-by-construction.

**Phase 2 — Verify, and the worktree type-resolution trap.** `tsc` reported `isLoopbackUrl`
unresolved because the workspace symlink pointed at the *main* repo's `packages/shared` (no new
export pre-merge) while vitest used a worktree alias — so tests passed but types failed. The AI
correctly diagnosed this as a worktree-isolation artifact and created a worktree-local symlink to
make `tsc` resolve, leaving the remaining errors (pre-existing Jimp issues in `image-fit-extension`)
untouched.

**Phase 3 — Ship attempt 1 → PAUSE on a pre-existing base failure.** ship-change archived + synced
6 requirements across 3 capabilities, committed, opened **PR #247**, watched CI. CI went red — but
*only* on two `pi-dashboard-web` `event-reducer` tests the change never touched. The AI proved
`develop`'s own last 3 CI runs were already red on the same tests, declined to fix out-of-scope
reorder logic (surgical-changes rule), and **paused with a clear resume recipe** rather than merging
red or scope-creeping.

**Phase 4 — Rebase → green → CodeRabbit fix loop → merge.** On the operator's *"develop fix
presented, rebase to develop"*, the AI rebased onto the reducer fix (#248), confirmed green CI, then
processed 4 CodeRabbit findings: one **genuine bug** (stale `deep` state in `LiveServerViewer` —
threaded `deep` through `launch()` + added a regression test), a spec-wording narrowing, and a
`vi.mock` → `vi.hoisted()` conversion in 3 test files for robustness. Re-pushed, looped to CI green +
0 actionable threads, squash-merged (`ec3ea2daa`), and cleaned up the worktree from the parent repo.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change open-loopback-links-in-split-viewer`. Effective
  because the spec was already fully authored in OpenSpec: the one-line skill call handed the AI a
  complete, task-decomposed brief. *Lesson: front-load the spec into the change, and the kickoff is a
  single deterministic command.*
- **High-leverage steer** — `I will test later/ use ship-change`. Four words that unlocked the whole
  back half: it told the AI to defer the one human-only smoke task (6.3) and proceed autonomously into
  the ship pipeline instead of halting. *Reuse this verbatim whenever a manual QA task is the only
  thing blocking an otherwise-complete change.*
- **High-leverage steer** — `develop fix presented, rebase to develop`. A terse resume signal that
  released the paused ship. Effective because Phase 3 had already documented the exact resume recipe,
  so five words were enough to restart cleanly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the manual smoke task (6.3) as a hard blocker and stop | "I will test later / use ship-change" | Stating the QA-deferral + ship intent in the *first* prompt |
| Pause (correctly) when base-branch CI was red and wait for a human decision | "develop fix presented, rebase to develop" | Pre-agreeing the resume trigger: "if red is pre-existing, pause; I'll say when develop is fixed" |
| Nothing else needed correcting — implementation, triage, and ship discipline were self-driven | — | — |

The notable thing: only **3 prompts total** drove a 6h45m, 18-file, full-ship session. The AI's own
guardrails (surgical changes, never-merge-red, prove-failures-pre-existing) held without human
policing. The steering was almost entirely *policy unlocks*, not *corrections*.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session was a *consumer* of the existing skill chain,
which is exactly why it ran so cleanly:

- **`openspec-apply-change`** — turned a one-line invocation into task-ordered TDD implementation.
- **`ship-change`** — drove archive → PR → CI-watch → CodeRabbit → squash-merge, including the
  correct *pause-on-pre-existing-red* behavior and the parent-repo worktree cleanup.
- **`kb dox lint` + Biome changed-files gate** — kept the per-file `AGENTS.md` rows and code quality
  green without manual bookkeeping.

*Recommendation:* the worktree tsc-resolution symlink trick (Phase 2) is a recurring foot-gun worth
a project memory — "in a worktree, a new `packages/shared` export fails tsc (symlink → main repo) but
passes vitest (alias); create a worktree-local `node_modules/@blackbelt-technology/...` symlink."

## 7. Pitfalls & dead ends

- **Worktree type-resolution split-brain** — new shared exports pass vitest but fail `tsc` because the
  workspace symlink resolves to the *main* repo. **Fix:** create a worktree-local symlink to the
  worktree's `packages/shared`; don't chase phantom type errors.
- **Full-suite red that isn't yours** — 22 failures (`event-reducer`, `image-fit-extension` Jimp)
  were all pre-existing. **Fix:** re-run the exact failing files against clean `develop`/main to prove
  it, then ship your own green tests; never fix out-of-scope red.
- **CI red from a broken base branch** — PR #247's first CI failed only on `develop`'s own broken
  tests. **Fix:** pause, document the resume recipe, wait for the upstream fix, rebase — do not merge
  red and do not fix unrelated code.
- **CodeRabbit "false positive" that's worth applying anyway** — the `vi.mock`-references-const finding
  was technically a lazy nested closure (tests passed), but converting to `vi.hoisted()` is the
  idiomatic robust fix. **Apply idiomatic fixes even when the current code happens to work.**
- **Squash-merge `--delete-branch` fails on worktree collision** — the local post-merge checkout
  collides because `develop` is checked out in the parent. **Fix:** delete the remote branch and run
  `git worktree remove` from the **parent** repo; finish cosmetic cleanup from a neutral cwd.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-authored OpenSpec change on disk (`openspec/changes/<name>/` with
`tasks.md` + `design.md`), a git worktree for the change, GitHub CLI auth (for PR/CI/CodeRabbit),
and a decision on the manual-QA deferral.

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Immediately state: *"I will test later / use ship-change"* (defers manual QA, unlocks autonomy)
- [ ] Build the shared pure classifier first, TDD, with an adversarial spoofing truth table
- [ ] Wire consumers (viewer, context, hook, both anchor surfaces) each with a co-located test
- [ ] If `tsc` fails on a new shared export in a worktree → add the worktree-local `packages/shared` symlink
- [ ] Prove any full-suite red is pre-existing (re-run failing files on clean `develop`); ship only your green tests
- [ ] ship-change: archive + sync specs → commit → PR against `develop` → watch CI
- [ ] If CI red only from base failures → PAUSE, document resume recipe, wait; on *"rebase to develop"* rebase onto the fix
- [ ] Apply CodeRabbit findings (real bugs + idiomatic robustness), re-push, loop to green CI + 0 threads
- [ ] Squash-merge (`ec3ea2daa`); delete remote branch + `git worktree remove` from the parent repo

**Final artifacts:** merged PR #247 → `develop` (squash `ec3ea2daa`); new
`packages/client/src/lib/use-loopback-link-open.ts` (+ test); edits to
`packages/shared/src/live-server.ts`, `LiveServerViewer.tsx`, `SplitWorkspaceContext.tsx`,
`MarkdownContent.tsx`, `tool-renderers/UrlLink.tsx` (all + tests); synced specs across
`chat-markdown-rendering`, `live-server-preview`, `tool-output-linkification`.

---

_Generated from session `019f34c9` · `pi-agent-dashboard` · 2026-07-06. Source extract: deterministic facts sheet (mktemp)._
