## 1. Data model & config

- [x] 1.1 Add `PushPrefs` type to `push-types.ts`: `{ notifyCompletion: "off" | "on" | "auto" }`
- [x] 1.2 Add `PushDefaults` to config type: `{ notifyErrors: boolean, notifyAskUser: boolean }` with defaults `{ true, true }`
- [x] 1.3 Add `push.defaults` config normalization in server config loader
- [x] 1.4 Add `set_push_prefs` message type to `browser-protocol.ts`
- [x] 1.5 Create in-memory `Map<sessionId, PushPrefs>` in server, init to `{ notifyCompletion: "off" }` on session creation

## 2. Server push preferences & trigger

- [x] 2.1 Create `set_push_prefs` browser handler — receives WS message, updates in-memory map, broadcasts session update
- [x] 2.2 Include `pushPrefs` in session state broadcasts (subscribe replay + updates)
- [x] 2.3 Modify `isPushTrigger` predicate to accept per-session `PushPrefs` and global defaults
- [x] 2.4 Add `agent_end` success trigger gated by `pushPrefs.notifyCompletion === "on"`
- [x] 2.5 Gate `ask_user` trigger on global `push.defaults.notifyAskUser`
- [x] 2.6 Gate `agent_end` error trigger on global `push.defaults.notifyErrors`
- [x] 2.7 Update `buildPushPayload` to accept `PushPrefs` and produce completion-appropriate title/body ("Session completed")
- [x] 2.8 Wire `pushPrefs` lookup in `event-wiring.ts` fanout call site

## 3. Client — Bell toggle UI

- [x] 3.1 Create `BellToggle` component with three-state cycle (Off → On → Auto → Off)
- [x] 3.2 Render `BellToggle` in `StatusBar`, right-aligned between controls and status label
- [x] 3.3 Hide bell for ended sessions
- [x] 3.4 Wire bell click → `set_push_prefs` WS message with optimistic UI update
- [x] 3.5 Read bell state from session state on mount/subscribe replay
- [x] 3.6 Wire `pushPrefs` into `App.tsx` state for `selectedSession` and pass to `StatusBar`

## 4. Client — Global defaults in Settings

- [x] 4.1 Add two toggles + completion dropdown to `PushNotificationsSection`: notifyErrors, notifyAskUser, notifyCompletion
- [x] 4.2 Wire controls to config save (PATCH config.json push.defaults)
- [x] 4.3 Read current defaults on mount from config
- [x] 4.4 Hide bell toggle in StatusBar when push is disabled or misconfigured

## 5. Extension — Auto mode tool registration

- [x] 5.1 At `session_start`, read session `pushPrefs` from session state broadcast
- [x] 5.2 When `notifyCompletion === "auto"`, register `push_notify_user` tool via `pi.registerTool()` with proactive description
- [x] 5.3 Implement tool handler: read config, POST to `/api/push/send`, handle all error codes (401, 404, 503, 429, empty results)
- [x] 5.4 When `notifyCompletion !== "auto"`, skip tool registration
- [x] 5.5 On session switch/fork, re-evaluate bell state and re-register tool
- [x] 5.6 Listen for session state broadcast updates; on bell change: Off/On→Auto registers tool, Auto→Off/On unregisters tool

## 6. Cleanup

- [x] 6.1 Remove `.pi/skills/push-notify-user/` directory (done)
- [x] 6.2 Remove `push-notify-user` from `packages/extension/package.json` skills and files arrays (done)
- [x] 6.3 Remove `push-notify-user` row from `AGENTS.md` Key Files table
- [x] 6.4 Update `docs/architecture.md` push-notify-user references if any

## 7. Tests

- [x] 7.1 BellToggle unit test: three-state cycle, WS message on click, hidden for ended/disabled sessions
- [x] 7.2 Push prefs handler test: set_push_prefs updates map, broadcasts state, rejects invalid enum values
- [x] 7.3 isPushTrigger test: completion On/Off/Auto, global toggles, gating
- [x] 7.4 buildPushPayload test: completion payload when prefs.on, error payload unchanged
- [x] 7.5 PushNotificationsSection test: global default toggles (errors, ask_user persistence)
- [x] 7.6 push-notify-user tool handler test: success, unreachable, 401, 404, 503, 429, empty results
- [x] 7.7 Auto mode test: tool registered with proactive description, Off/On mode test: tool NOT registered
- [x] 7.8 Live bell change test: Off→Auto registers tool, Auto→On unregisters tool
- [x] 7.9 Existing push tests continue to pass (no regression)
