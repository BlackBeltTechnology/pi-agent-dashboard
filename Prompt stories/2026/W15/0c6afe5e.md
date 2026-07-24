---
session: 0c6afe5e
week: 2026/W15
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: The subagent that silently killed the parent bridge — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator hit a nasty dashboard bug and opened with a one-liner plus a screenshot:

> "After Agent tool_call the agent run does not ended."

The real objective, once the single steering turn landed: **find out why a pi session
gets permanently stuck at "streaming" in the dashboard after it spawns a foreground
subagent (the `Agent` tool), and fix it at the root.** The session never returns to
`idle` because the terminal events (`tool_execution_end`, `agent_end`) are being
dropped — the task was to trace *where* they vanish and repair the event pipeline.

## 2. TL;DR playbook

1. **State the symptom precisely:** "session stuck at streaming after Agent tool_call,
   never returns to idle." That framing points straight at the terminal-event pipeline.
2. **Steer off the obvious tool early:** ban the `Agent`/subagent tool for the
   investigation itself — the bug *is* in subagent handling, so spawning one would
   corrupt your own debugging session.
3. **Trace the event path end-to-end:** grep the status extraction and event-wiring
   (`src/server/event-status-extraction.ts`, `event-wiring.ts`), then the bridge
   forwarders (`src/extension/bridge.ts`, `connection.ts`).
4. **Rule out the red herrings:** WebSocket heartbeat/keepalive, max payload size,
   nested-agent depth counters — grep each, confirm none is the cause, move on.
5. **Follow the shared state:** search the bridge for `isActive`, `generation`, and the
   `process[BRIDGE_KEY]` global. The generation counter is the smoking gun.
6. **Read the upstream subagent runner:** confirm `@tintinweb/pi-subagents` builds a new
   `AgentSession` that re-loads extensions (including the bridge) in the *same process*.
7. **Add a re-entry guard:** store the owning `pi` instance in the shared bridge state;
   when `initBridge()` is called from a *different* `pi` (a subagent), skip init entirely.
8. **Verify the reload path stays correct:** `/reload` calls `initBridge(pi)` with the
   same instance, so `prev.pi === pi` and the normal cleanup+reinit still runs.
9. **Reload the extension** (`npm run reload`) and **document the root cause** in
   `docs/architecture.md`.

## 3. How the collaboration unfolded

**Phase 1 — Frame & fence (2 prompts).** The operator gave the symptom + screenshot,
then immediately steered: *"Don't use agent tools."* That one correction shaped the
whole session — the AI investigated by reading files directly instead of delegating.

**Phase 2 — Trace the pipeline.** The AI walked the event path from the server inward:
status extraction → event wiring → client status handling → bridge forwarders. It
grepped for `tool_call`/`tool_result`/`agent_end` across server and extension to map how
a session's status is computed and where the terminal events should arrive.

**Phase 3 — Eliminate the plausible causes.** Rather than guess, it methodically
knocked out candidates: heartbeat/keepalive timeouts, WebSocket `maxPayload` limits,
nested-agent depth tracking. Each got a targeted grep and a "not it" — narrowing the
search space instead of thrashing.

**Phase 4 — Follow the shared state to the bug.** The AI zeroed in on the bridge's
`process`-level global state (`process.__pi_dashboard_bridge__`) and its `generation`
counter behind `isActive()`. It then read *upstream* into `@tintinweb/pi-subagents`
(many greps through `node_modules`) to confirm the subagent spins up a fresh
`AgentSession` that re-runs `initBridge()` in the same process — bumping the generation
and killing the parent's `isActive()`.

**Phase 5 — Fix, verify, document.** A minimal re-entry guard in `bridge.ts`: tag the
shared state with its owning `pi`, and bail out of `initBridge()` when the caller is a
different `pi`. The AI reasoned through the `/reload` case (same `pi` → guard passes),
reloaded the extension, and updated `docs/architecture.md`. Total: ~18 minutes, 3 edits.

## 4. Prompts that worked

- **The goal prompt** — "After Agent tool_call the agent run does not ended" + a
  screenshot. Terse but *precise about the trigger and the observable*: a specific tool
  call, a specific failure to transition state. A stronger version bakes in the direction
  the operator already suspected: *"After the Agent tool runs a subagent, the session
  stays 'streaming' forever and never returns to idle — trace where the terminal events
  (agent_end / tool_execution_end) are lost and fix the root cause."*
- **The high-leverage follow-up** — *"Don't use agent tools."* Four words that prevented
  the AI from corrupting its own debugging session with the very mechanism under
  investigation. This is the whole game: when debugging feature X, forbid the AI from
  *using* feature X.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for the `Agent`/subagent tool to parallelize the investigation | "Don't use agent tools." | State up front: *"This bug is in subagent handling — do NOT spawn subagents while debugging it."* |
| Risk chasing plausible-but-wrong causes (heartbeat, payload size, depth counters) | (self-corrected via grep) — but the operator's tight symptom framing kept it honest | Give the exact observable + trigger so the AI can eliminate candidates instead of guessing |

The single correction here is the load-bearing one: **never debug a mechanism using that
same mechanism.** When the failure is in subagent lifecycle, WebSocket reconnect, or the
extension reload path, forbid the AI from exercising that path during the hunt.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session — but the fix encodes a durable, reusable
insight that *should* be captured:

- **The pattern:** *process-global singletons + a generation counter break under nested
  `AgentSession` re-entry.* Any extension that keeps state on `process[KEY]` and
  re-initializes on load will be silently torn down when a subagent loads it in the same
  process. The general fix is an **owner-identity guard**: tag the shared state with the
  `pi` instance that owns it, and no-op initialization when the caller isn't the owner.
- **When to invoke it:** whenever you write or debug a pi extension that (a) stores state
  on `process`, and (b) runs alongside the `Agent`/subagent tool. Recommend a project
  memory: *"bridge/extension init must guard against subagent re-entry via owner `pi`
  identity; a bare generation counter is not enough."*

## 7. Pitfalls & dead ends

- **Don't spawn a subagent to investigate a subagent bug.** It re-enters the very code
  path you're studying and can bump the shared generation counter mid-session — you'd be
  debugging a moving target you yourself perturbed.
- **The TypeScript "errors" on the extension are noise.** The bridge is compiled by pi's
  runtime, not standalone; module-resolution errors in a direct `tsc` are pre-existing.
  Verify only that *your* changes introduce no new type error — don't chase the rest.
- **The bridge has no unit tests** (it's integration-heavy). Don't burn time trying to
  add one for this fix; verify by reload + observing the session returns to idle.
- **Red-herring causes to skip:** WS heartbeat/keepalive, `maxPayload`, nested-agent
  depth counters. All grepped, all ruled out — go straight to the shared-state generation
  counter and `isActive()`.

## 8. Reproduce it faster — checklist

- [ ] Frame the bug as *"session stuck at streaming after Agent tool_call; terminal
      events dropped"* + attach the screenshot.
- [ ] Forbid the `Agent`/subagent tool for the duration of the investigation.
- [ ] Trace the event path: `event-status-extraction.ts` → `event-wiring.ts` → client
      status → `bridge.ts` / `connection.ts`.
- [ ] Grep the bridge for `isActive`, `generation`, `process[...bridge...]`.
- [ ] Read `@tintinweb/pi-subagents` to confirm it builds a fresh `AgentSession` that
      re-runs extension init in-process.
- [ ] Add the owner-identity re-entry guard to `initBridge()`; store `prev.pi = pi`.
- [ ] Confirm `/reload` still works (`prev.pi === pi`).
- [ ] `npm run reload`; verify a subagent-spawning session returns to `idle`.
- [ ] Update `docs/architecture.md` with the root cause.

**Key inputs:** none beyond repo access. **Artifacts produced:**
`src/extension/bridge.ts` (re-entry guard), `docs/architecture.md` (root-cause note).

---

_Generated from session `0c6afe5e-2bcf-42e3-9981-42c00d7a749e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-07. Source extract: `/tmp/facts-58854-31146.md`._
