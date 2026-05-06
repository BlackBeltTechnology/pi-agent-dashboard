## MODIFIED Requirements

### Requirement: Push trigger predicate (separate from unread)

The dashboard server SHALL use a dedicated `isPushTrigger` predicate — distinct from `isUnreadTrigger` — that matches events requiring user attention. The predicate SHALL accept per-session `PushPrefs` and global push defaults to determine which events trigger pushes.

Events that MAY trigger pushes:
- `ask_user` (agent needs input) — gated by global `push.defaults.notifyAskUser`
- `agent_end` with truthy `payload.error` (agent crashed) — gated by global `push.defaults.notifyErrors`
- `agent_end` without error (agent finished successfully) — gated by per-session `PushPrefs.notifyCompletion === "on"`

When `PushPrefs.notifyCompletion === "auto"`, successful `agent_end` SHALL NOT trigger fanout (agent handles via tool).

Routine `streaming→idle` transitions SHALL NOT trigger pushes.

The `ask_user` trigger is **transition-based**: it fires when `currentTool` changes to `"ask_user"` from a non-`"ask_user"` value. A repeated question while `currentTool` is already `"ask_user"` SHALL NOT fire an additional push.

**Gating** (push is suppressed when):
- A browser has viewed the session within the last 60 seconds (`viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})` returns true)
- Event is a replay (historical re-emission)
- Both gates SHALL be evaluated at the same call site in `event-wiring.ts`, co-located with the unread-stripes evaluation

#### Scenario: Agent waits for user input → push fired
- **WHEN** `currentTool` transitions to `"ask_user"` AND global `notifyAskUser` is true AND no browser has viewed in the last 60s AND event is not a replay
- **THEN** `pushDispatcher.fanout(sessionId, sessionAfter, event)` SHALL be called exactly once

#### Scenario: Agent crashes → push fired
- **WHEN** an `agent_end` event arrives with truthy `payload.error` AND global `notifyErrors` is true under the same gating
- **THEN** `fanout(sessionId, sessionAfter, event)` SHALL be called exactly once

#### Scenario: Agent finishes successfully with bell On → push fired
- **WHEN** an `agent_end` event arrives without error AND session `PushPrefs.notifyCompletion` is `"on"` under the same gating
- **THEN** `fanout(sessionId, sessionAfter, event)` SHALL be called exactly once

#### Scenario: Agent finishes successfully with bell Off → NO push
- **WHEN** an `agent_end` event arrives without error AND session `PushPrefs.notifyCompletion` is `"off"`
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Agent finishes successfully with bell Auto → NO fanout
- **WHEN** an `agent_end` event arrives without error AND session `PushPrefs.notifyCompletion` is `"auto"`
- **THEN** `fanout` SHALL NOT be called (agent handles via tool)

#### Scenario: Agent finishes a turn → NO push
- **WHEN** a session transitions from `streaming` to `idle`
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Global notifyAskUser disabled → ask_user push suppressed
- **WHEN** global `push.defaults.notifyAskUser` is false
- **THEN** `ask_user` transitions SHALL NOT trigger fanout

#### Scenario: Global notifyErrors disabled → error push suppressed
- **WHEN** global `push.defaults.notifyErrors` is false
- **THEN** `agent_end` with error SHALL NOT trigger fanout

#### Scenario: Browser viewed within 60s → push suppressed
- **WHEN** a push trigger fires AND `viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})` returns true
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Browser last viewed >60s ago → push fires
- **WHEN** a push trigger fires AND last view was >60s ago
- **THEN** `fanout` SHALL be called

#### Scenario: Replay event → no push
- **WHEN** a replay-flagged event matches a push trigger
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Non-push-worthy unread trigger → only unread broadcast
- **WHEN** `isUnreadTrigger` matches but `isPushTrigger` does not (e.g. `streaming→idle`)
- **THEN** the unread broadcast SHALL fire normally; `pushDispatcher` SHALL NOT be called

### Requirement: Build push payload accepts push prefs

`buildPushPayload` SHALL accept an optional `PushPrefs` parameter. When the trigger is `agent_end` (success) and `prefs.notifyCompletion === "on"`, the payload SHALL use a completion-appropriate title and body. The gating logic (whether to fire at all) SHALL remain in `isPushTrigger` — `buildPushPayload` only determines the payload shape, not whether a push should be sent.

#### Scenario: Completion push payload
- **WHEN** `buildPushPayload(session, event, { notifyCompletion: "on" })` is called for a successful `agent_end`
- **THEN** the payload SHALL have title "Session completed" and body including session name

#### Scenario: Error push payload unchanged
- **WHEN** `buildPushPayload` is called for an `agent_end` with error, regardless of prefs
- **THEN** the payload SHALL have error-appropriate title and body (existing behavior)

## REMOVED Requirements

### Requirement: Push-notify-user skill with error handling

**Reason**: Replaced by extension-registered `push_notify_user` tool in Auto mode (see `agent-proactive-push` spec). The skill instructed agents "use when the user asks," which prevented proactive use. The extension tool provides dynamic descriptions based on bell state and encourages proactive push decisions.

**Migration**: The skill files at `.pi/skills/push-notify-user/` and extension bundle reference in `packages/extension/package.json` have been removed. Agents in Auto mode now use the extension-registered `push_notify_user` tool. Non-dashboard sessions lose push capability (acceptable — push requires running dashboard server).
