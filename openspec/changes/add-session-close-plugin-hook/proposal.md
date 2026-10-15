## Why

Sessions bound to a user (team plugin) stop on a clock, not on session state: `sweepIdle` ends any non-streaming team session 30 min after its last `agent_end`, ignoring an open browser watching it, a pending `ask_user`, queued follow-ups, a running tool or child process. Core already owns a quiescence-gated idle reaper (`add-embed-session-lifecycle`) that checks all of those, but it governs only `lifecyclePolicy:"ephemeral"` sessions behind a global switch that defaults off, and the plugin API gives a plugin no way to opt its sessions in, to veto a close, or to request a close through the same safe path. Every plugin therefore hand-rolls `setInterval` + `abortSpawnedRun`.

## What Changes

- **Opt-in close policy on plugin spawns.** `PluginSessionLifecycle` gains an optional `close` block: `{ idle?: { afterMs: number }, mode?: "sleep" | "archive" }`. A session that declares `close.idle` is governed by core's existing quiescence reaper (`decideReap`) with its own idle threshold, **independent of** `embedLifecycle.enabled` and of `lifecyclePolicy`. The declaration is persisted so it survives a server restart. Trusted plugins only (same gate as `spawnSession`); a `pluginRef` body cannot set or forge the policy.
- **Plugin closer.** `ServerPluginContext.registerSessionCloser(fn)` — once per plugin. Before core closes a session the plugin declared, it asks `fn({ sessionId, cwd, reason, idleMs })` (a minimal view: no other plugin's refs, no owner identity) → `"close" | "keep"`. A throw or a timeout counts as `"keep"` for that pass (fail toward the user's work) and is logged + counted.
- **Plugin-requested close.** `ServerPluginContext.requestSessionClose({ sessionId, reason, when })` — the plugin's own close events (e.g. owner revoked, persona deleted) close a session it declared through core's close path: `when:"now"` uses the graceful kill ladder at once; `when:"idle"` closes at the next quiescent point (same vetoes as the reaper, no idle-age wait). The declared `mode` applies. Being the plugin's own decision, it does not re-consult that plugin's closer.
- **Scope of the closer.** Consulted ONLY on the idle reaper path. User Shutdown, the spawn-register watchdog, socket-close finalization and heartbeat expiry are unchanged and never consult it (they are human intent or already-dead processes).
- **Defaults unchanged.** A plugin that declares no `close` and registers no closer behaves exactly as today on every path. Automation and goal plugins are untouched. The global `embedLifecycle` config, its default (`enabled:false`) and the ephemeral-session behavior are unchanged.
- **Team plugin opts in.** Team spawns declare `close: { idle: { afterMs: idleMinutes·60 000 }, mode: "sleep" }` (none when `idleMinutes` is `0`); its timer-based `sweepIdle` is removed. Team registers a closer that keeps a session while a conversation ensure/restart for it is in flight.

## Capabilities

### New Capabilities

- `plugin-session-close-hook`: the opt-in plugin close policy (`lifecycle.close`), the `registerSessionCloser` verdict hook, `requestSessionClose`, the paths that do and do not consult the closer, and the unchanged-default guarantee.

### Modified Capabilities

- `dashboard-plugin-loader`: the generic session-ownership seam's lifecycle declaration gains the `close` block; core may record the declaring plugin's id with it only to route that plugin's closer and authorize its close requests (not a lifecycle decision, never a `pluginRef` read).

- `embed-session-lifecycle`: idle reaping also governs sessions that declare a plugin close policy, independent of the global enable switch and of `lifecyclePolicy`; the "disabled by default" requirement is narrowed to undeclared sessions.
- `team-agent-sessions`: "Idle ending" moves from a 5-minute timer sweep measured from the last `agent_end` to the core quiescence reaper (watcher, pending ask, queues, tool, child process, grace window all block an idle end).

## Impact

- **Plugin API (additive):** `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `PluginSessionLifecycle.close`, `registerSessionCloser`, `requestSessionClose`.
- **Server:** `pending/pending-plugin-ref-registry.ts` (accept `close`), `event-wiring.ts` (apply + persist the declaration at first register), `embed-lifecycle/idle-reaper.ts` + `quiescence.ts` (per-session eligibility + threshold, closer consult), `embed-lifecycle-controller.ts` / `server.ts` (wire closer registry + `requestSessionClose`), session meta persistence (`session-to-meta.ts`, `session-scanner.ts`).
- **Shared types:** `DashboardSession` / `SessionMeta` gain an optional `closePolicy` field. Absent ⇒ today's behavior; no migration.
- **Team plugin:** `packages/team-plugin/src/server/conversations.ts` — spawn declaration, closer, removal of `sweepIdle` and its interval.
- **No pi / bridge protocol change; no floor bump.**

## Discipline Skills

- `security-hardening` — a plugin gains a veto over core's reaper and a new close entry point; bound it to sessions that plugin declared (it can neither keep nor close another plugin's or a user's session) and bound closer runtime so a hung plugin cannot stall the sweep.
- `observability-instrumentation` — every closer verdict, closer failure and plugin-requested close must be logged with session id, reason and verdict so "why did my team session sleep / not sleep" is answerable.
- `doubt-driven-review` — changes an existing spec'd default (`embed-session-lifecycle` off-by-default) and removes a shipped team behavior; review before it stands.
