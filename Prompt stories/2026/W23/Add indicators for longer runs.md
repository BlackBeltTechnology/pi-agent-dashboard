---
session: 019e9ea0
week: 2026/W23
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-async-action-feedback, add-extension-ui-a11y-baseline]
proposal_excerpt: "Most user-triggered actions in the dashboard give no feedback during the gap between the click and the effect. The action fires a `fetch()`, the HTTP call returns (often just an \"accepted\" ack), and the real result la…"
---

# How we did it: Add indicators for longer runs — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator entered **explore mode** (`openspec-explore`) with a fuzzy but real
complaint: dashboard actions feel unresponsive — "seconds later the thing happens"
with nothing shown in between. The opening prompt was the skill's explore-mode stance
("Enter explore mode. Think deeply. Visualize freely."), not a crisp feature request.
The *real* objective, once the exploration clarified it: **design a single reusable
feedback primitive so every user-triggered action shows immediate pending state AND
confirms the actual (often delayed, WebSocket-delivered) effect** — then capture that
thinking as a committed OpenSpec proposal, without writing any implementation.

## 2. TL;DR playbook

1. Kick off in explore mode: `openspec-explore` — a thinking stance, no code allowed.
2. **Ground before theorizing.** Map where user actions trigger API calls and how
   feedback is handled today (`ctx_batch_execute` greps for loading/disabled hits, toast
   usage, handler shapes).
3. Find the **existing extremes in the same repo**: a gold-standard pattern
   (`WorktreeInitButton` phase FSM) vs. bare fire-and-forget handlers (`TunnelButton`).
4. Let the human pick a direction (`ask_user`) — here: **hybrid inline-pending + toast**.
5. Verify the delayed half is *real*: inspect `useWebSocket` pub/sub, `useToast`, and the
   `spawn-correlation-token` request-id echo already in the protocol.
6. Synthesize one primitive (`useAsyncAction`) that composes four patterns **already
   proven in the repo** — don't invent from zero.
7. Match the existing proposal structure, then `write` proposal.md, tasks.md, spec.md.
8. `openspec validate <change>` → clean.
9. On "commit proposal": stage **only** the proposal files, unstage unrelated changes,
   commit with a `docs(openspec):` message.

## 3. How the collaboration unfolded

**Phase A — Discovery / grounding.** The AI opened with "Let me ground this in the
actual codebase before we theorize" and ran batched greps: where actions live
(`packages/`), how many loading/disabled hits exist (~511), whether a toast system
already exists (`Toast.tsx`). *Why it worked:* it refused to design in the abstract and
anchored every later claim to a concrete file.

**Phase B — Framing the shape.** It drew the **doubly-async** picture: click → HTTP ack
(latency #1) → real work via spawn/IPC → WebSocket event (latency #2). The keystone
insight: **HTTP 200 means "accepted," not "done."** This reframed the whole problem.

**Phase C — Finding the two worlds.** It surfaced that the repo *already contains both
extremes*: `WorktreeInitButton` (phase FSM, disabled-while-running, live tail, failure
card) as the gold standard, and `TunnelButton.handleConnect` (`await fetch(); catch {}`)
as the bare case. *Decision point:* the human chose the **hybrid + toast** combo.

**Phase D — Proving the delayed half is real.** It inspected `useWebSocket` (already
pub/sub via `handlersRef`), `useToast` (exists, but red-only — needs a `variant`), and
the protocol's `spawn_session {requestId}` → `session_added {spawnRequestId}` echo.
*Why it worked:* the "effect-confirmed" half became feasible because the
correlation-token mechanism **already existed** — the design generalizes it, not builds it.

**Phase E — Synthesis + capture.** All four pillars (inline pending, toast-on-done, WS
pub/sub, effect correlation) map to existing code. It matched the sibling proposal's
structure, wrote the three artifacts, and `openspec validate` passed clean.

**Phase F — Scoped commit.** On "commit proposal" it noticed unrelated staged changes,
`git reset -q`, re-added only the proposal dir, and committed just those three files.

## 4. Prompts that worked

- **The goal prompt** (explore-mode stance): effective because it *licensed deep
  investigation without implementation pressure* — the AI grounded, drew diagrams, and
  proposed directions instead of jumping to code. A stronger explicit kickoff for a
  future operator: *"Explore how our dashboard signals progress for slow, async actions;
  find where it's done well vs. not, and propose one reusable primitive — capture as an
  OpenSpec proposal, don't implement."*
- **High-leverage follow-up: "commit proposal"** — two words that closed the loop. It
  worked because the artifacts were already written and validated; the AI only had to
  scope the commit correctly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to theorize a solution | (self-corrected) "ground this in the actual codebase first" | State "ground before you design" in the kickoff |
| Offer multiple directions | Human picked **hybrid inline-pending + toast** via `ask_user` | Name the preferred UX up front if you already know it |
| Stage everything on commit | "commit **proposal**" (scoped) — AI unstaged `mockups/`, `unify-dialog-system/` | Say "commit only the proposal files" explicitly |

The session was *lightly* steered (only 2 user prompts) because the AI's
ground-first discipline pre-empted most corrections. The one real guardrail: **scoped
commits** — the working tree had unrelated changes, and the AI correctly isolated the
three proposal files rather than committing the lot.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session. The reusable asset is the **committed
OpenSpec proposal** (`add-async-action-feedback`) itself, which captures the
`useAsyncAction` design.

**Recommended skill to create** if this recurs: a *"design-from-existing-patterns"*
explore playbook — before proposing any new primitive, grep the repo for the gold
standard and the bare case of the same concern, then frame the design as *generalizing
proven code* rather than inventing. That framing is what made this proposal credible.

## 7. Pitfalls & dead ends

- **`ctx_batch_execute` had 1 error** — batched grep tooling can partially fail; re-run
  the specific query rather than trusting a partial batch.
- **Unrelated working-tree changes at commit time** — the repo had staged/modified
  `mockups/` and `unify-dialog-system/` files. If you hit this, `git reset -q` then
  `git add <proposal-dir>` before committing so the proposal commit stays clean.
- **`useToast` is red-only** — success feedback needs a new `variant` field; don't assume
  the toast system already renders green "done" states.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore` (thinking only, no implementation).
- [ ] Grep for the concern's **gold standard** and **bare case** in the repo.
- [ ] Draw the async/latency shape; identify where feedback is missing.
- [ ] `ask_user` for the UX direction (here: hybrid inline-pending + toast).
- [ ] Verify the delayed half against real mechanisms (`useWebSocket`, `useToast`,
      correlation tokens).
- [ ] Match the sibling proposal structure; `write` proposal.md, tasks.md, spec.md.
- [ ] `openspec validate <change>` → clean.
- [ ] Scoped commit: unstage unrelated changes, add only the proposal dir,
      `docs(openspec):` message.

**Key inputs:** a running OpenSpec setup (`openspec change new`, `openspec validate`);
read access to `packages/` client code.
**Artifacts produced:**
`openspec/changes/add-async-action-feedback/{proposal.md,tasks.md,specs/async-action-feedback/spec.md}`
committed as `7d2329ab docs(openspec): add async-action-feedback proposal`.

---

_Generated from session `019e9ea0` · `pi-agent-dashboard` · 2026-06-06. Source extract: session facts sheet._
