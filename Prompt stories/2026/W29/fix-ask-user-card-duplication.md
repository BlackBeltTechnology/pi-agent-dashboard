---
session: 019f627a
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-ask-user-card-duplication]
proposal_excerpt: "A live `ask_user` prompt paints **two stacked cards** in chat:"
---

# How we did it: Fix the duplicate `ask_user` card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `ship-it` skill kickoff — "orchestrate the implementation
phase of the OpenSpec change `fix-ask-user-card-duplication` inside its worktree, run
headless, land it." The real objective, once the proposal was read: a live `ask_user`
prompt was **painting two stacked cards** in chat (the interactive widget *and* a
duplicate tool-result card). Kill the duplicate while keeping the resolved answer
visible, then take the change all the way through test → archive → PR → merge → cleanup.

## 2. TL;DR playbook

1. **Orient on filesystem reality, not the checkbox.** `ship-it` starts by asking: do
   the test files and code edits already exist? Clean tree → nothing done yet → begin.
2. **Read the real data shape before trusting the design pseudo-code.** The proposal
   read `m.args.toolCallId`; the reducer actually stamps `toolCallId` **top-level**
   (args only has `requestId`). Implement against reality: `m.toolCallId ?? m.args.requestId`.
3. **Write the failing tests first (TDD red).** New `ChatView.ask-user-suppression.test.tsx`
   (pending, resolved-but-live, history-reload) + resolved-message tests in all 4 renderers.
   Run with an ephemeral `HOME=$(mktemp -d)` and the `@blackbelt-technology/pi-dashboard-web`
   vitest project.
4. **Find the real suppression hook.** Every toolResult is wrapped in a `ToolBurstGroup`
   (threshold 1), so per-row `isRowVisible` suppression is **dead code**. Filter suppressed
   `ask_user` toolResults out of the list **before** `groupToolBursts`.
5. **Add the message body to the resolved branch** of Confirm/Select/Multiselect/Input
   (cancelled/dismissed stay terse). `MarkdownContent` needs `ThemeProvider` + a `matchMedia`
   stub in the test setup.
6. **Verify green + isolate pre-existing noise.** `npm test` showed 18 failures — all in
   disjoint packages (`image-fit`, `shared`); the web project passed fully. Confirm on
   `develop` before shipping.
7. **Ship in the order the human asked:** archive (sync delta specs into main specs first)
   → commit → merge `develop` → open PR → watch CI → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (reality check).** The AI read the change artifacts and immediately
tested filesystem reality rather than trusting `tasks.md`: no `test-plan.md`, clean tree,
no implementation yet. It located the renderer files and `ChatView`'s `toolResult` branch,
and discovered an **existing** `findActiveInteractiveToolResultIds` / `hiddenToolResultIds`
helper — adjacency + pending-only. *Why it worked:* it understood why duplication still
happened (the old helper missed the resolved-but-still-present case) before writing a line.

**Phase 2 — Design correction.** The proposal's pseudo-code read `m.args.toolCallId`. The
AI verified the reducer and found `toolCallId` lives **top-level**, args only carries
`requestId` — reading from args would always miss. It implemented `m.toolCallId ?? m.args.requestId`.
*Decision point:* trust the running code, not the design doc.

**Phase 3 — TDD red.** Wrote suppression tests + resolved-message tests, ran them, confirmed
7 failed as expected. A T.2 test failed for the wrong reason (tool-card toggle `title` attr
was null in that render path) — fixed by selecting the button by **text content** (the summary),
matching the existing streaming test's detection pattern.

**Phase 4 — Implement + find the real hook.** First pass suppressed rows in `isRowVisible`;
tests still failed because `groupToolBursts` wraps even single tools, so the burst re-rendered
the row. The robust fix: **filter suppressed toolResults before grouping**, delete the dead
row-guards. Renderer message tests then needed `ThemeProvider` + a `matchMedia` `beforeAll`
stub. All 54 green.

**Phase 5 — Verify + isolate.** Full `npm test` → 18 failures, all in `pi-image-fit-extension`
(jimp native/types drift) and `pi-dashboard-shared` (publish.yml allowlist). None touched
`packages/client`. Confirmed pre-existing on `develop`. Quality gate: `tsc` errors all in
`image-fit`, Biome clean on changed files.

**Phase 6 — Ship (human-ordered).** The human steered the merge order: *"before PR merge
develop and archive before commit."* The AI archived (synced delta specs into main specs,
moved to `archive/2026-07-14-…`), committed, merged `develop` (which re-introduced a stale
non-archived copy of the change dir — consolidated into the archive), opened PR #324, hit
one **flaky** `goal-supervisor` respawn failure (passed locally 13/13), re-ran CI green,
CodeRabbit 0 comments, squash-merged, deleted the remote branch, removed the worktree.

## 4. Prompts that worked

- **The goal prompt (`ship-it` skill kickoff).** Effective because it named the change,
  pinned the phase (implementation-in-worktree), and set the end state (land it headless).
  A good kickoff hands the AI the whole skill contract, not a vague "fix the bug."
- **High-leverage follow-up: `"before PR merge develop and archive before commit"`** — one
  short line that fixed the entire ship ordering. Terse, imperative, unambiguous sequencing.
  Rewrite for reuse: *"Ship order: sync specs → archive → commit → merge develop → PR."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Follow the ship-change default order (commit → PR, merge later) | "before PR merge develop and archive before commit" | State the ship order in the kickoff; encode it in the ship-it skill |
| Trust the proposal's `m.args.toolCallId` pseudo-code | (self-caught) verify against the reducer's real shape | Always confirm data shape in source before implementing design pseudo-code |
| Suppress rows in `isRowVisible` (dead code under bursts) | (self-caught) read `groupToolBursts` / `ToolBurstGroup` | Know that every toolResult is burst-wrapped; filter *before* grouping |
| Treat a red `npm test` as a blocker | (self-caught) prove the 18 failures are pre-existing + disjoint | Diff against `develop` to isolate noise before halting a ship |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **consumed** existing ones (`ship-it`,
`openspec-apply-change`, the docker-harness/no-weakening scripts, the AGENTS.md tree
protocol). The reusable lesson worth capturing as a memory: **"In `ChatView`, suppress
`ask_user` toolResults by filtering before `groupToolBursts`, keyed on top-level
`toolCallId` (fallback `args.requestId`) — per-row `isRowVisible` guards are dead code
because bursts wrap single tools at threshold 1."** Invoke that memory whenever touching
interactive-widget/tool-card duplication in the client.

## 7. Pitfalls & dead ends

- **`m.args.toolCallId` is always undefined** — the reducer stamps `toolCallId` top-level.
  Use `m.toolCallId ?? m.args.requestId`.
- **`isRowVisible` suppression is dead code** — `groupToolBursts` (threshold 1) wraps even
  a single tool, so the burst re-renders the row. Filter the list *before* grouping.
- **Renderer message tests blow up without theme context** — `MarkdownContent` reads
  `ThemeProvider`; wrap renders and add a `matchMedia` `beforeAll` stub.
- **A test can fail for the wrong reason** — the tool-card toggle `title` attr was null in
  one render path; assert on button **text content** instead.
- **`merge develop` re-added the non-archived change dir** — develop had post-divergence
  files git didn't associate with the archive rename. Consolidate into the archive, verify
  spec sync survived, delete the duplicate.
- **`--delete-branch` fails when your shell cwd is the worktree being removed** — the merge
  succeeds but local cleanup can't run. Anchor the shell in the parent repo before cleanup.
- **Flaky `goal-supervisor` respawn test** — timing-sensitive, passes locally 13/13; re-run
  the CI job rather than chasing it.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change worktree (`.worktrees/os-<change>`), `gh` auth,
Node/vitest toolchain, an ephemeral `HOME` for test runs.

**Checklist:**
1. Read the change artifacts; check filesystem reality (test files / edits exist?).
2. Verify the real data shape in the reducer before trusting design pseudo-code.
3. Write failing tests (suppression + resolved-message) — `HOME=$(mktemp -d)` + web vitest project.
4. Fix at the right hook: filter suppressed `ask_user` toolResults **before** `groupToolBursts`.
5. Add `params.message` to each renderer's resolved branch; add `ThemeProvider` + `matchMedia` stub in tests.
6. Run `npm test`; isolate any pre-existing failures by diffing against `develop`.
7. Run `quality:changed`; update AGENTS.md `See change:` rows.
8. Ship: sync delta specs → archive → commit → merge `develop` → PR → CI (re-run flakes) → squash-merge → remove worktree (from parent repo).

**Final artifacts:** PR #324 (merged, squash `8e590ce`); `ChatView.ask-user-suppression.test.tsx`;
resolved-message edits in Confirm/Select/Multiselect/Input renderers; specs synced +
change archived at `openspec/changes/archive/2026-07-14-fix-ask-user-card-duplication`.

---

_Generated from session `019f627a-0a72-7736-88d1-072bfb9d1b6a` · `pi-agent-dashboard` · 2026-07-14. Source extract: session-to-guideline facts sheet._
