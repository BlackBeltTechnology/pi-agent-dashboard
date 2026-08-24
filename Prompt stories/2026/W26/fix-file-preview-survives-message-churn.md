---
session: 019f0a55
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~10153 tok)"
upgrade_status: pending
openspec_changes: [fix-file-preview-survives-message-churn]
proposal_excerpt: "In chat view, clicking a file link opens the inline `FilePreviewOverlay` (remote / no-editor fallback). When a new chat message arrives — or the in-flight assistant message streams another token — **the open preview c…"
---

# How we did it: fix-file-preview-survives-message-churn — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single skill invocation:

```
/skill:openspec-apply-change fix-file-preview-survives-message-churn
```

The real objective: apply an already-scoped OpenSpec change that fixes a chat-view
bug. Clicking a file link opens an inline `FilePreviewOverlay`, but the overlay's
open-state lived at the *leaf* (`FileLink`), inside the react-markdown subtree that
rebuilds on every content change. So any streaming token, reparse, or new message
reset it to `null` and the overlay vanished. The fix: hoist the open-state above the
message list so it survives message churn. Two later steering turns expanded the
scope — automate the fix's proof with Docker + Playwright, then ship the change end
to end.

## 2. TL;DR playbook

1. Start with `/skill:openspec-apply-change <change-name>` — it reads the proposal,
   design, and tasks, then implements task by task.
2. **Hoist ephemeral UI state out of the react-markdown subtree.** Create a context
   provider (`FilePreviewProvider` + `useFilePreview()` + `FilePreviewHost`) that
   owns `useState<FilePreviewTarget|null>` *above* the message list in `ChatView`.
3. **Make the hook degrade gracefully, not throw.** `FileLink`/`OpenFileButton` also
   render outside `ChatView` (readme dialogs, diagnostics, plugin UI). A throwing
   guard crashes those panels — use a context-or-local fallback instead.
4. Run tests via the **main repo's binaries** — worktrees under `.worktrees/` have no
   local `node_modules` (`node /main/node_modules/.bin/vitest …` from the worktree cwd).
5. When Playwright's browser CDN is blocked, **prove the fix in the Docker container
   with `agent-browser`** instead: rebuild `pi-dashboard:local` from the worktree, spawn
   a session against a fixture, drive the chat via API + browser.
6. Use the repo's **faux-scenario** system (`[[faux:...]]` prompts stream scripted
   assistant messages with no LLM credential) to reproduce streaming/churn deterministically.
7. Finish with `/skill:ship-change` — verify gate → archive + sync specs → PR → watch
   CI → apply CodeRabbit fixes → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & design read (20:26–20:28).** The AI read the change's context
files (proposal, design, tasks), the existing `FileLink`/`OpenFileButton`/`ChatView`
sources, and located the message-list render site. Effective because it grounded the
implementation in the actual render topology before touching code.

**Phase 2 — Implementation (20:28–20:29).** Created `FilePreviewContext.tsx`, rewrote
`useFileOpenRouting.ts` as routing-only, dropped inline overlay state from the two
leaf components, wrapped `ChatView`'s message list in the provider + host, and updated
the standalone test render helpers. New churn-survival tests written up front.

**Phase 3 — The design correction (20:34–20:48).** Running the full suite surfaced 53
client test failures. The AI spawned an `Explore` subagent to audit production render
sites and discovered the design's "throw outside the provider" guard was wrong:
`MarkdownContent` (→ `FileLink`) also renders in non-chat surfaces
(`PackageReadmeDialog`, `MarkdownPreviewView`, `DiagnosticsSection`, plugin UI). A
throwing guard would crash those panels. **Decision point:** the AI paused to confirm
the fix direction, then switched to a graceful context-or-local fallback. Failures
dropped 56 → 22, and the remaining 22 were confirmed pre-existing (Jimp env issue) or
full-suite load-flaky (pass in isolation).

**Phase 4 — Quality gate (20:52–20:57).** Biome (changed files only, surgically), tsc
(zero errors in touched files), CodeRabbit gate (rate-limited → warn-and-continue).
`design.md` updated to reflect the graceful-fallback reality. New-file doc rows
delegated to a subagent in caveman style.

**Phase 5 — E2E automation (21:15–21:49).** Steering turn: *"Is it possible to automate
with docker and playwright?"* The AI grounded the answer in existing primitives — the
`[[faux:...]]` fixture system + `tool-output-links.spec.ts` already open the overlay
end to end. It added a `text-realfile` faux scenario (`./hello.txt` linkifies and
resolves to a real fixture file) and a `file-preview-survives-churn.spec.ts`. Because
Playwright's `cdn.playwright.dev` was network-blocked, it **rebuilt `pi-dashboard:local`
from the worktree** and drove the running container with `agent-browser`: opened the
preview, fired churn via API (`[[faux:slow-stream]]` → 40 streamed chunks), and proved
the overlay stayed open, then Esc dismissed it. Decisive real-browser proof.

**Phase 6 — Ship (23:41–00:06).** Steering turn: *"USe ship-change skill."* Verify
gate, `openspec archive --yes` (synced delta into main spec), commit via `-F` file,
PR #180 against `develop`, CI green (8m07s). CodeRabbit posted 3 "Major" comments —
all valid: a real session-leak bug (unkeyed provider persists across session switches
→ fixed with `key={sessionId}`) plus two test-coverage gaps. Fixed, re-pushed, CI
green again, 0 unresolved threads, squash-merged (`ee81addf`), worktree removed.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-file-preview-survives-message-churn`.
  Effective because the change was already fully specced (proposal + design + tasks);
  the skill turns a well-scoped change into a task-by-task implementation with a built-in
  quality gate. Kickoff lesson: **do the OpenSpec design work first, then let the apply
  skill drive** — the AI doesn't have to guess intent.
- **High-leverage follow-up** — *"Is it possible to automate with docker and playwright?"*
  Short, open question that unlocked a whole E2E-automation phase. It worked because the
  AI grounded the answer in the repo's existing faux-fixture infrastructure rather than
  inventing a new harness.
- **High-leverage unlock** — *"yes"*. A one-word go-ahead after the AI laid out the plan;
  effective only because the preceding answer was concrete enough to approve.
- **The ship prompt** — *"USe ship-change skill."* Delegated the entire land-it pipeline
  (verify → archive → PR → CI → review → merge → cleanup) to one skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Implement exactly what design.md said (throwing guard outside provider) | (self-caught, but confirm-before-change is the pattern) | State up front: leaf components render in many surfaces → prefer graceful fallback over a throwing hook |
| Treat the fix as done after unit tests | "Is it possible to automate with docker and playwright?" | Ask for E2E proof up front on UI-behaviour bugs; point at the faux-fixture + `tool-output-links.spec.ts` primitives |
| Stop at "spec validated / would run" | "yes" (approve the heavy Docker build) | Pre-approve the container-rebuild path when Playwright's CDN is likely blocked |
| Leave the change implemented but unlanded | "USe ship-change skill" | End every apply session by invoking `ship-change` explicitly |

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **two project memories** were saved — both high-value
environment facts:

- **tool-quirk (worktree binaries):** Git worktrees under `.worktrees/` have NO local
  `node_modules` — `npm test`/`vitest`/`tsc`/`biome`/`playwright` are not on PATH. Run
  them via the main repo's binaries from the worktree cwd. *Effective because* it
  removes a repeated 15-minute "why is vitest missing" dead end on every worktree session.
- **insight (Playwright CDN fallback):** To verify a client UI fix end-to-end without
  Playwright's host browser (its `cdn.playwright.dev` can be network-blocked in the
  sandbox), rebuild `pi-dashboard:local` from the worktree and drive the running
  container with `agent-browser`. *Effective because* it converts a hard blocker
  ("can't download Chromium") into a reliable, reproducible proof path.

Subagents used: `Explore` (audit production render sites — the move that surfaced the
design correction) and two `general-purpose` spawns for delegated doc-index rows.

**Recommendation:** the "verify a client UI fix via the Docker container + agent-browser
when Playwright's CDN is blocked" workflow is repeatable enough to deserve its own skill
(spawn session against fixture → faux prompt → click → churn via API → assert overlay).

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** `vitest`/`tsc`/`biome`/`playwright` fail with
  "not found". → Invoke the main repo's binaries by absolute path from the worktree cwd.
- **Throwing context guard crashes non-chat panels.** `FileLink` renders far beyond
  `ChatView`. → Use a context-or-local fallback, never a hook that throws outside the provider.
- **Full-suite test failures that pass in isolation.** 22 "failures" were load-flaky
  timeouts (DiagnosticsSection) + a pre-existing Jimp dependency issue in an untouched
  package. → Re-run the suspicious files in isolation before assuming your change broke them.
- **`cdn.playwright.dev` blocked in sandbox.** Host Chromium can't download; `playwright
  test` can't launch. → Prove it in the Docker container with `agent-browser` instead.
- **Stale `pi-dashboard:local` image.** Managed mode runs `docker compose up` without
  `--build`, so it reuses a stale image and tests old code. → Rebuild the image from the
  worktree first; confirm your symbols (`FilePreviewProvider`) are in the served bundle.
- **Unkeyed provider leaks state across session switches.** `ChatView` is reused (not
  remounted) when switching sessions. → `key={sessionId}` on the provider so it resets.
- **Worktree branch-delete collision on squash-merge.** `develop` is checked out in the
  parent; the local branch shows "not fully merged" after a squash. → Delete remote first,
  `git worktree remove` from the parent, then force-delete the orphaned local branch.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-specced OpenSpec change (proposal + design + tasks);
Docker running; the main repo checked out alongside the worktree.

- [ ] `/skill:openspec-apply-change <change-name>` — implement task by task.
- [ ] For ephemeral UI state that dies on re-render: hoist it into a context provider
      above the churning subtree; keep leaf components render-only.
- [ ] Make the consuming hook degrade gracefully (context-or-local) — never throw
      outside the provider; audit all render sites with `Explore` first.
- [ ] Run tests/tsc/biome via the **main repo's binaries** from the worktree cwd.
- [ ] Add a deterministic E2E: a `[[faux:...]]` scenario + a Playwright spec; if the
      CDN is blocked, rebuild `pi-dashboard:local` and prove it via `agent-browser`.
- [ ] `/skill:ship-change` — verify → archive+sync → PR → CI → apply CodeRabbit fixes →
      squash-merge → remove worktree.

**Artifacts produced:**
- `packages/client/src/components/FilePreviewContext.tsx` (new)
- `packages/client/src/components/tool-renderers/useFileOpenRouting.ts` (new)
- `packages/client/src/components/__tests__/FilePreviewContext.test.tsx` (new)
- `tests/e2e/file-preview-survives-churn.spec.ts` (new)
- edits to `FileLink.tsx`, `OpenFileButton.tsx`, `ChatView.tsx`, `qa/fixtures/faux-scenarios.ts`
- PR #180 (merged, squash `ee81addf`)

---

_Generated from session `019f0a55-1196-7619-be17-39f6c11151b8` · `pi-agent-dashboard` · 2026-06-27. Source extract: deterministic facts sheet (session-to-guideline)._
