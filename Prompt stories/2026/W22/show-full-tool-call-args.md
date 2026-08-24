---
session: 019e6ffb
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [show-full-tool-call-args]
proposal_excerpt: "Long tool-call argument strings (most painfully `bash.command`, but also `Agent.description`, `ask_user.title`, `read.path`, etc.) get **hard-sliced** in the collapsed `ToolCallStep` row — `String(args?.command).slice…"
---

# How we did it: show-full-tool-call-args — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

> `/skill:openspec-apply-change show-full-tool-call-args`

The real objective (clarified by the proposal): the dashboard's collapsed
`ToolCallStep` row was **hard-slicing** long tool-call argument strings — `bash.command`
was the worst offender, but `Agent.description`, `ask_user.title`, `read.path` etc. all
got chopped by `String(args?.command).slice(0, N)`. The task was to **stop truncating
the underlying strings**, expose the full value on hover (`title=`), and make the Bash
expanded renderer wrap instead of clip — all under the OpenSpec apply → verify → archive
→ land lifecycle, ending with a green CI on the PR.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` inside the worktree. If the skill files
   aren't found, point the agent at the **parent** repo's `openspec/` + `.pi/skills/`
   (worktrees git-ignore them).
2. Let the agent make the surgical edits: drop every `.slice(0, N)` from `toolSummaries`,
   add `title={getSummary(...)}` to the row `<button>` in both `ToolCallStep.tsx` and
   `CollapsedToolGroup.tsx`; swap `truncate` → `whitespace-pre-wrap break-all` in
   `BashToolRenderer.tsx` and switch its row to `items-start`.
3. Write the two new tests (`CollapsedToolGroup.test.tsx`, `BashToolRenderer.test.tsx`)
   and extend `ToolCallStep.test.tsx`. Run them isolated: `HOME=$(mktemp -d) npx vitest run …`.
4. Build + restart via `curl -X POST http://localhost:8000/api/restart`; skip the
   manual in-browser task or mark it tested-later.
5. `/skill:openspec-verify-change <change>` → confirm 12/12 tasks, 2/2 requirements, run
   the **full** suite once (`npm test | tee /tmp/pi-test.log`).
6. `commit and push` — stage ONLY your files; leave `plugin-registry.tsx` regen noise unstaged.
7. `/skill:openspec-archive-change <change>` → syncs requirements into `specs/`, moves the dir.
8. `rebase to develop` (`--force-with-lease`), then watch CI. When lint fails, fix the
   real type error and re-push (see §5/§7).

## 3. How the collaboration unfolded

**Phase A — Discovery (find the skill in a worktree).** The agent's first `find`s for
the apply-change SKILL.md failed because the `.worktrees/` checkout git-ignores
`openspec/` and `.pi/skills/`. The human steered immediately: *"use the parent openspec
directory for skills, because git ignored."* That one correction unblocked the whole
lifecycle. **Why it worked:** worktrees inherit source but not ignored tooling dirs —
always resolve OpenSpec skills from the main repo root.

**Phase B — Implement (surgical edits).** The agent removed the `.slice()` calls from all
five `toolSummaries` entries and both collapsed renderers, added `title=` for hover, and
converted the Bash command span to wrap. It touched exactly the files in scope — no
adjacent refactors. **Why it worked:** the proposal named the precise offenders, so edits
mapped 1:1 to requirements.

**Phase C — Test (isolated vitest).** Two new test files + one extension, run with
`HOME=$(mktemp -d)` to avoid polluting the real home. 21 tests green, then the full suite:
6448 passed / 18 skipped / 0 failed. The manual in-browser verification task was
consciously skipped ("I'll skip the live in-browser check but do the build/restart").

**Phase D — Verify & land.** `openspec-verify-change` produced a completeness/correctness/
coherence report (12/12 tasks, 2/2 requirements, 6/6 scenarios). Then commit+push,
archive (2 requirements synced into `chat-view/spec.md`, no design.md — accepted by
`archive -y`), rebase onto develop, force-push.

**Phase E — CI red → fix.** CI's `npm run lint` (= `tsc --noEmit`) caught a too-loose
`as ChatMessage` cast in the new test that local `npm test` (jiti/tsx, permissive) had
let through. The agent found the root cause, dropped the cast, supplied `content: ""` +
`timestamp: 0`, verified with `npm ci` + `npm run lint`, and pushed the fix.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change show-full-tool-call-args`. Effective
  because a well-formed proposal already existed; the skill invocation carried all the
  context. *Stronger version:* prepend the worktree caveat — "apply this change; resolve
  OpenSpec skills from the parent repo root since the worktree ignores them."
- **`use the parent openspec directory for skills, because git ignored`** — the highest-
  leverage turn. Nine words that redirected a failing `find` loop into the real workflow.
- **`commit and push`** / **`rebase to develop`** — terse lifecycle drivers that worked
  because the agent already knew the surgical-changes rule (stage only in-scope files).
- **`Ci failed <url>`** — handing the agent the exact failing job URL let it jump straight
  to root cause instead of guessing.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| `find /` for skill files that a worktree git-ignores | "use the parent openspec directory for skills, because git ignored" | Resolving OpenSpec skills from the main repo root whenever cwd is under `.worktrees/` |
| Treat local `npm test` (jiti/tsx) green as CI-safe | Pasting the failing CI job URL | Running `npm run lint` (= `tsc --noEmit`) locally before push — it's stricter than the test runner |
| Risk staging generated `plugin-registry.tsx` regen | (agent self-corrected) leave it unstaged | Never staging build-regenerated files; they're not part of the change |
| Consider design.md mandatory | Proceeding with `archive -y` | Knowing small spec-driven changes can skip design.md; archive validates and accepts |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode the existing OpenSpec
lifecycle skills (`openspec-apply-change`, `openspec-verify-change`,
`openspec-archive-change`). Two durable lessons are worth persisting as memory:

- **Worktree skill resolution:** in a git worktree, `openspec/` and `.pi/skills/` are
  ignored — always resolve them from the main repo root. (This recurs across every
  worktree-based change; a saved memory removes the discovery loop.)
- **Lint vs test strictness gap:** local `npm test` uses jiti/tsx (permissive); CI's
  `npm run lint` runs `tsc --noEmit` (strict). Run lint locally before pushing test-only
  changes that add type casts.

## 7. Pitfalls & dead ends

- **`find / -path "*openspec*" ... | grep skill`** returned nothing useful — the skills
  live in the parent repo, not the worktree. If a skill "isn't found" under `.worktrees/`,
  look one level up, don't widen the `find`.
- **`curl -X POST http://localhost:8000/api/restart`** failed once (server not up on first
  try) then succeeded — retry the restart, don't assume the edit broke.
- **`as ChatMessage` cast passed `npm test` but failed CI lint.** The `ChatMessage`
  interface requires `content: string` + `timestamp: number`; TS rejected the cast because
  the fake object didn't overlap enough. Fix: drop the cast, set `content: ""` and
  `timestamp: 0` explicitly. Verify with `npm ci && npm run lint`.
- **Post-rebase local errors about missing `shared/error-patterns.js`** were unrelated
  build noise from the replayed commits, not the fix — a fresh install cleared them.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change dir (proposal + tasks), the running
dashboard on `:8000`, write access to the worktree branch.

- [ ] Resolve OpenSpec skills from the **parent** repo root (worktree ignores them).
- [ ] Apply: drop `.slice(0, N)` from all `toolSummaries`; add `title={getSummary(...)}`
      to the row `<button>` in `ToolCallStep.tsx` + `CollapsedToolGroup.tsx`.
- [ ] Bash renderer: `truncate` → `whitespace-pre-wrap break-all`; row → `items-start`.
- [ ] Add/extend tests; run isolated `HOME=$(mktemp -d) npx vitest run …`.
- [ ] `curl -X POST http://localhost:8000/api/restart`; skip/mark manual in-browser task.
- [ ] Verify change; run full `npm test | tee /tmp/pi-test.log` once.
- [ ] `npm run lint` locally BEFORE push (stricter than the test runner).
- [ ] Commit staging ONLY in-scope files (skip `plugin-registry.tsx` regen).
- [ ] Archive → rebase develop (`--force-with-lease`) → watch CI → fix + re-push if red.

**Final artifacts:**
- `packages/client/src/components/ToolCallStep.tsx` (edited)
- `packages/client/src/components/CollapsedToolGroup.tsx` (edited)
- `packages/client/src/components/tool-renderers/BashToolRenderer.tsx` (edited)
- `packages/client/src/components/__tests__/ToolCallStep.test.tsx` (edited)
- `packages/client/src/components/__tests__/CollapsedToolGroup.test.tsx` (new)
- `packages/client/src/components/tool-renderers/__tests__/BashToolRenderer.test.tsx` (new)
- 2 requirements synced into `openspec/specs/chat-view/spec.md`; change archived to
  `openspec/changes/archive/2026-05-29-show-full-tool-call-args/`.

---

_Generated from session `019e6ffb-7618-7fb6-8cb4-47ee4297637c` · `pi-agent-dashboard` · 2026-05-29. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.XXXXXX.7AKsYbfqdD`._
