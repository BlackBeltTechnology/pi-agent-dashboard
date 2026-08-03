---
session: 019f065c
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts); large facts sheet (~10788 tok)"
upgrade_status: pending
openspec_changes: [selectable-tool-output-links]
proposal_excerpt: "Auto-linkified file paths and URLs in tool output cannot be selected with the mouse to copy their text. The link elements hijack the drag gesture: a `<button>` (file links) swallows the drag, and a draggable `<a>` (UR…"
---

# How we did it: Selectable tool-output links + stale-link fixes — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The opening prompt was a bug hunt, not a feature request:

> *"Recheck recent sessions and check the links became valid or invalid. Lot of times content not found"*

The real objective, once the AI quantified it: **the "content not found" that plagues file links in old tool output is not a link-resolution bug** — it's overwhelmingly that the target file was deleted (worktrees pruned after a change shipped). Two fixable slices remained: (a) a **git-diff `a/`/`b/` prefix** class that produced genuinely wrong links, and (b) a **generic error message** that read as a failure instead of "the file is gone." The session then expanded to *proving both fixes with Playwright against the newly-merged faux model*, and finally *shipping the whole change* end to end.

## 2. TL;DR playbook

1. **Quantify before coding.** Extract file tokens from recent session JSONL, resolve each against its session `cwd`, and bucket valid/invalid. (Here: 13,414 links, 57% invalid — 398/400 sampled misses genuinely absent, not misplaced.)
2. **Separate bug from noise.** Distinguish "wrong base dir" (fixable) from "file deleted" (inherent). This reframes the whole task: fix the fixable classes, make the rest read honestly.
3. **Fix the tokenizer class** — context-gated `stripDiffPrefix()` so only real `--- a/`, `+++ b/`, `diff --git` header lines drop the synthetic prefix; prose `a/x.ts` stays untouched. Keep display text verbatim.
4. **Humanize the error** — an exported `friendlyReadError()` mapping `not found` → "File no longer exists at `<path>`" and unknown-cwd → its own message.
5. **Unit-test both**, run in isolation to prove pre-existing worktree failures aren't yours (`npm test | tee /tmp/lt.log`, grep FAIL, run just your files).
6. **For the E2E, find the real seam.** Trace the render path; don't script the WebSocket. Here the **faux model** (`[[faux:...]]` scenarios) + assistant-text linkify via `MarkdownContent` was the no-approval seam.
7. **Rebuild the docker image** (client changes are baked in, not bind-mounted) before running the Playwright spec; `qa/fixtures` scenarios *are* bind-mounted.
8. **Ship via the `ship-change` skill** — verify gate → archive+sync specs → PR → watch CI → address CodeRabbit → squash-merge → clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 — Empirical diagnosis (Discovery).**
The AI resisted jumping to a fix. It read the linkifier + `/api/file` contract, then wrote a throwaway script to resolve every file token in the last 3 days of sessions against its `cwd`. First run returned zero tokens — the AI inspected the actual JSONL schema, found tool results are `message.role === "toolResult"`, fixed extraction, and re-ran. **Result: 57% invalid; of 400 sampled relative misses, only 2 exist anywhere under `cwd`.** *Why it worked:* the number reframed the ask from "fix broken links" to "the files are genuinely gone — fix the two real sub-classes and make the rest honest."

**Phase 2 — Two surgical fixes (Design/Generate).**
Steering prompt "1 and 2" authorized both. Tokenizer got a context-gated diff-prefix strip (invalid git-diff class **86 → 1** empirically). `FilePreviewOverlay` got `friendlyReadError()`. +10 unit cases; the AI ran the suite, isolated its two files, and proved pre-existing failures (ports, jimp hoist) were environment, not its code.

**Phase 3 — Hunting a faithful E2E seam (the hard part).**
"Write playwright test for that" triggered a real architectural investigation. The AI traced: no REST history endpoint → chat arrives over a stateful `seq`-based WebSocket → `routeWebSocket` scripting would be brittle and violates the harness rule. It surfaced the boundary *before* writing anything brittle. When the human noted the **faux model merged to develop**, the AI rebased, studied the faux system, and found the clean seam: **assistant text linkifies via `MarkdownContent` with no tool-execution/approval needed.**

**Phase 4 — The docker rollup blocker (Verify).**
Rebuilding `pi-dashboard:local` failed on `@rollup/rollup-linux-x64-gnu MODULE_NOT_FOUND`. The AI iterated hypotheses: install-vs-ci optional-dep skip (no), lockfile incomplete (no — it *had* the linux binary), finally **npm bug #4828** — the fix the error itself prescribes: `rm -f package-lock.json` before `npm install` in the build step. Build went green; all E2E specs passed including the new one.

**Phase 5 — Cover the manual task + ship.**
Two follow-ups asked whether the smoke test and the last unchecked task (3.2, manual drag-select) were Playwright-able. The AI split 3.2 into an automatable half (real mouse drag + `window.getSelection()`) and an OS-level half (Ctrl+C clipboard — not deterministic in Playwright), implemented the selection spec, then ran `ship-change`: verify gate (8078 tests), archive+sync, PR #173, CI green twice, 3 CodeRabbit threads (2 fixed, 1 declined with documented rationale), squash-merge, worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — *"Recheck recent sessions and check the links became valid or invalid. Lot of times content not found."* Effective because it pointed at **observable symptom + real data source** (recent sessions), inviting measurement rather than a guessed fix. A stronger version: *"…and tell me whether it's a resolution bug or the files are actually gone — quantify with a sample."*
- **"1 and 2"** — a 3-character authorization that unlocked implementing both diagnosed fixes at once. High leverage because the AI had already laid out exactly two numbered options.
- **"The Faux model run capability merged to develop, so when rebase you can test with that model"** — the single most valuable steer: it handed the AI the exact seam it had been missing, converting a "this E2E is architecturally brittle" dead end into a clean test.
- **"In the proposal task list there is an unchecked item. Is it possible to test that case with playwright?"** — surgical: pointed the AI at the one remaining manual task and asked for the automatable slice.
- **"Use ship-change skill"** — named the exact workflow, letting the AI run the full land sequence without re-deriving it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Be ready to fix links before measuring | (implicit in the goal) "check … valid or invalid" | Always quantify a symptom with the real data source before proposing a fix |
| Stall at an architectural E2E boundary (WS scripting is brittle) | "the Faux model … merged to develop, you can test with that model" | Check `develop` for a merged test harness (faux model) before declaring an E2E untestable |
| Treat one manual task as un-automatable | "Is it possible to test that case with playwright?" | Split manual tasks into automatable (selection, DOM) vs OS-level (clipboard) halves; automate the first |
| Leave the ship steps ad hoc | "Use ship-change skill" | Name the workflow skill explicitly so the full land sequence runs |

Quality bars the human imposed implicitly: **don't ship a brittle test** (the AI chose to surface the WS boundary rather than mock it), and **every unchecked task gets addressed** (task 3.2 was hunted down and covered/documented, not skipped).

## 6. Skills, tools & memory created — and why they're effective

No new skill was created, but the session leaned on and validated several:

- **`ship-change` skill** — drove the entire land: verify gate → archive+sync specs → PR → CI watch → CodeRabbit triage → squash-merge → worktree cleanup. Reusable because it encodes the exact ordering and the known worktree/`develop` `--delete-branch` collision fix (delete remote + remove worktree manually).
- **The faux-model E2E pattern** (`[[faux:<scenario>]]` in `qa/fixtures/faux-scenarios.ts`) — the reusable seam for deterministically rendering tool/assistant output in a real browser without a live model or WebSocket scripting. Add a scenario, drive it from a spec.

**Recommended skill to create:** a *"quantify-link-validity"* helper — the throwaway script that resolves file tokens across recent session JSONL against each `cwd`. It re-proved its value here and would answer "are links breaking?" in seconds next time.

## 7. Pitfalls & dead ends

- **Zero-tokens first run** — session JSONL tool results are `message.role === "toolResult"`, not what you'd guess. Inspect the real schema before trusting an extraction.
- **Scripting the dashboard WebSocket for E2E is brittle** — it's a stateful `seq`-based subscribe/replay protocol; faking it rots on any protocol change. Use the faux model seam instead.
- **Client changes are baked into `pi-dashboard:local`** — you MUST rebuild the image before an E2E reflects them; only `qa/fixtures` is bind-mounted (live).
- **Docker build `@rollup/rollup-linux-x64-gnu MODULE_NOT_FOUND`** — this is **npm bug #4828**, not your code. `npm ci` does NOT fix it. The fix the error prescribes: `rm -f package-lock.json` before `npm install` in the build step (scoped to the image).
- **Worktree dep-skew after rebase** — pulling develop's new deps (e.g. `remark-frontmatter`) breaks tests until you `npm install` in the worktree.
- **`doctor-route.test.ts` timing flake** — `elapsed 3046ms < 3000ms` under concurrent-build load. Confirm in isolation; not a real failure.
- **`ship-change` `--delete-branch` fails on the worktree/`develop` collision** — finish cleanup manually: delete remote branch, `git worktree remove`, `git branch -D` from the *parent* repo (your shell cwd dies with the removed worktree).

## 8. Reproduce it faster — checklist

- [ ] Extract file tokens from recent session JSONL (`message.role === "toolResult"`), resolve vs each session `cwd`, bucket valid/invalid — quantify before coding.
- [ ] Sample the relative misses: exist elsewhere under `cwd`? → resolution bug. Absent? → file deleted (make the message honest, don't chase).
- [ ] Tokenizer: context-gated `stripDiffPrefix()` (only real diff-header lines); keep display text verbatim.
- [ ] Overlay: exported `friendlyReadError()` mapping `not found` / unknown-cwd to human messages.
- [ ] Unit-test both; run your files in isolation to exclude pre-existing worktree failures.
- [ ] E2E: use the **faux model** (`[[faux:...]]` + assistant-text `MarkdownContent` linkify) — never script the WebSocket.
- [ ] Rebuild `pi-dashboard:local` before the spec; if rollup MODULE_NOT_FOUND → `rm -f package-lock.json` then `npm install` in the build step.
- [ ] Ship via `ship-change`; finish worktree cleanup manually after squash-merge.

**Key inputs to have ready:** access to `~/.pi/agent/sessions/*.jsonl`; a develop that includes the faux-model harness; docker for the E2E image; `gh` authed for the PR.

**Final artifacts produced:**
- `packages/client/src/lib/linkify-tool-output.ts` (diff-prefix strip)
- `packages/client/src/components/FilePreviewOverlay.tsx` (`friendlyReadError()`)
- `tests/e2e/tool-output-links.spec.ts` (diff-strip + stale message, faux)
- `tests/e2e/tool-output-selection.spec.ts` (drag-select selection)
- `qa/fixtures/faux-scenarios.ts` (`text-difflinks`, `text-linkrefs`)
- `docker/Dockerfile` (npm #4828 lockfile workaround)
- Merged as PR **#173**, commit `6174f534`.

---

_Generated from session `019f065c-793f-7135-b37d-7351a3ad1a3e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-1784864141N.md`._
