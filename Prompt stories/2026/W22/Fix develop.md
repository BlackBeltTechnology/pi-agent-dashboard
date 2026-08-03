---
session: 019e5fca
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Fix a red `develop` CI run — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a one-liner and a link:

> "create a worktree from develop and fix: `https://github.com/.../actions/runs/26408254103/job/77736665707`"

The *real* objective, once the CI log was read: a `tsc` lint job on `develop` was
failing with **6 TypeScript strictness errors** in the client shell and two plugins.
All 6 were `Map` / `ReadonlyMap` and union-narrowing mismatches introduced when two
recent feature merges (`add-flow-agent-popout` + `add-subagent-inspector`) reconciled
types between the shell (`App.tsx`) and `dashboard-plugin-runtime`. The task: make
surgical, type-correct fixes in an isolated worktree, prove nothing regressed, and
push to `develop`. A second red run later surfaced **2 stale tests** that had to be
brought back in line with a prior deliberate implementation change.

## 2. TL;DR playbook

1. **Create a throwaway worktree from the target branch** (in `/tmp` so it never
   pollutes your main checkout): `git worktree add -b fix/ci-tsc-... /tmp/<name> origin/develop`.
2. **Reproduce the CI failure locally first** — run the exact failing job (`tsc`) and
   diff the local error list against the CI log so you fix *only* the reported lines.
3. **Read the type definitions before editing** — find each `*Like` / `*Snapshot`
   type, confirm it is consumed **read-only** so widening `Map → ReadonlyMap` is safe.
4. **Make the minimum surgical edits** — retype constants, widen to `ReadonlyMap` where
   read-only, and cast through `unknown` only where two shapes genuinely don't overlap.
5. **Re-run `tsc`; separate your errors from noise** — a generated file
   (`plugin-registry.tsx`) carried another dev's absolute paths; CI regenerates it via
   `vite build`, so `git checkout HEAD --` it and confirm zero *new* errors.
6. **Run the touched packages' tests, then verify any failures are pre-existing** by
   re-running them on a clean `develop` checkout (`git stash` / baseline) — don't own
   failures you didn't cause.
7. **Commit with a precise message, push `HEAD:develop`**, then watch the re-run.
8. **When the next CI run reveals stale tests**, confirm the impl change was deliberate
   (read the commit + code comments), then **update the tests to match**, not the impl.

## 3. How the collaboration unfolded

**Phase A — Isolate (worktree setup).** The AI first added the worktree as a sibling
of the main repo; the operator immediately steered: *"Create worktre in /tmp"*. The AI
removed the first worktree and recreated it under `/tmp/pi-agent-dashboard-fix-ci` on
branch `fix/ci-tsc-subagent-state-snapshot` from `origin/develop`. Isolating in `/tmp`
keeps the fix fully detached from the live dashboard checkout.

**Phase B — Reproduce & diagnose.** The AI ran `npm ci`, hit an install hiccup, fell
back to `npm install --ignore-scripts`, then reproduced `tsc` locally. It read the CI
log and matched all 6 errors line-for-line, then opened each call site plus the
underlying `SubagentState` / `SubagentStateSnapshot` / `SessionStateLike` /
`FlowAgentPopoutSessionLike` type definitions to pick the *correct* fix rather than a
blanket cast.

**Phase C — Surgical fix.** 4 files, 6 fixes: retype `EMPTY_SUBAGENTS_MAP` to
`ReadonlyMap<string, SubagentStateSnapshot>`; upcast a closure result via
`as unknown as`; map the 4-state `ConnectionStatus` union down to the runtime's 3-state
union at the boundary; widen two `Map` fields to `ReadonlyMap` (both proven read-only);
downcast Snapshot→State through `unknown`.

**Phase D — Separate signal from noise.** Re-running `tsc` left errors in the
*generated* `plugin-registry.tsx` — another machine's absolute paths (`/home/skrot1/...`).
The AI verified CI regenerates that file via the `prepare`→`vite build` script (which
the local `--ignore-scripts` had skipped), reverted it with `git checkout HEAD --`, and
confirmed **zero new** errors.

**Phase E — Prove no regression.** Ran the two plugins' suites (111 tests pass), then
the client tests touching `App.tsx`. 3 failed — the AI re-ran them on a clean `develop`
baseline and proved **all 3 were pre-existing** (2 caused by the same polluted generated
file, 1 an unrelated flaky popout test). It paused with a summary rather than pushing.

**Phase F — Push, then chase the second red run.** Operator: *"push it to develop"*.
After push, a new CI run failed on 2 tests. The AI traced both to an earlier deliberate
commit (`08564c23 fix-flows-plugin-polish`) that changed implementations without
updating tests: a popout button title (`"Open in new tab"` → `"Open subagent in new
tab"` + a `"noopener"` 3rd arg) and an inline-mode class (`max-h-[60vh]` → `h-[60vh]`,
a documented "stable height" choice). It updated the **tests** to match the intended
impl, verified locally, and pushed `8df7e312`.

## 4. Prompts that worked

- **Goal prompt (effective):** "create a worktree from develop and fix: `<CI job URL>`".
  A direct link to the *specific failing job* is high-leverage — the AI can read the
  exact error list and scope the fix precisely. Better than "CI is broken, fix it".
- **"Create worktre in /tmp"** — a one-line placement correction that kept the fix
  isolated from the main checkout. Bake this into the goal prompt next time.
- **"push it to develop"** — a deliberate go/no-go gate: the AI had *paused* before
  pushing and summarized, letting the human approve. Good pattern; keep the pause.
- **"ci error: `<second job URL>`"** — feeding the *next* failing run back in is the
  tightest possible follow-up; the AI needs no other context to continue.

**Stronger kickoff to reuse next time:**
> "Create a worktree from `develop` **in /tmp**, reproduce and fix the failing job at
> `<CI URL>`. Fix only the reported errors, prove any remaining test failures are
> pre-existing on a clean `develop` baseline, then pause for my OK before pushing."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Place the worktree next to the main repo (`../pi-agent-dashboard-fix-ci`) | "Create worktre in /tmp" | Say "worktree in /tmp" in the goal prompt |
| Want to push as soon as the fix looked done | It paused and summarized; human said "push it to develop" | Keep the pause-before-push gate explicit |
| — (it self-corrected here) treat generated-file / baseline test failures as its own | It re-ran them on clean `develop` to prove pre-existing | Ask up front: "prove remaining failures are pre-existing on baseline" |

The session needed *little* correction — the two real steers were **placement** (`/tmp`)
and the **push gate**. The disciplined moves (reproduce-first, revert the generated file,
baseline-diff test failures) came without prompting and are the parts worth reproducing.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. The workflow is, however, **clearly
repeatable** — a "fix a red CI job in a throwaway worktree" procedure. A future
`project` skill worth creating would capture:

- **Isolate:** `git worktree add -b fix/<slug> /tmp/<name> origin/<branch>`.
- **Reproduce-first:** run the exact failing job, diff local errors vs the CI log.
- **Generated-file trap:** `packages/client/src/generated/plugin-registry.tsx` carries
  per-machine absolute paths and is regenerated by CI's `vite build`; never commit local
  edits to it — `git checkout HEAD --` before pushing.
- **Baseline-diff test failures:** re-run any failing tests on a clean `develop` before
  claiming they're pre-existing.

This is effective because it removes the two recurring judgment calls — "is this error
mine?" and "did I regress this test?" — that otherwise cost the most time.

## 7. Pitfalls & dead ends

- **`npm ci` can fail on a fresh worktree** — the AI fell back to
  `npm install --ignore-scripts`. But `--ignore-scripts` **skips the `vite build`** that
  regenerates `plugin-registry.tsx`, so the committed (polluted, absolute-path) version
  is left in place and produces phantom `tsc` errors that **do not exist in CI**. If you
  see errors only in `generated/plugin-registry.tsx`, they're noise: `git checkout HEAD --`
  and ignore.
- **Don't own pre-existing test failures.** 3 client tests failed after the fix; all 3
  were pre-existing on `develop`. Always baseline-diff before assuming your change broke
  them.
- **A green `tsc` run is not a green CI run.** Fixing the lint job surfaced a *second*
  red run with stale tests — from an earlier commit that changed impl without updating
  tests. Expect to chase more than one job.
- **When a test disagrees with the impl, check which is intentional.** Here the impl
  changes (button title, `h-[60vh]` stable height, `noopener`) were deliberate and
  comment-documented — so the **tests** were wrong and got updated, not the code.
- One `grep` command failed (`grep … && echo … | head` short-circuited on no match);
  minor, retried with a different pattern.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing CI **job URL**; write access to `origin/develop`;
a clean local clone.

1. `git fetch origin develop`
2. `git worktree add -b fix/<slug> /tmp/<name> origin/develop`
3. `cd /tmp/<name> && npm ci` (or `npm install --ignore-scripts` on failure — but then
   remember the generated-file trap below)
4. Reproduce the failing job locally (`tsc` / the exact job); diff errors vs the CI log.
5. Read each error's type definition; fix *only* reported lines (widen to `ReadonlyMap`
   where read-only; cast through `unknown` only for non-overlapping shapes).
6. `git checkout HEAD -- packages/client/src/generated/plugin-registry.tsx` (CI
   regenerates it); confirm **zero new** `tsc` errors.
7. Run touched packages' tests; baseline-diff any failures on clean `develop`.
8. Commit precisely; **pause for the human's OK**; `git push origin HEAD:develop`.
9. Watch the re-run — if new tests fail, decide test-vs-impl by intent, update the
   loser, push again.

**Artifacts produced:** commit `eeb7466d` (type fixes, 4 files) + commit `8df7e312`
(2 test alignments), both on `origin/develop`; throwaway worktree
`/tmp/pi-agent-dashboard-fix-ci` (removable after merge).

---

_Generated from session `019e5fca` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-25. Source extract: session facts sheet (Fix develop)._
