## Why

Push notifications currently fire automatically only for errors and `ask_user` prompts. The most common scenario — "I started a long task, walked away, want to know when it's done" — requires either remembering to tell the agent ("notify me when done") or manually checking the dashboard. The `push-notify-user` skill exists but the agent never uses it proactively because the skill instructs "use when the user asks." We need per-session control over push behavior and a way for the agent to proactively decide when to notify.

## What Changes

- **Add per-session bell toggle** in StatusBar (next to Model/Thinking selectors). Three states:
  - **Off**: completion pushes disabled (default). Errors and `ask_user` still fire per global defaults.
  - **On**: completion push fires automatically on `agent_end` (no error).
  - **Auto**: extension registers a `push_notify_user` tool with proactive description; agent decides when to push.
- **Add global push defaults** in Settings → Push section: toggle errors, ask_user, and completion (off/on/auto). New sessions inherit the global completion default; per-session bell overrides it.
- **Remove `push-notify-user` skill** from `.pi/skills/` and extension bundle. Replaced by extension-registered tool in Auto mode.
- **Modify push trigger predicate** to consider per-session `PushPrefs` (merged with global defaults) when deciding whether to fanout.
- **New WS message** `set_push_prefs` for browser→server per-session preference updates.
- **In-memory only**: prefs live for session lifetime, reset on server restart.

## Capabilities

### New Capabilities
- `per-session-push-prefs`: per-session push preference state with bell toggle (Off/On/Auto), global defaults in Settings, and WS-based updates.
- `agent-proactive-push`: extension-registered `push_notify_user` tool with description keyed to Auto mode, encouraging agent to proactively decide when to notify.

### Modified Capabilities
- `push-notifications`: trigger predicate expanded to include `agent_end` (success) when per-session prefs allow; skill removed from bundle; `buildPushPayload` accepts prefs; `isPushTrigger` considers per-session overrides.

## Impact

- `packages/client/src/components/StatusBar.tsx` — add BellToggle component
- `packages/client/src/App.tsx` — wire bell toggle props
- `packages/client/src/components/PushNotificationsSection.tsx` — add global defaults UI
- `packages/server/src/event-wiring.ts` — pass per-session prefs to push dispatch
- `packages/server/src/push/build-push-payload.ts` — accept PushPrefs, produce completion-appropriate title/body
- `packages/server/src/push/push-types.ts` — add PushPrefs type
- `packages/server/src/browser-handlers/` — new handler for `set_push_prefs`
- `packages/server/src/event-status-extraction.ts` — modify `isPushTrigger` predicate
- `packages/extension/src/bridge.ts` — register `push_notify_user` tool at session_start, key description to bell state
- `packages/extension/package.json` — remove push-notify-user skill reference (done)
- `.pi/skills/push-notify-user/` — removed (done)
- `packages/shared/src/browser-protocol.ts` — add `set_push_prefs` message type
