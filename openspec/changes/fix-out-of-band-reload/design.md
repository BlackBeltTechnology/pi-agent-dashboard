## Context

Two independent reload paths exist and neither is correct for out-of-band triggers.

**Bridge path.** `/reload` → `command-handler.ts:482` → `options.reload()` → `bridge.ts:1283`,
which reads `globalThis[RELOAD_KEY]`. That key is set only inside the `__dashboard_reload`
command handler (`bridge.ts:1392-1404`) — i.e. only after the command actually ran once.
Un-bootstrapped sessions log to stderr and no-op, while `command-handler.ts:487-495` emits
`command_feedback {status:"completed"}` unconditionally. The dashboard reports success for a
reload that never happened.

**Server path.** The browser `send_prompt` handler intercepts `/reload` for any session with a
PID in `headlessPidRegistry` (`session-action-helpers.ts:29`) and converts it to SIGTERM +
respawn. Only the composer / button / `reload-all.sh` triggers reach that handler. The four
automated fan-outs — `server.ts:1224` (retry-policy save), `server.ts:1521` (package ops),
`server.ts:1546` (pi-core update), `resource-activation-routes.ts:209` (`POST
/api/resources/reload`) — call `piGateway.sendToSession` directly, bypass the interception, and
land on the broken bridge path.

**The server already owns a working dispatch primitive.** `handleDispatchExtensionCommand`
(`packages/server/src/rpc-keeper/dispatch-router.ts`) writes a pi RPC `prompt` line to the
session's keeper UDS via `headlessPidRegistry.writeRpc` and persists + broadcasts the terminal
`command_feedback`. pi's RPC mode runs that line through `session.prompt()` **with** command
handling, so a slash command dispatched this way actually executes its registered handler.

## Goals / Non-Goals

**Goals:**
- Reload works on a dashboard-spawned headless session that was never touched in a TUI.
- No reload terminates a healthy session.
- Every reload produces exactly one truthful terminal `command_feedback` keyed `/reload`.
- All six trigger sources routed through one server-side entry point.

**Non-Goals:**
- Changing which events trigger reload.
- `POST /api/restart`.
- Removing kill-and-respawn — it stays as fallback and as the pi-core runtime-swap mechanism.
- Making terminal-hosted (tmux / wt / wsl-tmux) sessions dispatch-capable. Not achievable with
  the current pi API; they get the retained `RELOAD_KEY` fast path or an honest error.

## Decisions

**D1 — One server-side `dispatchReload(sessionId)` entry point; the server writes the keeper
line directly.**
Resolution order per session:
1. `headlessPidRegistry` has a keeper socket for the session → write the
   `/__dashboard_reload` RPC line (`buildPiRpcLine`) and emit the terminal feedback **keyed
   `/reload`**. No bridge round-trip.
2. No keeper but a headless PID → kill-and-respawn fallback (existing `handleHeadlessReload`).
3. Neither → forward `/reload` to the bridge (terminal-hosted case); the bridge uses a captured
   `RELOAD_KEY` if present, else emits an explicit error.

Step 1 is **gated on the session being idle** — see D9.

*Rejected: routing through the bridge's `tryDispatchExtensionCommand`.* Its
`isExtensionSlashCommand` gate rejects any `__`-prefixed name (`bridge-context.ts:142`), and a
test locks that in (`bridge-slash-command-routing.test.ts:159`). Relaxing the `__` rule would
also change `filterHiddenCommands` and leak the command into UI command lists. The server-side
write skips the gate entirely, and skips the bridge WS hop — which matters because the bridge
socket can be dead while the keeper is alive.

*Rejected: `pi.sendUserMessage("/__dashboard_reload", {deliverAs:"followUp"})`.* pi hardcodes
`expandPromptTemplates: false` in `sendUserMessage`, skipping `_tryExecuteExtensionCommand`, so
the command never dispatches and the literal text becomes an LLM user message
(`slash-dispatch.ts:16-19`). pi's follow-up queue also never drains after `finishRun()`
(`bridge.ts:457-464`).

**D2 — Feedback is keyed `/reload`, and its optimism is stated, not hidden.**
`dispatch-router.ts:83` emits `completed` on a successful UDS **write** — pi received the line.
`dispatchReload` reuses that emitter but passes the label `/reload`, so the pill the trigger
opened is the pill that terminates.

**A handler failure after delivery is currently invisible, and this change does not make it
visible.** The `extension_error` referenced by `dispatch-router.ts:7-10` goes to pi's **stdout**
(`rpc-mode.js:259-261`), which the keeper discards (pi is spawned with stdout `ignore` unless
`PI_KEEPER_CAPTURE_PI_OUTPUT` is set), and no bridge or client code consumes an `extension_error`
event — that comment is aspirational. Accepted trade-off: `completed` means "pi received the
line", nothing more; the spec states this so no consumer over-reads it. A real dispatch ack
(and/or surfacing `extension_error`) is an explicit follow-up.

**D3 — `shouldInterceptReload` narrows to "no in-process path available".**
It gains an `isSessionConnected(sessionId)` probe (`pi/pi-gateway.ts:723`; there is no
`hasConnection`) and the keeper check from D1. Respawn is taken only when neither a keeper write
nor a live bridge is available, or when the forwarding `sendToSession` returns `false`.
Signature change; existing call sites and unit tests updated.

**D9 — A busy session refuses the reload; it is never dispatched mid-run.**
pi executes an extension command immediately, *even during streaming*
(`agent-session.js:798-807`), and `ctx.reload()` invalidates the running runner
(`runner.js:352-362` — `assertActive()` throws) while `resetApiProviders()` runs under an
in-flight request. pi's own TUI refuses in exactly these states
(`interactive-mode.js:4746-4753`). So `dispatchReload` SHALL NOT write the keeper line while the
session is streaming or compacting; it emits `command_feedback {status:"error"}` mirroring pi's
wording ("Wait for the current response to finish before reloading").

The server can observe streaming (`session.status === "streaming"`) but has **no compaction
signal** — `SessionStatus` is `active | idle | streaming | ended` (`shared/src/types.ts:25`) and
nothing tracks compaction. This change therefore adds one: the bridge reports compaction
start/end and the server tracks it on the session record, so the compaction refusal has a real
observable instead of a hopeful one. Protocol + shared-types addition; client untouched.
Deferring the reload until
`agent_end` is an explicit follow-up, not part of this change — an honest refusal is still
strictly better than today's silent no-op with a false `completed`.

**D4 — The respawn fallback must not be dead-lettered by stale session state.**
`handleHeadlessReload` refuses when `session.status === "streaming"` or `sessionFile` is missing.
A session whose bridge died mid-stream is pinned at `streaming` forever and is exactly the
session that reaches the fallback. On the fallback branch the streaming guard is lifted for
sessions with no live bridge connection; a missing `sessionFile` remains a hard error and is
reported as such.

**D5 — Bridge-side honesty for the terminal-hosted case.**
`command-handler.ts` stops emitting the unconditional `completed`. `BridgeCommandOptions.reload`
changes from `() => void` to an outcome-returning call so the handler can emit `completed` only
when a reload actually ran, and `error` (with the session-shape hint) when no path existed. This
signature change and its call sites/tests are part of the change, not incidental.

**D6 — pi-core update is a runtime swap, routed to respawn unconditionally.**
`ctx.reload()` reloads settings/providers/resources inside the running node process; it cannot
replace the pi-core binary. `piCoreUpdater.onAllComplete` (`server.ts:1546`) therefore calls the
respawn path directly, not `dispatchReload`, for every headless session — including connected
and streaming ones (the streaming guard does not apply to an explicit runtime swap). Sessions
that cannot be swapped (no `sessionFile`, non-headless) report `error`, never success.

**D7 — Fan-out sources target more than the connected set.**
`server.ts:1224/1521`, `resource-activation-routes.ts:209` iterate
`piGateway.getConnectedSessionIds()`, so a headless session with a dead bridge is not targeted at
all. Each fan-out switches to the session set the server knows is alive (connected ∪ sessions
with a live keeper/PID) and calls `dispatchReload` per session, so the fallback branch is
reachable from every trigger and the return-value gating of D3 applies uniformly.
`headlessPidRegistry` currently exposes no enumeration (only `size()`), and `sessionManager`
cannot substitute — a bridge-dead headless session is stamped `ended` on WS close
(`pi-gateway.ts:585-598`). A `listSessions()`-style method on `headless-pid-registry.ts` is part
of this change.

**D8 — The delta rewrites every current requirement whose premise changed.**
`Kill-then-respawn ordering`, `Idempotency and concurrent reloads`, and `/reload on streaming
headless session is rejected` all encode "respawn is the default". They are carried into the
delta's `## MODIFIED Requirements` and rescoped to the fallback, rather than left standing to
contradict the new default.

The capability's `## Purpose` block (`openspec/specs/headless-reload/spec.md:3-9`) is **also**
falsified — it asserts the bridge-side capture path "is unreachable from headless/RPC mode" and
defines the capability as respawn-based. OpenSpec deltas operate on requirements only; a sync
never rewrites an existing `## Purpose`, so it needs a hand-edit of the main spec at sync/archive
time, tracked as an explicit task.

## Risks / Trade-offs

- **Optimistic terminal feedback (D2)** → `completed` means "pi received the line", not "reload
  finished". Handler failures surface as a separate `extension_error` row. Stated in the spec so
  no consumer over-reads it.
- **Version skew during rollout** → a new server with old extensions in long-running sessions:
  the D1 keeper path does not depend on *new* extension code, so headless reload works immediately;
  terminal-hosted sessions keep the old bridge behaviour until they restart. This is why D1 puts
  the dispatch on the server and not in the bridge.
- **Keeper write succeeds, pi wedged** → no ack exists; the observable is a `completed` for a
  reload pi never processed. Follow-up: dispatch ack / timeout.
- **Predicate/send race** → a connection can drop between the probe and the send; the fallback is
  gated on `sendToSession`'s return value and on the keeper write's boolean, not on the probe
  alone, at every call site (D7).
- **Two bridge paths remain for terminal-hosted sessions** (`RELOAD_KEY` vs error) → bounded by
  D5's single-terminal-event rule; both branches are covered by tests.
- **The `RELOAD_KEY` fast path is single-use per process** → it is written only inside the
  `__dashboard_reload` handler (`bridge.ts:1402`) and captures that invocation's ctx; after the
  first reload the old runner is invalidated, so a second call throws **synchronously** from
  `assertActive()` — which `bridge.ts:1287`'s `.catch()` cannot catch. D5's outcome-returning
  `reload` must wrap the call in try/catch and report `error`. "Present" does not imply "usable".
- **The keeper path depends on the *running* extension having registered `__dashboard_reload`**
  → old-extension skew is safe (the registration is old code), but if the extension failed to
  load or is disabled, pi finds no command and the dispatched text falls through to ordinary
  prompt handling — it becomes an LLM user message after the server emitted `completed`.
- **Every in-process reload flaps the session record** → `session.reload()` emits
  `session_shutdown` → the bridge sends `session_unregister` → the server stamps `ended` and
  broadcasts removal, then the session re-registers on `session_start {reason:"reload"}`. The
  process survives, but the dashboard card disappears and reappears. Pre-existing for TUI
  reloads; new for headless dashboard sessions. State carry-over on that re-register path is
  verified by a task.

## Migration Plan

1. Deploy the server change (`POST /api/restart`) — this alone fixes headless reload, since D1's
   dispatch does not depend on extension code.
2. Reload sessions to pick up the extension change (`npm run reload`); terminal-hosted sessions
   that were never bootstrapped now report an explicit error instead of silent success.

Rollback: revert `bridge.ts`, `command-handler.ts`, `session-action-helpers.ts`,
`session-action-handler.ts`, and the `server.ts` fan-out/pi-core routing. No persisted state or
protocol version change; `__dashboard_reload` registration is untouched either way.

## Open Questions

None. Fan-out feedback volume: emit per session, client coalesces by `command` within a 2000 ms
window. Scoped follow-ups
(not open decisions here): deferring a reload for a busy session until `agent_end` (D9), and a
real dispatch ack / surfacing `extension_error` (D2).
