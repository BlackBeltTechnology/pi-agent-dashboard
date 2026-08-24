---
session: 019f5e36
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~10832 tok)"
upgrade_status: pending
openspec_changes: [redesign-prompt-input, card-gradient-state-animation]
proposal_excerpt: "Today the chat composer scatters its controls across three stacked components:"
---

# How we did it: Redesign the chat prompt-input into one unified composer card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session actually opened on an unrelated snag — the user typed:

```
wrong server. Some test get that running pi-asboard. Back to the older instsll
```

Two `pi-dashboard` servers were fighting over port 8000 (a stale worktree test
server had shadowed the main install). Once that was cleared, the **real** objective
arrived as the second prompt: `/skill:openspec-apply-change redesign-prompt-input` —
implement the 26-task OpenSpec change that **collapses the three stacked composer
components (StatusBar model row + QueuePanel + CommandInput) into a single unified
composer card** with a morphing send/stop button, a `Steer|Queue` delivery control, a
`＋` attach menu, and a focus-revealed footer carrying a context-left indicator. The
third prompt (`I will test later ship-it`) handed off the finished implementation to
the `ship-it` pipeline, deferring the one manual visual-QA task to post-merge.

## 2. TL;DR playbook

1. **Clear the environment first.** If port 8000 is misbehaving, find the two
   listeners (`lsof -iTCP -sTCP:LISTEN -P -n | grep 8000`), identify the stale
   worktree test server by its cwd/uptime, and kill it so the main install serves.
2. **Kick off with the skill, not prose:** `/skill:openspec-apply-change <change>`.
   OpenSpec skills resolve from the **main repo root**, not the worktree `.pi/skills`.
3. **Read before writing.** Load proposal + design + spec + every affected source file
   (CommandInput, StatusBar, App, useImagePaste, the mockup HTML, existing tests)
   *before* touching a line. This was a ~1000-line rewrite across 6 files.
4. **Run the mandated `doubt-driven-review` (task V2) and check in with the human**
   before implementation stands — this change *reverses an archived layout decision*.
5. **Baseline the tests** via the harness (`npm test`, which sets ephemeral `HOME`) so
   you know the green count (89 → grew to 3377 full-suite) before you change anything.
6. **Implement in phases**, preserving intricate logic with targeted `edit`s: extend
   `useImagePaste` (DRY `addFiles`), rewrite `CommandInput` render, slim `StatusBar`,
   rewire `App`. Typecheck + run the affected test files after each phase.
7. **Update docs surgically:** per-file `AGENTS.md` rows for changed source, promote a
   >200-char row to its `.tsx.AGENTS.md` sidecar, run `openspec validate` + Biome.
8. **Hand to `ship-it`** with `I will test later ship-it`; defer the manual V5 task,
   archive+sync specs (use `RENAMED` when a requirement header changed), open the PR,
   watch CI, auto-apply CodeRabbit fixes, loop until green, squash-merge, clean up.

## 3. How the collaboration unfolded

**Phase 0 — Environment triage (03:29–03:31).** The AI diagnosed two servers on port
8000: the main install (pid 57588) vs a stale worktree test server (pid 93049) that
had grabbed `127.0.0.1:8000` and was answering health checks. It killed the test
server and confirmed the main install served again. *Effective bit:* it distinguished
the processes by **cwd + uptime + bind address**, not just PID.

**Phase 1 — Read-only investigation (03:57–03:59).** Loaded the apply instructions (26
tasks, 0 done), then read proposal/design/spec and all affected sources — a 775-line
`CommandInput`, `App` wiring, the approved mockup DOM/CSS, and the existing test files.
It resolved an open design question by grepping for the context-budget datum
(`ContextUsage { tokens, contextWindow }`) to decide task 3.4/11 was **in-scope**.

**Phase 2 — The V2 doubt-driven-review gate (03:59–04:03).** Because the proposal
gated the change behind a `doubt-driven-review` *before* implementation and it
**reverses the archived `statusbar-inline` decision** (the second reversal of the same
surface in ~6 weeks), the AI stopped and presented the risk analysis + plan for human
sign-off rather than silently proceeding. *This is the pivotal decision point.*

**Phase 3 — Phased implementation (04:03–04:30).** After sign-off: baseline tests (89
green) → extend `useImagePaste` with `addFiles` sharing paste validation (DRY) →
rewrite `CommandInput` into one bordered card with a **morphing action button** (one
button swapping `data-testid`+glyph across `send→stop→force-stop→killing`) → slim
`StatusBar` to working-status only → rewire `App` to relocate model/thinking into the
composer and the session-action strip above the card. Each phase ended with a targeted
`tsc --noEmit` + affected-test run. Notably the `CommandInput` rewrite passed **all 67
existing tests with zero test changes** — the morphing logic was behaviorally
equivalent. New feature tests added +20 over baseline.

**Phase 4 — Docs + quality gates (04:24–04:30).** Updated per-file `AGENTS.md` rows,
promoted the over-long `StatusBar` row to a sidecar, ran `openspec validate` (V1 pass),
Biome (0 errors after safe import-sort fixes; intentionally did **not** auto-fix
`useExhaustiveDependencies` warnings guarded by stale-closure comments), and cleaned
the one warning its change introduced (orphaned `rolesMap` made write-only, surgically).
Full client suite: **3377 passed, 3 skipped**.

**Phase 5 — ship-it (09:03–09:57).** Deferred the manual V5 task; hit an archive block
because a delta `MODIFIED` requirement header didn't match the base — resolved by
adding a `## RENAMED Requirements` section (FROM→TO) alongside the `MODIFIED`. Opened
PR #317; CI didn't trigger because the PR was `CONFLICTING/DIRTY` — merged `develop`,
resolved a single `components/AGENTS.md` conflict (union-keep, alphabetical). CI went
green (the local `pi-image-fit` Jimp failures were env-only). CodeRabbit posted 8
actionable; 6 in-scope were auto-fixed (strengthening tests, no weakening), 2 unrelated
archived-file findings skipped. Round-2 CI green → squash-merged `48e10a1d9` → worktree
+ branches cleaned up.

## 4. Prompts that worked

- **Goal prompt (the skill invocation):** `/skill:openspec-apply-change redesign-prompt-input`
  — invoking the skill directly (not describing the task in prose) loaded the full
  task list, apply instructions, and project conventions deterministically. *This is
  the strongest kickoff for any OpenSpec change.*
- **High-leverage handoff:** `I will test later ship-it` — five words that (a) explicitly
  deferred the manual visual-QA task to post-merge and (b) triggered the whole
  ship pipeline. The AI correctly treated "test later" as a **defer**, not a skip.
- **Weak opener rewritten:** the typo-laden `wrong server… Back to the older instsll`
  worked only because the AI inferred intent. A stronger version:
  *"Two pi-dashboard servers are on port 8000; kill the stale worktree test server so
  the main install (pid from `lsof`) serves again."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Serve health checks from whichever server answered | "wrong server… back to the older install" | Name the target server by cwd/pid up front; check `lsof` bind address, not just the health response |
| Be ready to write ~1000 lines immediately | (implicit) the proposal's V2 `doubt-driven-review` gate | Keep the gate in the proposal — it forced a check-in *before* an archived-decision reversal stood |
| Defer the manual visual-QA task ambiguously | "I will test later ship-it" | State "defer manual/verify tasks to post-merge" so ship-it's keyword rule applies cleanly |
| Assume `contextUsage` needed new plumbing | (self-corrected via grep) | Grep for the datum before scoping a task in/out — it was already client-side |

The most important guardrail: **this change reversed an archived layout decision**
(`statusbar-inline`, the second reversal of the same surface in ~6 weeks). The AI
surfaced that residual risk explicitly and asked for sign-off rather than proceeding.
Always flag "this undoes a prior decision" to the human before implementing.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work was driven entirely by
**existing** project skills, which is itself the lesson:

- **`openspec-apply-change`** — turned a 26-task change into a resolved apply plan and
  enforced the read-context-first / doubt-review / validate discipline. Invoke it for
  any change with a `tasks.md`.
- **`ship-it` → `ship-change`** — drove archive→commit→PR→CI-watch→CodeRabbit-loop→
  squash-merge→cleanup as one orchestrated flow. Its built-in pitfalls (DIRTY PR blocks
  CI; `--delete-branch` collides with the parent worktree) each fired and were handled.
- **The per-file `AGENTS.md` tree + sidecar-split rule** — kept doc updates surgical;
  the over-200-char `StatusBar` row auto-promoted to `StatusBar.tsx.AGENTS.md`.

If anything *should* be captured: a short note that **OpenSpec `MODIFIED` requires an
exact header match; a renamed requirement needs a `## RENAMED Requirements` (FROM→TO)
section** — this cost a diagnostic round during archive.

## 7. Pitfalls & dead ends

- **Stale worktree test server shadows port 8000.** If health checks report an
  unexpected version/pid, `lsof` the listeners and kill the worktree server by cwd.
- **OpenSpec skills aren't in the worktree** `.pi/skills` — resolve them from the main
  repo root (project convention).
- **`npm test` vs bare `npx vitest`** — the harness sets an ephemeral `HOME`; run tests
  via `npm test` (or `HOME=$(mktemp -d) npx vitest`) or config-dir writes pollute.
- **Archive aborts on header mismatch** — a delta `MODIFIED` header that doesn't match
  the base is a *rename*; add `## RENAMED Requirements` FROM→TO, don't force the header.
- **DIRTY/CONFLICTING PR won't start CI** — if only CodeRabbit registers after ~15 min,
  check `mergeStateStatus`; merge `develop`, resolve, push to unblock CI.
- **Worktree tsc reads the parent's stale `packages/shared`** — post-merge tsc errors
  in *develop's newly-merged files* (not yours) are a worktree→stale-parent resolution
  artifact; CI checks out fresh and won't hit them. Verify your changed files are clean.
- **`gh pr merge --delete-branch` collides with the parent worktree checkout** — the API
  merge still succeeds; finish branch/worktree cleanup from the parent checkout.
- **Local `pi-image-fit` Jimp failures** (`Jimp is not a constructor`) are a worktree
  node_modules version mismatch, pre-existing and unrelated to a client-only change;
  CI's clean install passes. Confirm the failing package isn't in your diff.
- **Removing your own worktree kills the shell cwd** — the Bash tool pins to the deleted
  dir; finish trivial cleanup via the sandbox executor with an explicit cwd.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; the approved mockup (DOM + CSS
tokens); a clean port 8000; `gh` auth for the PR.

- [ ] Clear stale port-8000 servers (`lsof` → kill worktree test server).
- [ ] `/skill:openspec-apply-change <change>` (skill resolves from main repo root).
- [ ] Read proposal + design + spec + all affected sources + mockup + tests first.
- [ ] Run the mandated `doubt-driven-review`; **check in before reversing any archived
      decision**.
- [ ] Baseline tests via `npm test`; note the green count.
- [ ] Implement in phases (hook → CommandInput → StatusBar → App); `tsc` + affected
      tests after each; preserve intricate logic with targeted edits.
- [ ] Update per-file `AGENTS.md` rows (promote >200-char rows to sidecars);
      `openspec validate`; Biome (don't auto-fix guarded `useExhaustiveDependencies`).
- [ ] `ship-it`: defer manual tasks, archive (use `RENAMED` if a header changed), open
      PR, resolve conflicts to unblock CI, auto-apply safe CodeRabbit fixes, loop to
      green, squash-merge, clean up worktree + branches.

**Final artifacts:** `StatusBar.tsx` (+test +sidecar), rewired `CommandInput.tsx`,
`useImagePaste.ts` (`addFiles`), `App.tsx`, updated tests/specs/`AGENTS.md` — shipped
as squash `48e10a1d9`, PR [#317](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/317).

---

_Generated from session `019f5e36-41c6-7321-b75c-70875b44727f` · `pi-agent-dashboard` · 2026-07-14. Source extract: deterministic facts sheet._
