## Context

`session_added` is the only client message that auto-navigates the ChatWindow. Routing is URL-driven (`/session/:id`), so suppressing the `navigate()` call fully prevents the unwanted switch — there is no separate state-driven selection path to also guard.

The handler runs a three-tier correlation cascade:

```
session_added(msg)
  │
  ├─ Tier 1   msg.spawnRequestId ∈ pendingSpawns
  │             → delete entry, clearSpawningCwd, navigate          (useMessageHandler.ts:147-151)
  │
  ├─ Tier 2   msg.session.cwd ∈ spawningCwds
  │             → clearSpawningCwd, navigate                        (useMessageHandler.ts:153-157)
  │
  └─ Tier 2.5 scan pendingSpawns for kind:"spawn" entry whose cwd == msg.session.cwd
                → delete entry, clearSpawningCwd, navigate          (useMessageHandler.ts:159-172)
```

A headless worker (subagent / `memory` / nested `pi -p`) registers with `hasUI:false`; the server auto-hides it (`memory-session-manager.ts:132`) and broadcasts `session_added { hidden:true, cwd:<parent cwd> }`. Because it shares the parent's `cwd`, Tiers 2 and 2.5 match it against placeholders/tokens minted for the *real* visible session.

## Goals / Non-Goals

**Goals**
- A `hidden` session never becomes the auto-navigation target.
- A `hidden` session never consumes correlation state (no `pendingSpawns` delete, no placeholder clear, no `spawningCwds` clear, no timer cancel).

**Non-Goals**
- Changing the server auto-hide heuristic. The flag is correct; only the client reaction is wrong.
- Changing how the session renders in the Hidden tier (already correct).
- Touching the natural-arrival (no-correlation) path — it already does not navigate.

## Decision

**Guard the entire correlation+navigate cascade with `!msg.session.hidden`.**

The `setSessions((prev) => …)` map update at the top of the `session_added` case stays unconditional — the hidden card must still appear in the list. Only the correlation/navigation block that follows is wrapped:

```ts
// after setSessions(...)
if (!msg.session.hidden) {
  // Tier 1 / Tier 2 / Tier 2.5 — unchanged bodies
}
```

### Why suppress correlation consumption, not just navigation

If we suppressed only `navigate()` but still let a hidden worker delete the `pendingSpawns` entry (Tier 2.5) or clear `spawningCwds` (Tier 2), the worker would consume the correlation token the real visible session needs. The real session would then arrive as a "natural" session — no auto-select, orphaned placeholder until the 30 s safety timeout. So the guard must wrap the whole block, gating both side effects together.

```
                       navigate?   consume pending spawn / clear placeholder?
  hidden === true        no                    no      ← chosen
  hidden === true        no                    yes     ← rejected: still racy
```

### Why the guard never blocks a real dashboard spawn

The server auto-hide condition is `hasUI === false && source !== "dashboard"` with `visibilityIntent` overrides. A dashboard-initiated spawn carries `source === "dashboard"` and is therefore **never** auto-hidden — its `session_added` has `hidden` falsy. So `!msg.session.hidden` is true for every session a dashboard user actually spawned, and the guard cannot suppress a wanted auto-select. A user who explicitly sets `PI_DASHBOARD_HIDDEN` opts into hiding and accepts no auto-nav.

### Legacy-server compatibility

A server predating the auto-hide heuristic omits `hidden` entirely. `undefined` is falsy, so `!msg.session.hidden` is `true` and behavior is identical to today. No version gate needed.

## Risks / Trade-offs

- **A genuinely useful hidden session is never auto-focused.** Acceptable: hidden sessions are, by definition, background workers the user did not ask to view. They remain reachable via the Hidden tier card.
- **Edge: a hidden worker registers before the real session, leaving the placeholder up.** Correct outcome — the placeholder clears when the real (visible) session arrives via Tier 1, or via the safety timeout. The worker no longer hijacks it.

## Migration / Rollback

No data migration. Rollback = revert the single `useMessageHandler.ts` guard. No protocol or persisted-state coupling.
