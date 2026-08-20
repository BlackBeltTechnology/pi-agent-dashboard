# Make out-of-band reload actually reload, instead of silently no-op'ing

## Why

Reload is triggered from six places. Only one of them is a human typing in the chat composer:

| Trigger | Call site |
|---|---|
| Reload button / `/reload` in composer | browser `send_prompt` → `session-action-handler.ts` |
| `pnpm run reload` | `scripts/reload-all.sh` → same browser path |
| pi retry-policy settings save | `server.ts:1224` `reloadConnectedSessions` (passed to `registerPiRetryRoutes`) |
| Package install / remove | `server.ts:1521` `packageManagerWrapper.setReloadSessions` |
| pi-core update complete | `server.ts:1546` `piCoreUpdater.onAllComplete` |
| `POST /api/resources/reload` | `routes/resource-activation-routes.ts:209` |

The last four fan out with `piGateway.sendToSession(sid, {type:"send_prompt", text:"/reload"})`,
which goes **straight to the bridge** — it never passes through the browser `send_prompt`
handler, so `shouldInterceptReload` (`session-action-helpers.ts:29`) is never consulted for them.

In the bridge, `/reload` reaches `command-handler.ts:482`, which calls `options.reload()` —
`bridge.ts:1283`. That reads `globalThis[RELOAD_KEY]`, populated **only** when a human has typed
`/__dashboard_reload` in pi's TUI (`bridge.ts:1392-1404`). pi's plain `ExtensionContext` has no
`reload()`; only `ExtensionCommandContext` does. So on any session that never had that TUI
bootstrap — which is every dashboard-spawned headless session — the reload logs one line to
bridge stderr and does nothing.

Worse, `command-handler.ts:487-495` emits `command_feedback {status:"completed"}`
**unconditionally**, whether `options.reload` existed, ran, or silently no-op'd. The dashboard
reports "reloaded" for a reload that never happened. That false success is the core defect: an
operator saves settings, installs a package, or updates pi-core, sees success, and nothing
changed.

Meanwhile the composer/button path for headless sessions is intercepted and converted into
SIGTERM + respawn (`session-action-handler.ts`), so the *one* trigger a human drives directly
kills and restarts the process while the five automated ones do nothing at all. Two paths,
neither correct.

**The mechanism to fix it already exists in this repo — on the server.**
`handleDispatchExtensionCommand` (`packages/server/src/rpc-keeper/dispatch-router.ts`) writes a
pi RPC `prompt` line to the session's keeper UDS via `headlessPidRegistry.writeRpc` and persists
+ broadcasts the terminal `command_feedback`. pi's RPC mode runs that line through
`session.prompt()` **with** command handling, so a slash command dispatched this way actually
executes its registered handler — no TUI bootstrap, no process kill, and no dependence on the
bridge WebSocket being alive.

**Explicitly NOT the fix — two mechanisms already disproven in this repo:**
- `pi.sendUserMessage("/__dashboard_reload", {deliverAs:"followUp"})`. pi hardcodes
  `expandPromptTemplates: false` in `sendUserMessage`, skipping `_tryExecuteExtensionCommand`, so
  the command never dispatches and the literal text becomes an LLM user message
  (`slash-dispatch.ts:16-19`). pi's follow-up queue also never drains after `finishRun()`
  (`bridge.ts:457-464`, re-verified against pi 0.84.1).
- The bridge's `tryDispatchExtensionCommand`. Its `isExtensionSlashCommand` gate rejects any
  `__`-prefixed command (`bridge-context.ts:142`) and a test locks that in
  (`bridge-slash-command-routing.test.ts:159`); relaxing it would also change
  `filterHiddenCommands` and leak the command into UI command lists.

## What Changes

- **One server-side reload entry point.** A `dispatchReload(sessionId)` helper SHALL resolve, in
  order: keeper available → write the `/__dashboard_reload` RPC line and emit the terminal
  feedback keyed `/reload`; else headless PID but no keeper → kill-and-respawn fallback; else →
  forward `/reload` to the bridge (terminal-hosted case). All six triggers SHALL call it.
- **Honest, non-duplicated feedback.** `command-handler.ts` SHALL stop emitting an unconditional
  `completed`, and `BridgeCommandOptions.reload` SHALL return an outcome so the handler can emit
  `completed` only when a reload actually ran. Exactly one terminal `command_feedback` keyed
  `/reload` per reload. The dispatch feedback is optimistic by construction (a successful UDS
  write means pi received the line); that limit SHALL be stated in the spec, not implied away.
- **Stop terminating healthy sessions for a reload.** `shouldInterceptReload` SHALL narrow from
  "any headless session" to "no in-process path available" — no keeper write possible AND
  `piGateway.isSessionConnected(sessionId) === false`, or the forwarding send returning `false`.
- **A busy session refuses the reload.** pi runs an extension command immediately even mid-run,
  and `ctx.reload()` invalidates the active runner — dispatching mid-stream destroys in-flight
  work, which is why pi's own TUI refuses. `dispatchReload` SHALL refuse a streaming or
  compacting session with an explicit error mirroring pi's wording. Deferring until idle is a
  follow-up. Because the server has **no compaction signal** today
  (`SessionStatus = active|idle|streaming|ended`), this change adds one: the bridge reports
  compaction start/end and the server tracks it.
- **Fan-outs target more than the connected set.** The four automated fan-outs currently iterate
  `getConnectedSessionIds()` only, so a headless session with a dead bridge is never targeted.
  They SHALL target the sessions the server knows are alive and route each through
  `dispatchReload`, making the fallback reachable from every trigger.
- **Runtime-swap reloads are distinguished from resource reloads.** An in-process `ctx.reload()`
  reloads settings, providers, extensions, skills, prompts and themes — it CANNOT swap the
  running pi-core binary. The `piCoreUpdater.onAllComplete` trigger therefore still requires
  respawn for headless sessions; it SHALL be routed explicitly rather than inheriting the
  resource-reload path.
- **All six trigger sources are enumerated and converge** on the same delivery path and the same
  observable outcome, with the pi-core exception stated above.

**Out of scope (follow-ups):**
- Deferring a reload for a busy session until `agent_end` (this change refuses instead).
- A real dispatch ack / surfacing pi's `extension_error`: a reload handler that fails *after*
  delivery is invisible today (pi writes it to stdout, the keeper discards it, nothing consumes
  it). The spec states this limit rather than implying it away.
- Changing *which* events auto-trigger a reload.
- `POST /api/restart` — separate lifecycle, unchanged.
- Giving terminal-hosted (tmux / wt / wsl-tmux) sessions a dispatch mechanism they do not have.
  Until pi ships `pi.dispatchCommand` (Path B), those sessions get an honest error, not a fix.

## Capabilities

### Modified Capabilities

- `headless-reload`: reload must reach a running session via a server-side keeper dispatch rather
  than a TUI-bootstrapped `globalThis` hook; kill-and-respawn narrows to the
  no-in-process-path fallback (plus the pi-core runtime-swap case); feedback must reflect the
  real delivery outcome, keyed `/reload`, instead of an unconditional `completed`; and every
  requirement that assumed respawn-by-default is rescoped to the fallback.

## Impact

- `packages/server/src/rpc-keeper/dispatch-router.ts` (+ a new `dispatchReload` helper) — server
  writes the reload RPC line; terminal feedback relabelled `/reload`.
- `packages/server/src/browser-handlers/session-action-helpers.ts` — `shouldInterceptReload`
  gains keeper + `isSessionConnected` inputs (signature change; call sites + tests updated).
- `packages/server/src/browser-handlers/session-action-handler.ts` — respawn becomes the fallback
  branch; its `status === "streaming"` guard must not dead-letter a bridge-dead session.
- `packages/server/src/server.ts:1224,1521,1546` + `routes/resource-activation-routes.ts:209` —
  fan-outs route through `dispatchReload`; pi-core update routed as a runtime swap.
- `packages/shared/src/` + `packages/extension/src/bridge.ts` + session record — new compaction
  start/end signal so the busy-session refusal is observable server-side.
- `packages/server/src/spawn-process/headless-pid-registry.ts` — enumeration method so fan-outs
  can target keeper/PID-alive sessions (only `size()` exists today).
- `packages/extension/src/command-handler.ts:482-495` + `bridge.ts:1283` — no unconditional
  `completed`; `BridgeCommandOptions.reload` returns an outcome; `RELOAD_KEY` fast path retained
  for terminal-hosted sessions.
- Docs: `docs/architecture.md` "`/reload` Flow" section rewritten.
- Tests: server dispatchReload resolution order; feedback honesty (no false `completed`, keyed
  `/reload`); narrowed predicate; fallback reachable for a bridge-dead streaming session;
  pi-core runtime-swap routing.
- **Risk:** shared path behind settings save, package install, pi-core update and the reload
  button. The failure mode is silent by construction, so the observable contract (one honest
  terminal feedback per reload) is part of this change, not a follow-up.

## Discipline Skills

- `systematic-debugging` — the mechanism claim must be verified against installed pi source, not
  pi's prose docs; this proposal's first draft failed exactly there.
- `doubt-driven-review` — the fallback narrowing and the feedback contract are the risky,
  hard-to-reverse parts.
- `review-code` — cross-package change (extension + server) reviewed before commit.
- `observability-instrumentation` — the whole change hinges on emitting a truthful terminal
  event per reload.
