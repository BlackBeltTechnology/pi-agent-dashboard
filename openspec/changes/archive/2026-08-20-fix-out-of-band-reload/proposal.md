# Make out-of-band reload honest, and make it reach every session

> **Rev 2.** The first revision of this proposal was built on the claim that the server could
> invoke `ctx.reload()` by writing `/__dashboard_reload` to a session's RPC keeper. That claim was
> **measured and falsified** in the docker harness — see "The mechanism that does not exist"
> below. This revision drops that mechanism and keeps the parts that were independently verified.

## Why

Reload is triggered from six places. Only one of them is a human typing in the chat composer:

| Trigger | Call site |
|---|---|
| Reload button / `/reload` in composer | browser `send_prompt` → `session-action-handler.ts` |
| `pnpm run reload` | `scripts/reload-all.sh` → same browser path |
| pi retry-policy settings save | `server.ts` `reloadConnectedSessions` (passed to `registerPiRetryRoutes`) |
| Package install / remove | `server.ts` `packageManagerWrapper.setReloadSessions` |
| pi-core update complete | `server.ts` `piCoreUpdater.onAllComplete` |
| `POST /api/resources/reload` | `routes/resource-activation-routes.ts` |

The last four fan out with `piGateway.sendToSession(sid, {type:"send_prompt", text:"/reload"})`,
which goes **straight to the bridge** — it never passes through the browser `send_prompt`
handler, so `shouldInterceptReload` (`session-action-helpers.ts`) is never consulted for them.

In the bridge, `/reload` reaches `command-handler.ts`, which calls `options.reload()` —
`bridge.ts`. That reads `globalThis[RELOAD_KEY]`, populated **only** when a human has typed
`/__dashboard_reload` in pi's TUI. pi's plain `ExtensionContext` has no `reload()`; only
`ExtensionCommandContext` does. So on any session that never had that TUI bootstrap — which is
every dashboard-spawned headless session — the reload logs one line to bridge stderr and does
nothing.

Worse, `command-handler.ts` emits `command_feedback {status:"completed"}` **unconditionally**,
whether `options.reload` existed, ran, or silently no-op'd. The dashboard reports "reloaded" for a
reload that never happened. **That false success is the core defect**: an operator saves settings,
installs a package, or updates pi-core, sees success, and nothing changed.

Two further gaps compound it:

- **The fan-outs cannot even reach the sessions that need them.** They iterate
  `getConnectedSessionIds()` only. A headless session whose bridge WebSocket died is stamped
  `ended` in the session map and is invisible to that set — yet its pi process is alive and
  respawnable. The trigger silently skips it.
- **A reload can land mid-run.** Nothing checks whether the session is streaming or compacting
  before a reload is delivered, and the server has no compaction signal at all
  (`SessionStatus = active|idle|streaming|ended`).

## The mechanism that does not exist

Rev 1 proposed writing `/__dashboard_reload` to the session's keeper UDS via
`headlessPidRegistry.writeRpc`, on the claim that *"pi's RPC mode runs that line through
`session.prompt()` with command handling"*.

**Measured in the harness with `keeperLog.capturePiOutput = true`. It does not.** pi's own
captured stdout for a dispatched `/__dashboard_reload`:

```json
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"/__dashboard_reload"}]}}
{"type":"message_update","assistantMessageEvent":{"type":"text_end","content":"faux: no scenario (id=unset)"}}
{"type":"agent_end", …}
```

pi sent the literal text **to the model** as a user prompt. Control: `/help`, a pi **built-in**,
written directly to the same socket behaved identically — so this is not the `__` prefix and not
our command registration. **pi's RPC `{type:"prompt"}` performs no slash-command dispatch.**

Dispatching a reload that way would inject a junk user message into the operator's transcript,
burn a full model round-trip (9807 tokens observed), and report `completed` because the socket
write succeeded — strictly worse than the silent no-op it was meant to fix.

**This also means `handleDispatchExtensionCommand`
(`packages/server/src/rpc-keeper/dispatch-router.ts`, change
`add-rpc-stdin-dispatch-with-keeper-sidecar`) has the same defect for every slash command it
forwards.** That is a live bug on `develop`, out of scope here, and needs its own change.

**Also already disproven (carried from rev 1):**
- `pi.sendUserMessage("/__dashboard_reload", {deliverAs:"followUp"})` — pi hardcodes
  `expandPromptTemplates: false`, skipping `_tryExecuteExtensionCommand`
  (`slash-dispatch.ts`), and the follow-up queue never drains after `finishRun()`.
- The bridge's `tryDispatchExtensionCommand` — its `isExtensionSlashCommand` gate rejects any
  `__`-prefixed command (`bridge-context.ts`), locked in by
  `bridge-slash-command-routing.test.ts`.

**Consequence for scope:** there is no RPC-reachable path to `ctx.reload()` on the pinned pi.
Kill-and-respawn remains the only mechanism that actually reloads a headless session, and it stays
the default. Reaching `ctx.reload()` without a TUI bootstrap requires an upstream pi change (an
RPC `{type:"command"}` message, or command dispatch inside `prompt`) and is now an upstream ask,
not a deliverable here.

## What Changes

- **One server-side reload entry point.** A `dispatchReload(sessionId)` helper resolves, in order:
  busy → refuse; headless PID → kill-and-respawn; live bridge → forward `/reload`; otherwise → an
  honest terminal error. All six triggers call it (pi-core excepted, below). This is the same
  *outcome* as today for the composer path, but it is now the **only** path — the four automated
  fan-outs stop bypassing the interception.
- **Honest, non-duplicated feedback.** `command-handler.ts` stops emitting an unconditional
  `completed`, and `BridgeCommandOptions.reload` returns an outcome so the handler emits
  `completed` only when a reload actually ran — including the case where a captured `RELOAD_KEY`
  throws *synchronously* because its runner was invalidated by an earlier reload. Exactly one
  terminal `command_feedback` keyed `/reload` per reload.
- **Fan-outs target more than the connected set.** They target
  `getConnectedSessionIds()` ∪ `headlessPidRegistry.listSessions()`, so a headless session with a
  dead bridge is reachable — the case the respawn path exists for and the old fan-out could never
  hit.
- **A busy session refuses the reload.** Respawning mid-stream destroys in-flight work.
  `dispatchReload` refuses a streaming or compacting session with an explicit error mirroring pi's
  own TUI wording. The refusal deliberately does **not** fire on a *stale* `streaming` — a session
  whose bridge died before `agent_end` is pinned there forever and is exactly what the respawn
  path must still rescue. Because the server has no compaction signal today, this change adds one,
  derived from the `session_before_compact` / `session_compact` events the bridge already
  forwards.
- **A session with no registered PID is never respawned.** Doing so would start a second pi
  process against a terminal-hosted session's file. Today's predicate happens to avoid this; the
  guard is now explicit and tested.
- **Runtime-swap reloads are distinguished from resource reloads.** A reload cannot swap the
  running pi-core binary. `piCoreUpdater.onAllComplete` is routed explicitly to
  `respawnForRuntimeSwap` — respawning unconditionally, including connected and streaming sessions
  — and reports `error` for any session it cannot swap, rather than inheriting the resource-reload
  path and its busy refusal.
- **All six trigger sources are enumerated and converge** on one delivery path and one observable
  outcome, with the pi-core exception stated above.

**Out of scope (follow-ups):**
- **Reaching `ctx.reload()` in-process for a headless session.** Not possible on the pinned pi
  (see above). Upstream ask.
- **The `dispatch_extension_command` false-success bug** exposed while measuring this. Live on
  `develop`, separate change.
- **`POST /api/session/:id/prompt` bypasses the ladder** — it forwards straight to the bridge. In
  scope here only to the extent of routing it; see tasks.
- Deferring a reload for a busy session until `agent_end` (this change refuses instead).
- Surfacing pi's `extension_error` after delivery.
- Changing *which* events auto-trigger a reload; `POST /api/restart`.

## Capabilities

### Modified Capabilities

- `headless-reload`: every trigger converges on one server-side entry point; feedback must reflect
  the real outcome, keyed `/reload`, instead of an unconditional `completed`; fan-outs must target
  registry-known sessions and not only bridge-connected ones; a busy session must be refused,
  while a stale `streaming` on a bridge-dead session must not block the respawn; a session with no
  registered PID must never be respawned; and a pi-core runtime swap is specified separately from
  a resource reload.

## Impact

- `packages/server/src/rpc-keeper/dispatch-reload.ts` (new) — the single entry point and its
  ladder; `reloadTargetSessionIds` for fan-out targeting.
- `packages/server/src/browser-handlers/session-action-helpers.ts` — `shouldInterceptReload` →
  `isBareReloadCommand` (arg-form gate only; delivery is the ladder's job).
- `packages/server/src/browser-handlers/session-action-handler.ts` — routes bare `/reload` through
  the ladder; `handleHeadlessReload` gains a suppressible streaming guard; adds
  `respawnForRuntimeSwap` and the PID-less guard.
- `packages/server/src/server.ts` + `routes/resource-activation-routes.ts` — fan-outs route
  through `dispatchReload` over the union target set; pi-core routed as a runtime swap.
- `packages/shared/src/types.ts` + `packages/server/src/session/` — `DashboardSession.compacting`,
  derived from forwarded compaction events, cleared on `unregister`.
- `packages/server/src/spawn-process/headless-pid-registry.ts` — `listSessions()` / `hasKeeper()`
  (only `size()` existed).
- `packages/extension/src/command-handler.ts` + `bridge.ts` — no unconditional `completed`;
  `BridgeCommandOptions.reload` returns a `ReloadOutcome`; `RELOAD_KEY` fast path retained for
  terminal-hosted sessions.
- Docs: `docs/architecture.md` "`/reload` Flow" section rewritten.
- **Risk:** shared path behind settings save, package install, pi-core update and the reload
  button. The failure mode is silent by construction, so the observable contract (one honest
  terminal feedback per reload) is part of this change, not a follow-up.

## Discipline Skills

- `systematic-debugging` — the mechanism claim must be verified against a running pi, not pi's
  prose docs. Rev 1 failed exactly there, and only the instrumented harness caught it.
- `doubt-driven-review` — the busy-refusal carve-out (stale `streaming`) and the feedback contract
  are the risky, hard-to-reverse parts.
- `review-code` — cross-package change (extension + server) reviewed before commit.
- `observability-instrumentation` — the whole change hinges on emitting a truthful terminal event
  per reload.
