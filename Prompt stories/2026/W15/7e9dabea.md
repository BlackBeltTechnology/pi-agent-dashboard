---
session: 7e9dabea
week: 2026/W15
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
---

# How we did it: Testing & fixing LLM-triggered Agent card rendering — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with *"I would like to tests LLM model triggered Agent calls. Very simple agent calls to test"* and immediately narrowed it: *"I'm in dashboard. I would like to tests the Agent card rendering. First create one subagent with some dummy task to test the card appears."* The real objective, clarified through steering, was two-fold: (1) prove that when an LLM fires the `Agent` tool the dashboard renders a proper **Agent card** (name, status, duration), and (2) fix the bug the manual test surfaced — a card that stayed **stuck on "running"** even after the subagent completed. Testing was the entry point; the payoff was a real event-reducer fix backed by regression tests.

## 2. TL;DR playbook

1. **Map the event model first.** Grep `src/client/lib/event-reducer.ts` + `src/shared/types.ts` for `tool_execution_start/update/end` and `subagent_created/started/completed/failed` to learn the Agent-tool lifecycle before writing anything.
2. **Write the unit tests against the reducer**, not the UI: add `Agent tool calls` and `subagent lifecycle events` describe-blocks to `src/client/lib/__tests__/event-reducer.test.ts`. Run `npx vitest run <file>`.
3. **Drive a real Agent call through the running dashboard** to reproduce the visual bug: `POST /api/session/<id>/prompt` with a body telling the session to launch an `Explore` subagent.
4. **When the card sticks on "running", inspect the actual pi event shape** — dig into the pi core package (`.../pi-agent-core/dist/agent-loop.js`) to confirm `tool_execution_end` carries `{type,toolCallId,toolName,result,isError}` and **no `details`**.
5. **Write a failing test that encodes the live path** (update with `status:"running"` → end without `details`), watch it fail, then fix the reducer: on `tool_execution_end` with no `data.details`, merge `status:"completed"|"error"` into the existing `toolDetails`.
6. **Rebuild + restart** (`npm run build` → `POST /api/restart`) and re-trigger a live Agent call to confirm the card goes green.
7. **Cover the replay path too:** add a `state-replay.test.ts` case + an end-to-end `replay entries → event-reducer → Agent card state` test.
8. **Verify visually in the browser** by clicking the session and confirming the Agent cards show completed + duration; run the full suite (`98 tests pass`).

## 3. How the collaboration unfolded

**Phase 1 — Discovery (grep the event model).** The AI read `event-reducer.ts`, `types.ts`, and existing tests to learn that the dashboard handles both the `Agent` **tool** lifecycle (`tool_execution_start/update/end`) and separate `subagent_*` events, with **no existing tests** for either. Effective because it grounded the test-writing in the real reducer contract instead of guessing.

**Phase 2 — Write reducer tests.** Added 5 `Agent tool calls` tests + 7 `subagent lifecycle` tests; `81 tests pass`. This established the safety net before any behavior change.

**Phase 3 — Live reproduction.** The AI used the dashboard REST API (`GET /api/sessions`, then `POST /api/session/<id>/prompt`) to make a real idle session launch an `Explore` subagent, then read the raw session JSONL to confirm the subagent actually completed (6.2s, 26k tokens). Decision point: the human said **"It shows it running"** — the card was stuck.

**Phase 4 — Root-cause the stuck card.** The AI traced the renderer (`details.status` from `toolDetails`) backward to the source event and cracked open the **pi core** package to prove `tool_execution_end` emits no `details`. So `toolDetails` kept the last `status:"running"` from `tool_execution_update`. This "read the upstream SDK's real emit shape" move was the whole ballgame.

**Phase 5 — TDD the fix.** Wrote a failing test for the live path, confirmed red, then patched `event-reducer.ts` to backfill completion status when `endDetails` is absent. `83 tests pass`. Rebuilt, restarted, re-triggered — card went green.

**Phase 6 — Replay investigation ("In the replay the executed Agents haven't shown").** The AI added `state-replay.test.ts` coverage + an end-to-end replay→reduce test (`15 tests`, then `98` total), and verified in the browser that replayed sessions (`agent-tool-card`) **do** render Agent cards with duration. It reported the replay path was already correct and asked the user to point at a specific failing case rather than inventing a second fix.

## 4. Prompts that worked

- **Goal prompt (strong once narrowed):** *"I'm in dashboard. I would like to test the Agent card rendering. First create one subagent with some dummy task to test the card appears."* — Effective because it names the surface (Agent card), the mechanism (a real subagent), and a concrete first step. A better one-shot version: *"Trigger a real Agent tool call in a live dashboard session and confirm the card renders name + status + duration; add reducer tests for the Agent/subagent event lifecycle."*
- **High-leverage correction:** *"It shows it running"* — three words that redirected the whole session from "write tests" to "find and fix a real state bug." The single most valuable turn.
- **Scope-locating follow-up:** *"Nope. In this session?"* — forced the AI to test in the *current* live session rather than a separate one, exposing the live-vs-replay distinction.
- **Weak → stronger:** *"okay. retest"* and *"In the replay the executed Agents haven't shown"* were terse. Stronger: name the session id, the expected vs actual card state, and whether it's a live or replayed (reloaded-from-disk) view — that ambiguity cost a full phase.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Declare success from passing unit tests without a live check | "It shows it running" | Always drive a real Agent call through `/api/session/<id>/prompt` and eyeball the card before claiming done |
| Test in a *different* session than the user was watching | "Nope. In this session?" | Ask which session id is on screen; trigger the Agent call in *that* one |
| Treat live and replay paths as one | "In the replay the executed Agents haven't shown" | Separate the two: live events (no `details` on end) vs replayed events (JSONL `toolResult` *has* `details`) and test each |
| Assume the SDK event carries all fields | (implicit) card stuck running | Read the upstream `pi-agent-core` emit shape rather than trusting the field is present |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were persisted this session. Three `Explore` subagents were spawned (File listing, File listing test, Component listing) purely as **dummy payloads** to generate real Agent-tool events — a neat trick: use a cheap read-only subagent as a live test fixture for tool-card rendering.

**Recommended memory to save:** *"pi core `tool_execution_end` emits only `{type,toolCallId,toolName,result,isError}` — no `details`. The event reducer must backfill `toolDetails.status` to completed/error on end, because `tool_execution_update` leaves it 'running'. Replayed sessions differ: the JSONL `toolResult` entry *does* carry `details`."* This one fact was the root cause and will recur for any tool-card status work.

## 7. Pitfalls & dead ends

- **In-memory events get evicted.** `GET /api/events?sessionId=...` returned nothing because live events had aged out of the in-memory store. Fallback: read the session JSONL on disk directly (`tail | jq`).
- **Wrong jq shape.** `curl .../api/events | jq 'type'` and `.data[]` filters failed until the actual response shape was checked (`/api/events/<id>/0` returns `{events:[...]}`). If a jq filter errors, dump raw with `head -200` first.
- **Chasing a phantom second bug.** The "replay doesn't show Agents" complaint led to a full investigation that concluded the replay path already worked (verified in-browser + by tests). Don't invent a fix for an unreproduced symptom — verify the claim first, then ask the user to point at the exact failing session.
- **Passing tests ≠ working UI.** 81 green tests coexisted with a visibly stuck card. Unit coverage of the reducer didn't exercise the real live-event shape until a test was written to mirror it.

## 8. Reproduce it faster — checklist

- [ ] Grep `event-reducer.ts` for `tool_execution_*` + `subagent_*`; note that `end` may lack `details`.
- [ ] Add reducer tests for the Agent tool + subagent lifecycle (`event-reducer.test.ts`).
- [ ] Find an idle session (`GET /api/sessions`), then `POST /api/session/<id>/prompt` telling it to launch an `Explore` subagent with a trivial task.
- [ ] Watch the live card; if stuck "running", confirm pi core's `tool_execution_end` shape in `pi-agent-core/dist/agent-loop.js`.
- [ ] Write a failing live-path test (update running → end without details), fix the reducer to backfill status, confirm green.
- [ ] `npm run build && curl -X POST http://localhost:8000/api/restart`; re-trigger and verify the card goes completed.
- [ ] Add `state-replay.test.ts` + end-to-end replay→reduce coverage; run the full suite.

**Key inputs:** a running dashboard on `localhost:8000`, an idle session id, the pi core package path for the SDK emit shape.
**Artifacts produced:** `src/client/lib/event-reducer.ts` (fix), `src/client/lib/__tests__/event-reducer.test.ts`, `src/extension/__tests__/state-replay.test.ts` (regression tests).

---

_Generated from session `7e9dabea-3324-4728-8b1f-741cf28b8e68` · `pi-agent-dashboard` · 2026-04-07. Source extract: mktemp facts sheet._
