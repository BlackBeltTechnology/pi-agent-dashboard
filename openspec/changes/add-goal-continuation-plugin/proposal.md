## Why

Hermes Agent ships `/goal` — a standing objective that survives across turns. After every turn a lightweight judge model decides "done or continue"; if not done, the agent feeds itself a continuation prompt and keeps working until the goal is achieved, paused, or a turn budget runs out (the "Ralph loop"). A faithful Pi port already exists: `@ricoyudog/pi-goal-hermes` (judge + state machine + `agent_end` continuation + compaction-safe persistence). It works in the pi TUI today with zero dashboard awareness.

Bringing that behaviour into the dashboard needs three legs. Investigation (three grounded code traces) established:

1. **Judge loop** — `turn_end` / `agent_end` are pure pi-runtime hooks. They fire identically in a headless dashboard-spawned session. The Ralph loop runs server-side for free.
2. **Turn injection** — the dashboard bridge ALREADY owns a follow-up engine: `bridgeFollowUp` buffer + `drainFollowupQueue()` on `agent_end` (`packages/extension/src/bridge.ts`). A naive port that calls `pi.sendUserMessage` itself runs a SECOND parallel injection engine racing the same `isIdle()` window → double turns, dropped continuations, budget miscounts. The port's own `bufferFollowupSend` gate (`isAgentStreaming === true`) is already shut by the time an `agent_end` judge resolves, and the bridge's `setTimeout(0)` drain fires before the async judge verdict — so a naive piggyback also deadlocks.
3. **Status + control surfaces** — the port's UX rides TUI-only surfaces (`ctx.ui.setStatus` footer, `ctx.ui.notify`, `registerMessageRenderer`) that NEVER cross the bridge. Confirmed by the bridge comment that `setStatus` "only writes a footer string." None reach the web client.

A fourth trace established this is best delivered as a **dashboard plugin**, not baked into the core bridge. The plugin system (proven by `flows-plugin`, `jj-plugin`, `roles-plugin`) ships three entries — `bridge/` (auto-registered as a pi extension, full `ExtensionAPI`), `server/` (`ServerPluginContext`: `registerPiHandler` / `registerBrowserHandler` / `broadcastToSubscribers` / `sessionManager`), and `client/` (own reducer + UI slots). Two of the three legs that would need core/shell edits in a bake-in plan become fully plugin-local:

- **Status chip** → plugin server `broadcastToSubscribers({...})` → plugin-owned client reducer → slot render. No edit to the shared protocol union, no edit to the shell `event-reducer.ts`. Exactly the flows intent-broadcast pattern.
- **Set / pause / resume / clear** → plugin `registerBrowserHandler("plugin_action", ...)` + a "Set Goal" UI affordance. This BYPASSES the known extension-slash-command routing bug (`docs/slash-command.md`) entirely — no dependency on the Path C RPC keeper.

The ONLY piece a plugin cannot own alone is turn injection, because `bridgeFollowUp` / `drainFollowupQueue` live in the main bridge. This change adds ONE reusable primitive there — `enqueueSystemFollowup(text)`, triggered by a generic `pi.events` listener — so the plugin (and any future plugin) can request a system-originated follow-up through the single existing drain path. This mirrors how flows coordinates via `pi.events.emit("prompt:register-adapter", …)` already handled in `bridge.ts`.

## What Changes

- **New monorepo package** at `packages/goal-plugin/`, published as `pi-dashboard-goal-plugin`. Ships `bridge/`, `server/`, and `client/` entries plus a `pi-dashboard-plugin` manifest (`id: "goal"`, `priority: 100`).
- **Required external extension (NOT vendored)** — `@ricoyudog/pi-goal-hermes` is installed as a pi extension and runs the whole loop in-session: judge (`evaluateWithJudge`), state persistence, `/goal` command, and its own continuation injection (`pi.sendMessage(…, { deliverAs: "followUp", triggerTurn: true })`). The plugin manifest declares `requires.piExtensions: ["@ricoyudog/pi-goal-hermes"]` so it activates only when the extension is installed — the honcho `pi-memory-honcho` model.
- **Thin plugin bridge entry** (`bridge/index.ts`) — subscribes to the extension's `pi-goal-hermes:event` custom messages (carry `status`/`goal`/`turnsUsed`/`maxTurns`/`lastVerdict`/`pausedReason` in `details`), normalizes each to a clean `goal_status` snapshot, and re-emits it to the plugin server over the bridge connection. Continuation injection stays owned by the extension; the plugin does not call `pi.sendUserMessage`.
- **Plugin server entry** (`server/index.ts`) — caches the latest `goal_status` per session (snapshot model, mirroring `queue_update` semantics), `broadcastToSubscribers` on change, replays the snapshot on browser (re)subscribe, and `registerBrowserHandler("plugin_action", …)` for set / pause / resume / done / clear / subgoal actions originating from the web UI.
- **Plugin client entry** (`client/`) — own reducer keyed on the plugin's `goal_status` message, a `GoalChip` slot component (`● Pursuing 4/20` · `⏸ Paused` · `✓ Achieved`), and a "Set Goal" control (input + pause/resume/clear buttons) that dispatches `plugin_action` over the existing plugin action bridge.
- **One core bridge primitive (safety net)** (`packages/extension/src/bridge.ts`) — add `enqueueSystemFollowup(text)`: pushes into `bridgeFollowUp` WITHOUT the `isAgentStreaming` gate, then schedules `drainFollowupQueue(0)`. Wire a `pi.events.on("dashboard:enqueue-followup", e => enqueueSystemFollowup(e.text))` listener. Generic infrastructure — not goal-specific. Retained as the collision-safe route for any plugin-routed continuation even though the required extension owns injection in v1.

## Capabilities

### New Capabilities
- `pi-dashboard-goal-plugin`: the plugin manifest (with `requires.piExtensions: ["@ricoyudog/pi-goal-hermes"]`), three entries, a thin bridge status-mirror over the extension's `pi-goal-hermes:event` messages, snapshot-broadcast goal status chip, and UI-driven goal control that bypasses slash routing.

### Modified Capabilities
- `bridge-followup-queue`: add a system-originated, ungated enqueue path (`enqueueSystemFollowup`) that routes through the existing single `drainFollowupQueue` so plugin-requested continuations cannot race or double-inject against user follow-ups.

## Impact

- **Monorepo package**: `packages/goal-plugin/` published as `pi-dashboard-goal-plugin`, part of the workspace npm publish flow alongside the other plugins.
- **Core touch**: one additive function + one `pi.events` listener in `packages/extension/src/bridge.ts`. No change to the shared protocol union, the shell `event-reducer.ts`, or the slash-command routing path.
- **Runtime dependencies**: `@blackbelt-technology/dashboard-plugin-runtime`, `@blackbelt-technology/pi-dashboard-shared`, `@mdi/js`, `@mdi/react`. Peer: React 19. Required pi extension (not a package dep): `@ricoyudog/pi-goal-hermes`, installed into pi.
- **Judge model**: owned by the `@ricoyudog/pi-goal-hermes` extension (fast secondary model, e.g. Haiku; `maxTurns` default 20). Configured at the extension, not the plugin.
- **Activation**: zero user config — default-enabled-when-no-config (`cfg?.enabled !== false`). Surfaced in Settings ▸ Plugins.
- **Surface scope**: the autonomous loop runs in any session whose bridge loads the plugin entry. Setting/controlling the goal from the web UI works in ALL session types (headless and terminal-hosted) because it uses `plugin_action`, not slash dispatch. A typed `/goal` in chat is explicitly OUT OF SCOPE for v1 (would still need the Path C RPC keeper / dead Path B).
- **Collision safety**: continuations and user follow-ups share ONE queue and ONE `drainFollowupQueue`; `isDraining` lock + one-entry-per-`agent_end` serialize them. Ordering (goal-back vs goal-front) is a design decision (default: back — user asks win).
- **Graceful degradation**: extension not installed → `requires.piExtensions` probe unsatisfied, plugin inactive, no chip. Installed but no goal set → no `pi-goal-hermes:event`, server caches nothing, chip hidden. Session reload while active → the extension pauses with reason `"reload"`; the paused snapshot surfaces in the chip, `resume` from the UI.
- **Known limitation (v1)**: image-bearing continuations not supported (continuations are text prompts); inherits the `bridgeFollowUp` text-only limitation.
