---
session: 019e6615
week: 2026/W22
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-worktree-lifecycle-actions, add-worktree-spawn-dialog]
proposal_excerpt: "add-worktree-spawn-dialog shipped worktree creation but explicitly deferred removal, merge, PR creation, and the cwd-loss handling those operations require. Users now have a one-click way to make worktrees but no…"
---

# How we did it: From "worktree card looks wrong" to a full lifecycle proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a **visible bug report**, not a feature request:

> "The test is a worktree item, but its not showing worktree items under parent directory [image]"

The screenshot showed a session that lived in a git worktree but wasn't getting any
visual worktree indication on its dashboard card. The *real* objective emerged over four
prompts: (1) make the worktree pill actually render on the card, (2) show *which*
worktree the session belongs to, and then (3) the big one — figure out what lifecycle
operations a worktree needs (merge / PR / close) and what should happen to a session
that **loses its cwd** when the worktree is removed. The session ended split: a small
UI fix landed as code, and the two design-heavy questions became a fresh OpenSpec change
(`add-worktree-lifecycle-actions`).

## 2. TL;DR playbook

1. **Reproduce against live data first.** Before touching code, run the grouping/render
   logic against the actual session objects (`ctx_execute`) to prove where the bug is —
   server-side data vs. client render.
2. **Locate the render gate.** `grep` for the prop that decides whether the component
   renders (`showGitInfo`), and trace *why* it's false for the failing case.
3. **Fix the escape hatch, not the symptom.** Force-render `GitInfo` when
   `session.gitWorktree` is set, independent of the group-size heuristic.
4. **Pin the bug with an inverse pair of tests.** One test proves the pill now renders in
   a multi-session group; one proves a plain checkout still stays collapsed (guards
   against over-rendering).
5. **When the user asks "show which worktree," pick the compact option and offer the
   alternative.** Pill text `worktree · <name>` beats a second line; update the assertion
   test in the same edit.
6. **Split UI tweaks from design decisions.** When a follow-up spans "small tweak +
   two architectural questions," do the tweak now and route the rest to a proposal —
   don't bolt lifecycle logic onto the card ad-hoc.
7. **Scaffold the OpenSpec change properly.** `openspec change new <name>`, then author
   `proposal.md`, `design.md`, `tasks.md`, and one `spec.md` per capability delta.
8. **Validate `--strict` before declaring done.**

## 3. How the collaboration unfolded

**Phase 1 — Diagnose from live data (not from reading code).** The AI first ran the
actual `resolveSessionGroupPath` logic against the live "test" session and proved the
**server-side grouping was correct** (`gitWorktree.mainPath` present, precedence resolves
to the parent path). Its first hypothesis was a stale browser / missed `session_updated`
broadcast — a reasonable but *wrong* guess. **Why this phase was still valuable:** it
eliminated the entire server/data layer in one `ctx_execute`, narrowing the search to the
client render path.

**Phase 2 — Find the real render gate.** Prompted by the user ("no visual indication on
card about worktree"), the AI `grep`'d `showGitInfo` and found the root cause:
`SessionList.tsx:777` sets `showGitInfo = group.sessions.length === 1`. In any group with
>1 session, `WorkspaceSubcard` skips `<GitInfo>` — and `<WorktreePill>` lives *inside*
`<GitInfo>`. So worktree sessions in a populated parent group get no pill. The fix:
force-render `GitInfo` when `session.gitWorktree` is set. **Decision point:** the user's
"yes" unlocked adding regression tests.

**Phase 3 — Pin it with tests.** Added 2 tests to `WorktreePill.test.tsx` — the
multi-session-group worktree case (renders) and its inverse (plain checkout stays
collapsed). 11/11 pass.

**Phase 4 — Compact the pill.** On the "show the directory too" prompt, the AI proposed
two presentations and recommended the single-line `worktree · <name>`, applied it, and
fixed the assertion test that hard-coded `textContent === "worktree"`. 12/12 pass.

**Phase 5 — Route the hard questions to a proposal.** The same prompt also asked about
merge/PR/close and cwd-loss. The AI correctly recognized these were **deferred by the
original `add-worktree-spawn-dialog` proposal** ("Out of scope: Worktree removal /
cleanup UI") and drafted a new change: `proposal.md`, `design.md` (10 decisions D1–D10),
`tasks.md` (12 phases, ~80 tasks), and four capability specs. Validated `--strict` clean.

## 4. Prompts that worked

- **Goal prompt (with a screenshot):** "The test is a worktree item, but its not showing
  worktree items under parent directory [image]." The **image was the leverage** — it
  gave the AI a concrete visual to reason against. *Stronger version:* add "the pill
  renders for solo sessions but not when the parent group has other sessions" to point
  straight at the group-size gate.
- **High-leverage steering:** "The group seems fine, but no visual indication on card" —
  one sentence that redirected the AI away from its stale-browser hypothesis toward the
  render path. Naming *what's fine* is as useful as naming what's broken.
- **"yes"** — a one-word unlock that authorized the regression tests.
- **The multi-part follow-up:** "Show the directory too… What steps can be made in a
  worktree? merge? PR? to be able to close. What happens with session which lose the
  cwd?" This correctly *bundled* a UI tweak with two design questions and let the AI
  triage them into code-now vs. proposal.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Blame stale browser state / a missed broadcast (data-layer guess) | "The group seems fine, but no visual indication on card" — pointing at the render, not the data | State up front whether the *data* or the *rendered card* is wrong when reporting a UI bug |
| Fix only the immediate pill render | "yes" to the AI's own offer to add regression tests | Ask for the inverse test (no over-render) as part of any conditional-render fix |
| Risk bolting lifecycle logic onto the card ad-hoc | Asking merge/PR/close as open questions, letting the AI route them | Explicitly say "design decisions go to a proposal, not inline code" for scope-expanding asks |

## 6. Skills, tools & memory created — and why they're effective

**No skill or memory was created this session.** The workflow is nonetheless repeatable
and worth a skill: *"diagnose a conditional-render bug by running the component's gating
logic against live session data before reading component source, then pin with an
inverse test pair."* The reusable insight — **prove the data layer is correct with
`ctx_execute` before hunting client render bugs** — removes the most common wasted loop
(reading server code to chase a client-only symptom).

The genuinely effective *tool move* was `ctx_execute` running `resolveSessionGroupPath`
against real session objects: it turned a "why doesn't it show" question into a
one-command proof that the bug was strictly client-side.

## 7. Pitfalls & dead ends

- **First hypothesis was wrong (stale browser).** If a worktree card renders correctly
  for solo sessions but not in a populated group, don't chase broadcast/HMR — grep the
  `showGitInfo`-style render gate; it's almost certainly a `group.sessions.length === 1`
  heuristic hiding the component.
- **`curl …/api/health` failed** (server not up on :8000 during the session). Don't block
  on the live server for a client-render diagnosis — `ctx_execute` against session data
  is enough.
- **Changing pill text breaks a hard-coded assertion.** The test asserted
  `pill.textContent === "worktree"`; the `worktree · <name>` change required updating that
  same test in the same edit. Grep tests for the literal string before changing UI copy.
- **Don't extend a shipped proposal that deferred the work.** `add-worktree-spawn-dialog`
  explicitly listed worktree removal as out-of-scope — the lifecycle work correctly became
  a *new* change rather than an amendment.

## 8. Reproduce it faster — checklist

- [ ] Reproduce the render gate against live data: `ctx_execute` the grouping/gating
      function on real session objects to confirm the bug is client-side.
- [ ] `grep` the render-gate prop (e.g. `showGitInfo`) and trace why it's false for the
      failing case.
- [ ] Force-render the component when the relevant field (`session.gitWorktree`) is set,
      bypassing the group-size heuristic.
- [ ] Add an **inverse test pair** (renders when it should + stays collapsed when it
      shouldn't). Grep tests for any hard-coded copy you're about to change.
- [ ] For scope-expanding follow-ups, split: land the small UI tweak, route design
      questions to `openspec change new <name>`.
- [ ] Author `proposal.md` / `design.md` / `tasks.md` / per-capability `spec.md`, then
      `openspec validate --strict`.

**Key inputs:** a running dashboard *or* live session JSONL data, the client component
tree (`SessionCard.tsx`, `SessionList.tsx`), and the prior `add-worktree-spawn-dialog`
proposal for scope boundaries.

**Artifacts produced:**
- `packages/client/src/components/SessionCard.tsx` — force-render `GitInfo` for worktree
  sessions; pill renders `worktree · <name>`.
- `packages/client/src/components/__tests__/WorktreePill.test.tsx` — 12/12 (regression
  pair + empty-name fallback).
- `openspec/changes/add-worktree-lifecycle-actions/` — `proposal.md`, `design.md`,
  `tasks.md`, and specs for `worktree-lifecycle`, `git-context`, `session-card-subcards`,
  `git-operations-api` (validates `--strict`).

---

_Generated from session `019e6615` · `pi-agent-dashboard` · 2026-05-26. Source extract: deterministic facts sheet (add-worktree-lifecycle-actions)._
