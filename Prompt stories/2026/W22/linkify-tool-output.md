---
session: 019e7b81
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (16 user prompts)"
upgrade_status: pending
openspec_changes: [linkify-tool-output]
proposal_excerpt: "`GenericToolRenderer` dumps tool results as raw `<pre>` text. Bash/grep/find/tsc/lint output buries file paths and URLs as plain characters — users see `src/foo.ts:42` but cannot click it. `OpenFileButton` exists and…"
---

# How we did it: linkify tool output — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: **`/skill:openspec-apply-change linkify-tool-output`**. No prose — the whole intent lived in the pre-written OpenSpec change. The real objective: turn dead `<pre>` tool output in the dashboard client into clickable links — `src/foo.ts:42:7` opens the file (editor or preview overlay), bare URLs become anchors — while blocking hostile schemes (`javascript:`, `data:`, `vbscript:`, `file:`) and avoiding false positives on prose like `v1.2.3` or `math.PI`. Everything after prompt 1 was mechanical steering: verify in a browser, then rebase → push → PR → fix review → merge → clean up.

## 2. TL;DR playbook

1. **Kick off from the spec:** `/skill:openspec-apply-change <change>`. Let the apply skill walk tasks.md in order (tokenizer → components → renderer wiring → cross-cutting → docs/ship), TDD each task (write tests, run, mark done).
2. **Prove it visually in isolation:** spin a throwaway Vite server from the worktree on a spare port (`:3001`) with a tiny `linkify-demo.html` + `.tsx` rendering realistic samples; open with the `browser` skill; screenshot + a11y-snapshot to count links per case.
3. **Clean up demo artifacts before they ship** — `rm` the demo files, kill the Vite process. They live under `packages/client/src/` and would otherwise be committed.
4. **Rebase, expecting repeated drift:** `git fetch` + rebase onto `origin/develop` each time it advances. Resolve conflicts by *keeping develop's incidental changes* (font class `text-code`, new doc rows) *plus your logic*.
5. **Push + open PR** with a full description (spec scope, test counts, manual-QA matrix, coexistence notes with overlapping merged PRs).
6. **Fix CodeRabbit as a batch:** fetch all unresolved threads, verify each against current code, present a severity table, apply, re-run the 99 tests, push one `fix:` commit.
7. **Monitor CI → merge:** poll `gh` until `ci` + `CodeRabbit` both green and 0 unresolved threads; squash-merge; if `--delete-branch` errors on a worktree, merge succeeded already — just delete the remote ref + remove the worktree.

## 3. How the collaboration unfolded

**Phase A — Spec-driven implementation (Opus, TDD).** The apply skill read the delta specs and existing files (`MarkdownContent`, `ErrorBoundary`, `file-routes.ts`, `ImageLightbox`), then built in five task groups: tokenizer + 80 tests (unit/fuzz/perf), 4 link components + 12 tests, renderer wiring (`GenericToolRenderer`, `BashToolRenderer` strips ANSI first) + 7 integration tests, cross-cutting security guards, and docs/CHANGELOG. It marked 20/22 done, deferring the manual-QA matrix and the land-time build/restart/reload. *Why it worked:* tasks.md gave a strict, checkable order; every task closed on a green test run.

**Phase B — Isolated browser proof (steering #1–#2).** "make a local test with browser" pushed past unit tests into visual evidence. The live dashboard ran from a *different* worktree, so changes weren't there — the AI stood up its own Vite server on `:3001` with a demo page, opened it, and used screenshots + a11y snapshots to count links per case (hostile schemes → 0, prose negatives → 0, precedence → one anchor). "maybe some tasks have to be close?" nudged it to knock out the remaining manual-QA sub-cases (b/c/d) via quick browser checks and close task 4.3.

**Phase C — The rebase treadmill (steering #4–#7).** `origin/develop` advanced four times (PRs #64/#65/#66/#67). Each "rebase to develop" was a fresh fetch + replay. The third one hit real conflicts, resolved by taking develop's `text-code` font standardization + dropping the old `ansi-to-react` import while keeping the linkify wrapper. The AI also noticed PR #65 shipped an overlapping `FilePreviewOverlay`/`PreviewCard` — confirmed no name collision, flagged a coexistence follow-up.

**Phase D — Ship & review loop (steering #8–#15).** push → create PR (#68) → "fix coderabbit issues" (4 threads, batched + verified) → "monitor CI" → "autofix" (one more Minor: graceful `<img onError>`) → "merge PR" → "cleanup worktree". The merge threw a worktree error on `--delete-branch`, but the squash had already landed — the AI recovered by deleting the remote ref separately and removing the worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change linkify-tool-output`.** Effective because the *entire* specification was pre-loaded into the OpenSpec change. The prompt itself is trivial; the leverage came from having a good tasks.md upstream. Lesson: front-load intent into the spec, not the chat.
- **"make a local test with browser"** — high leverage. Forced a real rendered-DOM proof instead of trusting unit tests, which surfaced the fact that the live dashboard was serving a *different* worktree.
- **"fix coderabbit issues" / "autofix"** — short, unlocked a full batch-verify-apply-push loop. Works because the review-fix skill knows the whole cycle.
- **One-word steers ("push", "create PR", "monitor CI", "yes", "merge PR")** — each drove a complete multi-step operation. This only works when the prior context is unambiguous; here it was, because each turn had one obvious next action.

Weak-prompt rewrite: the three separate "rebase to develop" turns could be replaced by **"rebase onto develop, and re-rebase automatically whenever origin/develop advances before we merge"** — stating the treadmill up front.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at unit-test green, calling it verified | "make a local test with browser" | Add a task: browser-verify rendered DOM in an isolated Vite server before marking a UI change done |
| Leave demo scaffold (`linkify-demo.html/.tsx`) under `packages/client/src/` | (implicit) — it self-caught and `rm`'d them | Always create throwaway demo files under `/tmp` or delete + kill the server before committing |
| Treat one rebase as final | Repeated "rebase to develop" as origin advanced | State "keep re-rebasing until merged"; expect a fast-moving `develop` |
| Consider deferred manual-QA tasks optional | "maybe some tasks have to be close?" | Explicitly close every tasks.md item (verify or note the reason) before shipping |
| Over-engineer a one-line fix (extra state for `<img onError>`) | (self-corrected) "Over-engineered — useState setter already accepts updaters" | Prefer the minimal functional-updater form for React setState error handling |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The session leaned entirely on existing skills — `openspec-apply-change` (TDD task walk), `openspec-ff-change`, `browser` (visual proof), and the CodeRabbit autofix loop — plus one `Explore` subagent spawned to add file-index rows for the new files.

*Recommended skill to create:* **"isolated-ui-browser-verify"** — spin a worktree-local Vite server on a spare port with a minimal demo page, open with the browser skill, count links/elements per case via a11y snapshot, then tear down (rm demo + kill server). This session reinvented that flow by hand; it's clearly repeatable for any client-side UI change whose live dashboard runs from a different worktree. (A project skill `isolated-ui-verification` already exists for exactly this — invoke it instead of hand-rolling.)

## 7. Pitfalls & dead ends

- **Live dashboard ≠ your worktree.** The running server on `:8000` was a *different* worktree, so edits weren't visible there. Fix: start your own Vite server from the current worktree on a free port.
- **`agent-browser` a11y snapshot missed unannotated buttons/anchors.** The demo page had no `role`/`aria-*`, so the first snapshot came up empty; the screenshot was the real evidence, and a later snapshot (after structure) did pick up all 15 links. If the a11y tree is empty, trust the screenshot and/or add roles.
- **Overlay-branch click hit a Playwright quirk** navigating to `about:blank`. Don't chase it — the React `setPreviewOpen` path was already covered by 3 unit tests.
- **`run-bootstrap.test.ts > throttles progress events` is flaky** — passes in isolation, unrelated to client changes. Verify by re-running the single test, then move on.
- **`gh pr merge --delete-branch` errors when a worktree holds the branch**, but the squash-merge itself still lands. Recover by deleting the remote ref separately and `git worktree remove`.
- **`curl http://localhost:.../` sometimes failed inline** — the working pattern was `curl -s -o /tmp/out ... && cat /tmp/out`.
- **Removing the worktree invalidates the session cwd.** Warn first; subsequent shell calls need an explicit `cd` elsewhere.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a completed OpenSpec change with a strong tasks.md; a free local port for Vite; `gh` authenticated; CodeRabbit enabled on the repo.

**Steps:**
1. `/skill:openspec-apply-change <change>` — TDD each task group, mark done.
2. Invoke `isolated-ui-verification` (or: Vite on a spare port + `linkify-demo.html` + browser skill) to prove the rendered DOM; screenshot + count elements per case.
3. `rm` demo files + kill the Vite process before committing.
4. Close every tasks.md item (verify or annotate reason).
5. Rebase onto `origin/develop`; re-rebase whenever it advances; on conflict keep develop's incidental changes **plus** your logic.
6. Push → open PR with spec scope + test counts + QA matrix + coexistence notes.
7. Fetch all CodeRabbit threads, verify, apply as one `fix:` commit, re-run tests, push.
8. Poll CI until `ci` + `CodeRabbit` green and 0 unresolved threads → squash-merge → delete remote ref → `git worktree remove`.

**Artifacts produced (worktree-relative under `packages/client/`):** `src/lib/linkify-tool-output.ts` (+ unit/fuzz/perf tests), `src/components/tool-renderers/{UrlLink,FileLink,LinkifiedText,GenericToolRenderer,BashToolRenderer}.tsx`, `src/components/FilePreviewOverlay.tsx`, matching `__tests__`, plus `docs/file-index-client.md` rows and a `CHANGELOG.md` `## [Unreleased] > Added` entry. Landed as PR #68 (squash `0e440b8e`).

---

_Generated from session `019e7b81-2f56-7b66-9604-ce88327327f7` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-linkify-tool-output` · 2026-05-31. Source extract: `/tmp/facts-6ze1Jj`._
