# Tasks

## 1. Core bridge primitive (`bridge-followup-queue`) — SAFETY NET
- [x] 1.1 Add `enqueueSystemFollowup(text)` in `packages/extension/src/bridge.ts` — ungated push to `bridgeFollowUp` (respect `FOLLOWUP_QUEUE_CAP`, `isDraining`), then `setTimeout(() => drainFollowupQueue(0), 0)` → verify: unit test pushes after `agent_end` (gate closed) and asserts one fresh-turn `sendUserMessage`
- [x] 1.2 Register `pi.events.on("dashboard:enqueue-followup", e => enqueueSystemFollowup(e.text))` → verify: emitting the event ships the entry
- [x] 1.3 Test: user follow-up + system follow-up at same `agent_end` ship one-per-`agent_end`, no double `sendUserMessage` race → verify: call-count assertions on stub pi (`bridge-system-followup.test.ts`, 7 passing)
- [x] 1.4 Document `dashboard:enqueue-followup` + plugin bridge↔server channel in `docs/architecture.md` (delegated, caveman) → verify: "Plugin bridge↔server channel (generic)" section added

> Architecture pivot: judge core is NOT vendored. `@ricoyudog/pi-goal-hermes` is installed as a pi extension and runs the loop + its own continuation injection. `enqueueSystemFollowup` stays as generic safety-net infrastructure for any plugin-routed continuation.

## 1b. Plugin bridge→server infra (NEW — enables server-snapshot design)
Discovered during apply: plugin servers had no push channel from a bridge entry (`registerPiHandler` was a no-op stub; `eventStore` poll-only). Built the missing infra.
- [x] 1b.1 Add `PluginPiMessage` (`type:"plugin_pi_message"`, `pluginId`/`messageType`/`payload`) to `ExtensionToServerMessage` union in `packages/shared/src/protocol.ts` → verify: tsc clean
- [x] 1b.2 Main bridge forwards `pi.events.on("dashboard:plugin-message")` → `connection.send({type:"plugin_pi_message",…})` (`packages/extension/src/bridge.ts`) → verify: tsc clean
- [x] 1b.3 Real `registerPiHandler(type,handler)` registry + `onEvent(handler)` raw-event subscription on `ServerPluginContext` (`server-context.ts`, `server.ts`) replacing the no-op stub → verify: tsc clean, loader test green
- [x] 1b.4 `event-wiring.ts` dispatches `plugin_pi_message` to registered handlers by `messageType` and fans `event_forward` out to `onEvent` subscribers → verify: tsc clean
- [x] 1b.5 `sendToSession(sessionId,text)` capability on `ServerPluginContext` (wraps `piGateway.sendToSession` send_prompt) so plugin servers dispatch `/goal …` commands into a session → verify: tsc clean, loader test green

## 2. Plugin scaffold (`pi-dashboard-goal-plugin`)
- [x] 2.1 Create `packages/goal-plugin/` with `package.json` + tsconfig + vitest + configSchema → verify: `npm install` resolves, generator discovers `goal`
- [x] 2.2 Write `pi-dashboard-plugin` manifest: `id:"goal"`, `displayName:"Goal"`, `priority:100`, `bridge`/`server`/`client` entries + `requires.piExtensions` → verify: generated plugin-registry includes goal
- [x] 2.3 Confirm manifest validates against `manifest-validator` → verify: `manifest.test.ts` green (5 tests)

## 3. Require external judge extension (no vendoring)
- [x] 3.1 Declare `requires.piExtensions: ["@ricoyudog/pi-goal-hermes"]` in the manifest (mirror honcho `pi-memory-honcho`) → verify: `manifest.test.ts` asserts requires.piExtensions; runtime `/api/plugins` gating is manual
- [x] 3.2 Document installing the extension (`pi extension add @ricoyudog/pi-goal-hermes`) + judge model + `maxTurns` ownership in `packages/goal-plugin/README.md` → verify: README present

## 4. Thin plugin bridge entry (status mirror)
- [x] 4.1 `bridge/index.ts`: subscribe via `pi.on("message_end")` to the extension's `pi-goal-hermes:event` custom messages → verify: handler filters customType + details
- [x] 4.2 Map each event (`detailsToSnapshot`) to a clean `goal_status` snapshot and emit `dashboard:plugin-message` → verify: `goal-state.test.ts` mapping (10 tests)
- [x] 4.3 (safety net) `enqueueSystemFollowup` infra present in main bridge; extension's own `deliverAs:"followUp"` injection remains primary → verify: `bridge-system-followup.test.ts`
- [ ] 4.4 Reload/abort states already handled by the extension (pause reason `"reload"` / interrupted) flow through as `paused` snapshots → verify: manual reload + abort surface paused in the chip

## 5. Plugin server entry
- [x] 5.1 `server/index.ts`: cache latest `goal_status` per session; `broadcastToSubscribers` a `plugin_event` on change → verify: typecheck + registry load
- [ ] 5.2 Replay cached snapshot on browser (re)subscribe → DEFERRED: needs a browser-subscribe hook in ServerPluginContext; pi-goal-hermes:event messages already replay via eventStore so chip self-heals on reconnect
- [x] 5.3 `registerBrowserHandler("plugin_action", …)` maps set/pause/resume/done/clear/subgoal → `/goal …` and dispatches via `sendToSession` (bridge routes slash → extension command, Path C keeper for headless) → verify: typecheck + `goalCommandFor` mapping. Terminal-hosted slash routing is the documented v1 limit.
- [x] 5.4 `registerPiHandler("goal_status", handler)` receives the bridge-mirrored snapshot (infra from 1b) → verify: typecheck; envelope round-trips bridge→server

## 6. Plugin client
- [x] 6.1 Own reducer (`deriveSnapshot`) keyed on the plugin `goal_status` event (via `useSessionEvents`); shell routes `plugin_event` → `publishSessionEvent` → verify: `goal-state.test.ts` folding
- [x] 6.2 `GoalChip` slot component: `● Pursuing n/m` / `⏸ Paused · reason` / `✓ Achieved`; hidden when no goal; `hasGoal` predicate → verify: `GoalChip.test.tsx` (5 render tests)
- [x] 6.3 `GoalControl` (session-card-action-bar): empty→input+Set goal, active→Pause/Done/Clear, paused→Resume/Clear; dispatches `plugin_action` → verify: `GoalControl.test.tsx` (3 dispatch tests)
- [x] 6.4 Compose existing dashboard tokens/primitives only → verify: GoalChip uses `--text-*` vars + theme-reactive palette like JjWorkspaceBadge

## 7. Integration + collision safety
- [ ] 7.1 End-to-end: set goal from UI → loop runs headless → chip updates → judge "done" stops it → verify: manual run in a dashboard-spawned session
- [ ] 7.2 Collision test: queue a user follow-up mid-goal-turn → exactly one fresh turn per `agent_end`, no double-prompt → verify: assertion + manual
- [ ] 7.3 Works in terminal-hosted session for UI control (no slash dependency) → verify: tmux session set/pause from web UI
- [ ] 7.4 Graceful: uninstall plugin → no chip, no continuations, user follow-ups intact → verify: restart without plugin

## 8. Docs + publish
- [x] 8.1 Add all 11 `packages/goal-plugin/` rows + infra-change appends to `docs/file-index-*.md` (delegated, caveman) → verify: 11 rows present, path-alphabetical; 5 splits annotated
- [x] 8.2 Plugin README: activation, judge model ownership, v1 scope (headless-only control, no typed `/goal`) → verify: `packages/goal-plugin/README.md`
- [x] 8.3 Add `@blackbelt-technology/pi-dashboard-goal-plugin` to `.github/workflows/publish.yml` PACKAGES → verify: `publish-allowlist-complete.test.ts` green
