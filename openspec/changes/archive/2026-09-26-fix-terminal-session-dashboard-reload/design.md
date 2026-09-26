## Context

See proposal.md (Why). Current terminal-hosted path, `packages/extension/src/bridge.ts`:

- `reload` option (~L1723) reads `globalThis.__pi_dashboard_reload_fn__` (`RELOAD_KEY`). If it is absent, it returns `NO_RELOAD_PATH_REASON`.
- The `__dashboard_reload` handler (~L1863) stores `() => ctx.reload()` in `RELOAD_KEY` and reloads.
- `command-handler.ts` (~L559) awaits `options.reload()` and emits exactly one `/reload` `command_feedback` through the **requesting** bridge's `eventSink`. `ReloadOutcome` and `NO_RELOAD_PATH_REASON` live in `command-handler.ts` (~L208).
- `bridge.ts` ~L133 keeps cross-reload state on `process` (`BRIDGE_KEY`), not `globalThis`, "to survive jiti module cache invalidation AND to share state across isolated extension contexts (vm sandboxes)".
- Server `dispatchReload` (`rpc-keeper/dispatch-reload.ts`) joins in-flight **respawns** only; the forward step has no in-flight guard.

**Spike result (task 1.1, pi 0.87.1, tmux, real bridge `-e packages/extension/src/bridge.ts` + throwaway `__probe` extension, `-ne --no-session`).** Dispatch via `pi.sendUserMessage("/__probe x", {expandPromptTemplates:true})` from a timer:

| Check | Result |
|---|---|
| (a) no user message / `agent_start` | ✅ no `input`, no user `message_start`, no `agent_start` |
| (b) `session_start{reason:"reload"}` in the reloaded instance | ✅ order: handler start → `session_shutdown{reload}` (+108 ms) → new instance load → `session_start{reload}` → **then** the old handler's `ctx.reload()` resolves |
| (c) second dispatch reloads again | ✅ instance 2 → instance 3, same sequence |
| (d) `process` value set before reload readable after | ✅ |
| (e) reloaded bridge passes the re-entry guard | ❌ `process.__pi_dashboard_bridge__.generation` stays `1` after both reloads; the dashboard marks the session `ended` after the first reload. **Latent bug confirmed** — every in-process reload (TUI `/reload` included) orphans the dashboard session today. D4's `prev.pi` clear on `session_shutdown{reload}` is required. |

(a)–(d) hold: the design stands.

pi 0.87.1 facts that shape the design (all read from `dist/`):

| Fact | Where | Consequence |
|---|---|---|
| `prompt()` runs `_tryExecuteExtensionCommand` when `expandPromptTemplates` is truthy, "even during streaming", after an optional `_isEmittingAgentSettled` deferral; if the command is not registered it returns `false` and the text continues as a user prompt | `core/agent-session.js` L1210–1219, L1336–1359 | Self-dispatch reaches the handler without starting an LLM turn, provided the command is registered when the (possibly deferred) dispatch runs |
| The handler gets `createCommandContext()`, which has `reload()`; it calls the runner's `reloadHandler`, which defaults to a no-op `async () => {}` unless the host binds command-context actions (interactive mode does, `agent-session.js` ~L2301/L2357); `session_start{reload}` is emitted only `if (hasBindings)` | `core/extensions/runner.js` L189/L312/L656; `core/agent-session.js` ~L2617 | A fresh ctx on every dispatch, so nothing is cached. **Premise:** terminal-hosted = interactive TUI host, which binds. An unbound host resolves `ctx.reload()` without reloading; D4 reports that as "pi did not reload" (slot still `started`) |
| `ExtensionAPI.sendUserMessage` is `void` + `.catch → emitError` | `core/agent-session.js` L2406 | The outcome can't be observed through the API call |
| `session.reload()` emits `session_shutdown{reload}` → `oldRunner.invalidate()` → … → `session_start{reload}` before it resolves | `core/agent-session.js` ~L2606–2623 | The requesting bridge disconnects **before** `ctx.reload()` resolves |
| Interactive `handleReloadCommand` returns normally when it refuses (streaming or compacting, it calls `showWarning`) **and** when `session.reload` throws (`showError`) | `modes/interactive/interactive-mode.js` L5152–5226 | "`ctx.reload()` resolved" does **not** mean "reloaded" |
| Bridge `session_shutdown` sends `session_unregister` (server marks the session `ended`, `pi-gateway.ts` ~L905) then calls `connection.disconnect()`; after that, `send()` buffers into a buffer that is never flushed | `bridge.ts` ~L3833, `connection.ts` L448–475 | Feedback sent by the requesting bridge after a successful reload is **lost**. This is also a latent bug in today's bootstrapped path |

## Goals / Non-Goals

**Goals:**
- Terminal-hosted reload from the dashboard needs no bootstrap and works on every reload.
- Every dashboard reload produces exactly one truthful `/reload` terminal feedback that actually reaches the server.

**Non-Goals:**
- Replacing kill-and-respawn for headless sessions. RPC mode also wires `reload`, but respawn also rescues sessions whose bridge has died; that belongs in a separate change.
- Changing the protocol or the client. The server change is limited to D5 (refusal + deadline on the forward step).
- Relaxing the `__` gate in `isExtensionSlashCommand` (`command-routing` spec).

## Decisions

**D1 — Self-dispatch the reload command via `sendUserMessage({expandPromptTemplates: true})`.**
`bridge.reload()` calls `pi.sendUserMessage("/__dashboard_reload <token>", {expandPromptTemplates: true})`. Every dispatch gets a fresh command ctx, so `RELOAD_KEY` and its single-use/stale failure mode are removed.
*Rejected:* caching the ctx and re-capturing it after each reload. This still needs a first human bootstrap, and it keeps a ctx pi tells extensions not to hold ("do not use the old ctx after await ctx.reload()").
*Rejected:* asking pi upstream for `pi.reload()`. Not needed, and the fix can't wait on it.
*Rejected:* reusing `tryDispatchExtensionCommand`. Its `__` gate is a spec'd contract, and it emits its own `started`/`completed` pair, which would break the one-terminal-feedback rule.

**D2 — Version gate shared with `slash-dispatch.ts`.**
Export a small predicate from `slash-dispatch.ts`, for example `supportsInProcessCommandDispatch(readVersion)`, built on the existing `compareTriplet` + `MIN_DISPATCH_PI_VERSION`, and reuse it. Same semantics: a pre-release of the floor counts as below it; a missing or unparseable version warns once and is assumed new (a deliberate trade-off, identical to user-typed slash dispatch: refusing would block reload on any odd version string, and supported installs report a parseable version). Below the floor, the bridge sends nothing and returns an error naming pi ≥ 0.84.2. That reason replaces the old `NO_RELOAD_PATH_REASON` bootstrap hint.
*Why:* below 0.84.2 the text would become a model turn. That's the exact regression `fix-out-of-band-reload` removed.

**D3 — Per-dispatch token; the handler only honours the current one; one reload in flight.**
The bridge mints a random token and records it as the armed reload on a `process` slot, `process.__pi_dashboard_pending_reload__ = {token, sessionId, state, armedAt}` (`state`: `armed` → `started` → `delivered` | `expired`). The handler reads it:
- **No args** (a human typed `/__dashboard_reload` in the TUI) → reload, with no dashboard feedback. Existing TUI behaviour is kept.
- **Token equals the armed token and `state === "armed"`** → set `state = "started"`, signal start, `await ctx.reload()`, then settle.
- **Token mismatch or not armed** (a late or stale dispatch) → no-op.

**In-flight refusal.** If `reload()` is called while the slot for this `sessionId` is `armed` or `started` and `armedAt` is within `FINISH_TIMEOUT_MS`, the bridge returns `error` "reload already in progress" and sends nothing. The no-args TUI path applies the same check and shows a TUI warning (`ctx.ui.notify`) instead of reloading. One pi process hosts one session at a time, so the slot holds at most one reload; a slot for a different `sessionId` (the session was switched via `/new` or `/resume`) is stale and is replaced. This prevents overwriting the in-flight token and a nested `ctx.reload()` inside a running `session.reload()`. The server refuses first (D5); this is the bridge-side guard.

The slot lives on `process`, matching `BRIDGE_KEY`, because the reload replaces the bridge module instance and the *new* instance must read it (D4), including under vm-sandboxed extension contexts where `globalThis` is not shared. The start and finish deferreds stay in a module-scoped map of the requesting instance, keyed by token. The handler that runs for the dispatch is the requesting instance's own registration (the pre-reload runner dispatches it), so it reaches that map through its closure; nothing callable is stored on `process`.

**D4 — Completion is reported by the reloaded bridge, failure by the requesting bridge.**

```mermaid
sequenceDiagram
    participant S as Server
    participant B1 as Bridge (old instance)
    participant P as pi runtime
    participant B2 as Bridge (new instance)
    S->>B1: /reload (forwarded)
    B1->>B1: version gate; arm slot {token, state:armed}
    B1->>P: sendUserMessage("/__dashboard_reload token", expand:true)
    P->>B1: handler(token, fresh ctx) → state=started
    B1->>P: ctx.reload()
    P->>B1: session_shutdown{reload} → unregister + disconnect
    P->>B2: load, session_start{reason:"reload"}
    B2->>S: session_register
    B2->>B2: slot matches sessionId, state=started, fresh → state=delivered
    B2->>S: replay + replay_complete
    B2->>S: command_feedback /reload completed
    P-->>B1: ctx.reload() resolves
    B1->>B1: state==delivered → outcome "handedOff" (emit nothing)
```

Outcomes for the requesting bridge. `ReloadOutcome` gains `{ ok: true, handedOff: true }`, and on it `command-handler.ts` emits nothing:

| Condition | Requesting bridge emits |
|---|---|
| pi < 0.84.2 | `error` (upgrade pi) |
| `sendUserMessage` throws synchronously | `error` (reason) |
| Slot already `armed`/`started` for this session and fresh | `error` ("reload already in progress"); slot untouched |
| Handler not started within `START_TIMEOUT_MS` (5 s) → delete the slot | `error` ("reload command did not run") |
| `ctx.reload()` settled, slot `state === "delivered"` → delete the slot | nothing (`handedOff`) |
| `ctx.reload()` settled, slot still `started` (pi refused or threw) → delete the slot | `error` ("pi did not reload — session busy or reload failed; see the pi terminal") |
| Not settled within `FINISH_TIMEOUT_MS` (60 s, measured from `armedAt`), slot not `delivered` → set `state = "expired"` | `error` (timeout); B2 ignores an expired slot |
| Finish timer fires but slot is `delivered` (slow success: B2 already reported, `ctx.reload()` still finishing the interactive restore) | nothing (`handedOff`); the timer is a no-op |

Slot transitions are compare-and-set: B2 moves `started → delivered` synchronously inside its `session_start` handler (pi awaits that handler before `ctx.reload()` resolves), and B1's timers act only on `armed`/`started`. Whichever side transitions first wins, so B1's `error` and B2's `completed` are mutually exclusive.

**B2 must pass the subagent re-entry guard.** `initBridge` returns early when `prev.generation > 0 && prev.pi && prev.pi !== pi` (`bridge.ts` ~L222), and `prev.pi` is never cleared, while pi builds a fresh `ExtensionAPI` per load (`core/extensions/loader.js` L447). The post-reload load of the main session is therefore indistinguishable from a subagent load. The bridge's `session_shutdown` handler clears `prev.pi` when `reason === "reload"` (a subagent load never receives the parent's `session_shutdown{reload}`), so B2 re-initialises. The spike (task 1.1) runs the **real bridge** and records whether today's TUI reload already trips this guard; if it does, this is a latent bug fixed here.

Both timeouts are measured from `armedAt`, the same anchor B2 uses, so B1 and B2 agree on freshness. The new instance consumes the slot only on `session_start` with `reason === "reload"`, a matching `sessionId`, `state === "started"`, and `now - armedAt < FINISH_TIMEOUT_MS`: it sets `delivered` and emits `completed` **after** `replay_complete` (wire order: `session_register` → replayed entries → `replay_complete` → `completed`). Emitting earlier is unsafe: during the replay window the server drops forwarded events without insert or broadcast when it can skip the wipe (`event-wiring.ts` ~L819, `skipReplayInsert`). `connection.send` buffers until the new socket opens and flushes in order. On any other `session_start`, B2 deletes the slot if it is `expired` or older than `FINISH_TIMEOUT_MS` (garbage collection) and otherwise leaves it untouched (a foreign-session or still-`armed` slot is not B2's to settle).
*Rejected:* awaiting `ctx.reload()` and trusting it resolved. It resolves on refusal and on failure (Context table), and the requesting connection is already gone when it resolves on success.

**D5 — Server: in-flight refusal + feedback deadline for forwarded reloads.**
`dispatchReload` keeps its ladder order and still returns `"forwarded"` without awaiting feedback. The forward step gains a per-session watch map, `forwardedReloads: Map<sessionId, {timer, armedAt}>`:
- **Before forwarding**, if a watch exists for the session → emit `error` "reload already in progress" and return `"refused"`; do not forward.
- **After `sendToSession` returns true** → arm a watch with `FORWARDED_RELOAD_DEADLINE_MS` = 75 000 (above the bridge's 60 s finish timeout plus reconnect slack).
- **Settle**: the inbound bridge-event path in `event-wiring.ts` checks for a `command_feedback` with `command === "/reload"` and a terminal status **at the top of the `event_forward` branch, before the replay-skip early return** (~L819), so a feedback that arrives inside a replay window still settles. It clears the watch and lets the event continue unchanged, **except** when the event would be dropped by the replay-skip early return (`replayingSessions && skipReplayInsert`): then the server persists and broadcasts that terminal feedback itself (as `emitCommandFeedback` does) before returning, so a settled feedback always reaches the client.
- **Expire**: when the timer fires, delete the watch, emit `error` ("reload did not report completion within 75 s — check the pi terminal") via `emitCommandFeedback`, and mark the session in `expiredForwardedReloads` (TTL = `FORWARDED_RELOAD_DEADLINE_MS`). A terminal `/reload` `command_feedback` from the bridge while that mark is set is dropped (not persisted, not broadcast) and the mark removed. **Arming a new watch for the session clears the mark**, so a retry's truthful feedback is never eaten. The residual edge (a feedback of reload #1 delayed > 15 s past its bridge-side bound *and* a retry already armed) settles watch #2 early; `command_feedback` carries no reload id, and adding one would be a protocol change. Accepted.
- **Lifecycle**: the watch is independent of session connection state. The reload itself sends `session_unregister` (session → `ended`) and B2 re-registers, so the watch must survive both; it is cleared only by settle or expire. Emitting the deadline `error` for an `ended` session is intended: that is exactly the "reload died after shutdown" case. A server restart drops pending watches (in-memory) and emits nothing.
- **Bridge-side bound**: B1 emits within `FINISH_TIMEOUT_MS` (60 s) of its `armedAt`, which is later than the server's arm; B2 emits only for a slot fresher than 60 s. A bridge feedback after 75 s therefore needs > 15 s of delivery delay.
The one-terminal-feedback contract is met across the two bridge instances (D4), with the server as the backstop when neither can report. Arm/settle/expire are logged with the session id.

## Risks / Trade-offs

- **[Risk] The reload fails *after* `session_shutdown`** (the requesting bridge is disconnected, and B2 never loads or never gets `session_start`) → the bridge's `error` is sent on a dead connection and lost. *Mitigation:* the server deadline (D5) emits the terminal `error` after 75 s; pi also shows the error in the TUI.
- **[Risk] The reload command is unregistered when a deferred dispatch runs** (the dispatch was deferred by `_isEmittingAgentSettled`, and meanwhile a TUI `/reload` disabled the extension) → `_tryExecuteExtensionCommand` returns `false` and `/__dashboard_reload <token>` becomes a user prompt. *Mitigation:* narrow window (requires a concurrent manual reload that also disables the dashboard extension); the start timeout still reports `error`. Accepted; noted so a harness scenario asserts no user message on the happy path.
- **[Risk] Mixed versions (new server, old bootstrapped bridge)** → each successful dashboard reload shows the deadline `error` after 75 s, because the old bridge's `completed` is lost on its disconnected socket (today the pill never resolves at all). *Mitigation:* neutral wording ("did not report completion … check the pi terminal"); the window closes when the terminal session restarts onto the new bridge.
- **[Trade-off] Deadline latency.** In the post-shutdown failure case the user waits up to 75 s for the `error`. Shorter would race the bridge's own 60 s timeout and risk a double feedback.
- **[Risk] The dispatch goes through `prompt()`'s `_isEmittingAgentSettled` deferral** → the handler starts late. *Mitigation:* the 5 s start timeout plus token disarm (D3) turn this into a clean `error`, never a late unrequested reload.
- **[Risk] A future pi changes `prompt()` ordering or `createCommandContext`** → the self-dispatch might reach the model. *Mitigation:* comments cite version-pinned references (as in `slash-dispatch.ts`), and a harness scenario asserts no user message or `agent_start` follows a reload.
- **[Trade-off] Three timeouts are constants, not config.** Reloads normally finish in well under 5 s; making them configurable adds surface without a use case.
- **[Trade-off] The `process` slot is cross-instance mutable state.** It is scoped to one key, and TTL plus state guards prevent a stale slot from emitting feedback.

## Migration Plan

1. Land the extension and server changes. Restart the server (`POST /api/restart`); `npm run reload` for dashboard-spawned sessions. A terminal session picks up the new bridge on its next restart or TUI `/reload`. Until then, its old bridge keeps the old behaviour, and a successful reload through it ends in the server's 75 s deadline `error`: the old bridge's `completed` is sent after its own disconnect and lost (see Risks).
2. No persisted state, no protocol bump. The watch map is in-memory; a server restart drops pending watches (no false `error`).

Rollback: revert `bridge.ts`, `command-handler.ts`, `slash-dispatch.ts`, `dispatch-reload.ts` and the `event-wiring.ts` hook. `__dashboard_reload` stays registered in both versions, so mixed old and new bridges cause no harm.

## Open Questions

_None._ (The server deadline was pulled into scope as D5.)
