## Context

Current push system fires automatically for two events: `ask_user` (agent needs input) and `agent_end` with truthy `error` (agent crashed). A companion skill `push-notify-user` lets agents call `POST /api/push/send` on demand, but the skill instructs "use when the user asks" — agents never use it proactively.

The most common push use case — "task completed, notify me" — requires the user to either explicitly tell the agent or manually check the dashboard. There is no per-session control over push behavior.

Existing components: `PushDispatcher.fanout()` (fire-and-forget), `isPushTrigger` predicate, `buildPushPayload`, `PushNotificationsSection` (Settings UI), `StatusBar` (model/thinking selectors above input).

## Goals / Non-Goals

**Goals:**
- Per-session bell toggle (Off/On/Auto) in StatusBar, right-aligned next to Model/Thinking selectors
- Global push defaults in Settings → Push (toggle completion/errors/ask_user independently)
- Per-session prefs override global defaults for completion; errors/ask_user follow global settings
- Auto mode: extension registers `push_notify_user` tool with proactive description; agent decides
- Prefs are in-memory (session lifetime), reset on server restart
- Skill files removed from project (already done)

**Non-Goals:**
- Persisting per-session prefs across server restarts
- User-away detection (proximity sensing)
- New push channels (Telegram, email, etc.)
- Rich notification content beyond title/body/url
- Read/unread tracking for pushes

## Decisions

### Decision 1 — Bell placement: left side of StatusBar (with Model/Thinking)

The `StatusBar` component currently has ModelSelector + ThinkingLevelSelector on the left, and a status label on the right. The bell toggle goes in the left group, after ThinkingLevelSelector.

```
[Model ▼] [Thinking ▼] [🔔]              Generating… 🔄
```

Rationale: keeps the bell in a fixed position — not jumping when status text appears/disappears.

### Decision 2 — Three bell states: Off, On, Auto

| State | Icon | Behavior |
|-------|------|----------|
| Off | `mdiBellOutline` (gray) | Completion push disabled. Errors/ask_user follow global defaults. |
| On | `mdiBell` (blue/accent) | Completion push fires on `agent_end` (success). |
| Auto | `mdiBellCog` or `mdiBell` + dot | Extension registers `push_notify_user` tool; agent decides when to push. |

Toggle cycles: Off → On → Auto → Off. State stored per-session in server memory via `PushPrefs`:

```ts
interface PushPrefs {
  notifyCompletion: "off" | "on" | "auto";  // bell state
}
```

### Decision 3 — Global defaults include completion (off/on/auto)

Global defaults stored in `config.json` under `push.defaults`:

```json
{
  "push": {
    "enabled": true,
    "defaults": {
      "notifyErrors": true,
      "notifyAskUser": true,
      "notifyCompletion": "off"
    }
  }
}
```

`notifyCompletion` controls the default completion push behavior. New sessions inherit this default into their per-session `PushPrefs`. The bell toggle in StatusBar overrides the per-session value independently of the global default.

### Decision 4 — New sessions inherit global completion default

When a new session is registered (via `session_register`), its `PushPrefs` are initialized from `push.defaults.notifyCompletion`. The per-session bell toggle then overrides this value independently.

### Decision 5 — Auto mode: robot icon + tool via pi.registerTool

In Auto mode, the bridge extension registers a `push_notify_user` tool at `session_start`.

Auto icon: `mdiRobotOutline` (robot) — distinct from bell icons, does not imply unread state.

```ts
pi.registerTool({
  name: "push_notify_user",
  description: `Send a push notification to the user's devices.
    You SHOULD proactively call this tool when:
    - You complete significant work
    - You encounter errors you can't fix
    - You've been working without user interaction
    The user has enabled auto-push for this session and expects
    to be interrupted for important updates.
    Call POST /api/push/send with title and body.`,
  parameters: { ... },
  handler: async (args) => { /* curl to /api/push/send */ }
});
```

In Off/On mode, the tool is NOT registered. This replaces the removed skill entirely.

**Alternatives considered:**
- **System prompt injection**: pi extension API has no `injectSystemPrompt()`. Rejected.
- **Follow-up prompt after agent_end**: requires an extra agent turn (+cost, +latency). Rejected.
- **Keep skill + modify description**: skill is user-side, extension can't modify it at runtime. Rejected.

### Decision 6 — WS message: BrowserToServerMessage.set_push_prefs

```ts
// browser-protocol.ts
{ type: "set_push_prefs", sessionId: string, prefs: PushPrefs }
```

Server stores in `Map<sessionId, PushPrefs>`. Included in session state broadcast so reconnecting browsers see current state. No persistence — resets on restart.

**Live Auto-mode updates**: when `set_push_prefs` changes `notifyCompletion`, the server broadcasts the updated session state. The bridge extension listens for state changes and re-evaluates tool registration:
- Transition to Auto → register `push_notify_user` tool
- Transition away from Auto → unregister the tool
This ensures the agent's tool set reflects the current bell state even mid-session.

### Decision 7 — Trigger predicate expansion

`isPushTrigger` is defined in `packages/server/src/event-status-extraction.ts`. The fanout call site is in `packages/server/src/event-wiring.ts` (lines 225-233). Expanded:

```ts
function isPushTrigger(eventType, before, after, data, prefs?: PushPrefs): boolean {
  // ask_user transition — gated by global notifyAskUser
  if (isAskUserTransition(before, after)) {
    return globalDefaults.notifyAskUser;
  }
  // agent_end with error — gated by global notifyErrors
  if (eventType === "agent_end" && data?.error) {
    return globalDefaults.notifyErrors;
  }
  // agent_end success — gated by per-session notifyCompletion
  if (eventType === "agent_end" && !data?.error) {
    return prefs?.notifyCompletion === "on";
  }
  return false;
}
```

Auto mode does NOT trigger fanout for completion — the agent calls `push_notify_user` tool directly. Fanout still fires for errors/ask_user per global defaults.

### Decision 8 — Config for askUser timeout and push timeout are separate

No change. `config.push` block owns push defaults; `config.askUserPromptTimeoutSeconds` remains separate.

## Risks / Trade-offs

- **[Risk] Auto mode tool may not fire**: agent might forget to call `push_notify_user`. → Mitigation: tool description is explicit ("SHOULD proactively call"). If agent consistently fails, user can switch to On mode (guaranteed push) mid-session via live bell update.
- **[Risk] Push disabled/misconfigured**: when `push.enabled: false` or missing `contactEmail`, the bell toggle is hidden in StatusBar. Auto mode tool handlers return appropriate errors (same error codes as the removed skill: 401, 404, 503).
- **[Risk] In-memory prefs lost on restart** → Mitigation: documented as expected behavior. Server restart is rare; bell defaults to Off so no spam on restart.
- **[Trade-off] Bell only controls completion**: errors and ask_user are global-only. This simplifies the bell UX (one concern) but means per-session error suppression requires changing global defaults. → Accepted: errors are always important; per-session error suppression is an edge case.
- **[Trade-off] Tool vs skill**: migrating from skill to extension-registered tool means non-dashboard sessions lose push capability. → Accepted: push requires a running dashboard server; non-dashboard sessions can't use it anyway.
