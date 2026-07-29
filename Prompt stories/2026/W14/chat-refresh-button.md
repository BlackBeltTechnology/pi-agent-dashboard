---
session: cbf91a8f
week: 2026/W14
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [chat-refresh-button, accordion-workspace-folders]
proposal_excerpt: "Sometimes the chat view gets out of sync or the user simply wants a clean re-fetch of all session events. Currently the only option is a full page reload, which loses all client state (selected session, scroll positio…"
---

# How we did it: Chat Refresh Button — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a one-liner via a skill invocation:

```
/skill:openspec-explore
Add refresh button to chat window. Sometimes easier to refresh the chat events.
```

The *real* objective, once explored: give the dashboard a per-session **refresh** control
that re-fetches all events for the currently viewed session **without a full page reload**
(which would lose selected session, scroll position, and other client state). Mechanically
this is "clear local session state → re-subscribe with `lastSeq: 0`" — the server already
replays the full event batch on a fresh subscribe. The feature had to land on both the
desktop **SessionHeader** and the **mobile action menu**, with a spin/loading indicator.

## 2. TL;DR playbook

1. Kick off in explore mode: `/skill:openspec-explore` + a one-line feature ask. Let the AI
   ground itself in the real data flow (`subscribe` → `event_replay`) before proposing.
2. Pick a placement option the AI offers ("Option A" — the header bar), then say
   **"Create a change proposal"** to lock scope into an OpenSpec change.
3. Fast-forward the remaining artifacts in one shot: `/opsx:ff chat-refresh-button`
   (creates design → specs → tasks together).
4. Implement: `/opsx:apply chat-refresh-button`. The AI writes the failing test first (TDD),
   then wires `onRefresh` through SessionHeader → App.tsx → MobileActionMenu.
5. Verify the scoped test, then the full suite:
   `npx vitest run src/client/components/__tests__/SessionHeaderRefresh.test.tsx` → `npx vitest run`.
6. Ship: `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`
   (client change = build + restart + reload all sessions).
7. Archive: `/opsx:archive chat-refresh-button` — syncs the delta spec into
   `openspec/specs/chat-refresh/spec.md` and moves the change under `archive/`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI grepped `App.tsx` and
`src/shared/browser-protocol.ts` for `subscribe/unsubscribe/replay/lastSeq` and reconstructed
the client↔server flow: selecting a session sends `subscribe(lastSeq:0)`, the server replays
all events. That framing made "refresh" trivially = clear state + re-subscribe. *Why it
worked:* the AI derived the implementation from the actual protocol instead of inventing a
new endpoint. **Decision point:** the AI presented placement options; the human chose the
header bar ("Option A").

**Phase 2 — Design (OpenSpec proposal).** "Create a change proposal" turned the explore into
a scoped `chat-refresh-button` change. Note the AI first tried `openspec change new
chat-refresh-button`, which **failed**, then fell back to `mkdir -p openspec/changes/...` +
`openspec instructions ... --json`. It wrote `proposal.md` scoped to *button + wiring +
loading indicator, nothing more*.

**Phase 3 — Generate artifacts.** `/opsx:ff` produced `design.md`, `specs/chat-refresh/spec.md`,
and `tasks.md` (8 tasks in 4 groups: wiring, desktop UI, mobile UI, tests) in one pass.

**Phase 4 — Implement (TDD).** `/opsx:apply` drove the tasks. The AI wrote
`SessionHeaderRefresh.test.tsx` first, confirmed it **failed** (no impl yet), then added the
`onRefresh` prop + spinning `mdiRefresh` button to `SessionHeader.tsx`, wired the handler in
`App.tsx` (extracting it so both desktop and mobile paths reuse it), and added a "Refresh Chat"
item to `MobileActionMenu.tsx`. It kept the `mobileActions` type in sync. **Decision point:**
the human said "go on" to let it run the whole task list unattended.

**Phase 5 — Verify + ship.** Scoped test → 3 passing; full `vitest run` clean; `npm run build`;
server restart via `/api/restart`; `npm run reload`. Then "build and deploy" confirmed the ship
path.

**Phase 6 — Archive.** `/opsx:archive` synced the new delta spec to
`openspec/specs/chat-refresh/spec.md` and moved the change to
`archive/2026-04-04-chat-refresh-button/`.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-explore` + *"Add refresh button to chat window."*
  Effective because pairing explore mode with a one-line ask let the AI ground in the codebase
  before committing to a design. A stronger version states the constraint up front:
  *"Add a per-session refresh that re-fetches events without a full page reload (must preserve
  selected session + scroll). Explore the subscribe/replay flow first."*
- **"Option A"** — a one-word high-leverage choice that resolved placement without a paragraph.
- **"Create a change proposal"** — converted exploration into a scoped OpenSpec change; the
  scope line ("nothing more") kept the diff tight.
- **`/opsx:ff chat-refresh-button`** — unlocked design + specs + tasks in a single move.
- **"go on"** — let the AI run the full apply task list unattended; cheap because scope was
  already fixed by the proposal.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Offer multiple placements and pause | "Option A" | Name the target surface in the goal prompt (header bar) |
| Ask "want a proposal or implement directly?" | "Create a change proposal" | State "route through OpenSpec" up front |
| Stop after each artifact/task | "go on" (x2) | Say "run the full apply loop, don't pause between tasks" |
| Reach for a non-existent CLI (`openspec change new`) | — (it self-recovered) | Prefer `mkdir -p openspec/changes/<name>` + `openspec instructions` from the start |

The steering was mostly **flow-control** ("go on", "Option A") rather than correction — a sign
the discovery phase produced a design the operator agreed with. The single real friction was
the wrong OpenSpec create command.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session. The workflow itself is the reusable asset:
**explore → proposal → ff → apply (TDD) → build+restart+reload → archive** is the canonical
client-feature loop for this repo. If anything, the value to capture is the *rebuild matrix* it
exercised — a `src/client/` change requires **build + `/api/restart` + `npm run reload`**, not
just a restart. That rule already lives in the `implement` skill; invoke it whenever a change
touches `src/client/`.

## 7. Pitfalls & dead ends

- **`openspec change new chat-refresh-button` failed.** The scaffolding command was not
  available/expected here. Fix: `mkdir -p openspec/changes/<name>` then drive with
  `openspec instructions <stage> --change <name> --json`. (The AI recovered on its own but it
  cost a round trip.)
- **Client change needs the full ship path.** A `src/client/` edit is invisible until
  `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`. A bare
  restart is not enough for production client code.
- **Keep the `mobileActions` type in sync.** Adding `onRefresh` meant updating the prop type in
  `SessionHeader.tsx` *and* passing it through `MobileHeader` → `MobileActionMenu`; missing one
  end fails the type-check silently until build.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** dashboard running locally on `:8000`; knowledge of the
`subscribe(lastSeq:0)` → `event_replay` flow; the target surfaces (`SessionHeader.tsx`,
`MobileActionMenu.tsx`, `App.tsx`).

- [ ] `/skill:openspec-explore` + one-line ask naming the surface + the "no full reload" constraint.
- [ ] Choose placement (header bar) → "Create a change proposal".
- [ ] `/opsx:ff <change>` to generate design + specs + tasks.
- [ ] `/opsx:apply <change>` — write the failing test first, then wire `onRefresh` through all
      three files.
- [ ] `npx vitest run <scoped test>` then `npx vitest run` (full suite green).
- [ ] `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`.
- [ ] `/opsx:archive <change>` (syncs delta spec, moves to `archive/`).

**Final artifacts produced:**
- `openspec/changes/archive/2026-04-04-chat-refresh-button/` (proposal, design, specs, tasks)
- `openspec/specs/chat-refresh/spec.md`
- `src/client/components/SessionHeader.tsx`, `src/client/App.tsx`,
  `src/client/components/MobileActionMenu.tsx`
- `src/client/components/__tests__/SessionHeaderRefresh.test.tsx` (3 passing tests)

---

_Generated from session `cbf91a8f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-05. Source extract: `/tmp/session_facts_72413_5799.md`._
