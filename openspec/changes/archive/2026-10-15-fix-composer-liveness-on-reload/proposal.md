# Fix composer liveness on reload

## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/690

After a browser reload, a still-running session can show no composer Stop /
Force-Stop button while its card still shows the run in flight. The two
surfaces read different liveness sources:

- The composer derives working state from the chat event-reducer only —
  `isWorking = sessionStatus === "streaming" || retrying === true`
  (`packages/client/src/components/chat/CommandInput.tsx:270`), fed
  `sessionStatus={selectedState.status}` (`packages/client/src/App.tsx:2653`).
  `createInitialState()` seeds `status: "idle"`
  (`packages/client/src/lib/chat/event-reducer.ts:655`) and only a replayed
  `agent_start` flips it to `"streaming"`
  (`event-reducer.ts:1853-1855`).
- The card reads the server's `DashboardSession.status`; in the SAME composer
  strip `ComposerSessionActions` mixes both sources —
  `working={selectedSession.status === "streaming" || retrySessionIds.has(id)}`
  (`App.tsx:2619`), where the retry leg is reducer-derived
  (`packages/client/src/lib/session/retry-projection.ts:31-33`) and NOT gated
  on a terminal status, so a force-killed session in retry sleep reads
  "working" there. That server status is set from `agent_start`/`agent_end`
  (`packages/server/src/session/event-status-extraction.ts:91-95`) and is
  additionally repaired from bridge-reported agent liveness by
  `reconcileAgentLiveness` (`event-status-extraction.ts:186`, applied in
  `packages/server/src/event-wiring.ts:1469-1491`).

A browser reload replays stored events; it does not re-run the bridge's
mid-turn `agent_start` re-assert (`packages/extension/src/bridge.ts:1353-1356`,
which fires on BRIDGE reconnect only). When the run's `agent_start` is outside
the replay window, elided by the per-session trim, or otherwise not
re-delivered, the reducer stays `idle` and the user loses the only way to stop
a running agent. The server's status does not depend on what a browser replay
contains — it lives in the session manager and is additionally repaired by the
bridge's periodic liveness beat (`HEARTBEAT_INTERVAL = 15_000` ms,
`packages/extension/src/bridge-handlers/lifecycle.ts:52`) — so one of the two
sources is already correct.

## What Changes

- The composer's liveness input becomes a single derived value with an explicit
  precedence ladder. When the server holds a `DashboardSession.status` for the
  session it is authoritative: `"ended"` → `"ended"` (terminal), `"streaming"`
  → `"streaming"` (the backstop), `"idle"` / `"active"` → `"idle"` (overrides a
  reducer latched at `"streaming"` after a missed `agent_end`, which only the
  server-side heartbeat heal can repair). When the session is not in the live
  `sessions` map the reducer status is returned untouched. Full cell table in
  `design.md` D3.
- `CommandInput`'s `retrying` Stop leg (`CommandInput.tsx:270`) is suppressed
  when the composer status is `"ended"`, so a force-killed session in retry
  sleep shows no Stop/Force-Stop (`design.md` D6). The pending-prompt cancel
  (`pendingIdle`, `:793`) is kept: it is a cancel, required by
  `openspec/specs/optimistic-prompt/spec.md` "Cancel via Stop button".
- ONE working predicate — `composerStatus === "streaming" || (retrying &&
  composerStatus !== "ended")` — drives Stop / Force-Stop, stop-after-turn
  visibility, `ComposerSessionActions` `working` (`App.tsx:2619`) and — to
  keep chat-view's "same working definition on card and strip" — `SessionCard`
  `working` (`packages/client/src/components/session/SessionCard.tsx:930`), so
  a force-killed session in retry sleep no longer reads as working while Stop
  is hidden (`design.md` D7).
- The derived value feeds the composer surfaces that today read
  `selectedState.status` directly — `CommandInput` (Stop / Force-Stop /
  stop-after-turn / its stop-state machine / the plugin composer-panel slot),
  the `StatusBar` activity line above it, and the mobile info strip's working
  label (`App.tsx:2389-2394`) — so card and composer agree on liveness after
  reload. The transcript keeps the raw reducer state
  (`ChatView state={selectedState}`, `packages/client/src/App.tsx:2524`).
- `"active"` is explicitly NOT a liveness signal. It is the routine
  post-registration resting state (see the reconcile table in
  `openspec/specs/event-status-extraction/spec.md`), so a connected but idle
  session keeps showing Send, not Stop.
- The chat transcript stays purely event-sourced: no synthetic `agent_start`
  is injected into the reducer, so no streaming assistant bubble is fabricated.

## Capabilities

### Modified Capabilities

- `openspec/specs/play-stop-controls/spec.md` — Stop-button visibility gains
  the server-status backstop, server-status authority over a latched reducer,
  and the terminal gate on the retry Stop leg; "Killing state feedback" is restated against the
  reconciled value; a new requirement fixes the precedence ladder, the
  `"active"` exclusion, and the no-fabrication boundary.
- `openspec/specs/flow-controls/spec.md` — the stop-after-turn affordance is
  visible exactly when the Stop control's working predicate holds
  (`CommandInput.tsx:859` `showStopAfterTurn = isWorking && …`; D7), which
  includes a non-terminal retry; its optimistic pill clears when the reconciled
  status leaves `streaming` (`:327`). Available on a reload-recovered run. Wire protocol and bridge behaviour unchanged.
- `openspec/specs/composer-grammar-check/spec.md` — the auto-check
  "skipped while streaming" gate reads the session status handed to composer
  plugin panels (`CommandInput.tsx:1285` →
  `packages/dashboard-plugin-runtime/src/slot-consumers.tsx:324-344` →
  `packages/grammar-plugin/src/useGrammarCheck.ts:171`), which is now the
  reconciled value.

### New Capabilities

None.

## Non-goals

- Changing how the chat transcript renders a run (`ChatView` `turnActive`,
  `SessionState.isStreaming`, streaming bubbles stay event-derived).
- Fixing the replay window itself (lost `agent_start` in windowed replay / the
  per-session trim). That is the separately-scoped
  `preserve-agent-lifecycle-across-replay-gaps` work described in issue #690's
  spike comment; this change is the client-side backstop that makes the
  composer correct regardless of replay coverage.
- Server or protocol changes. No new field is added to `DashboardSession`;
  `status` already carries the reconciled truth.
- Read-only archived session opens (the composer is not rendered for them;
  `readOnly` computed at `App.tsx:2322`, gates at `App.tsx:2580` and `:2624`).
- The mobile action menu. `mobileActions` (`App.tsx:2357-2367`) exposes no
  `onAbort` / `onForceKill`, so there is no stop affordance there to reconcile.
  Known gap, separate work.
- Fixing the reducer's own `"streaming"` latch on a dead session beyond the
  composer: the precedence ladder makes the COMPOSER correct; other reducer
  consumers are untouched.

## Discipline Skills

- `systematic-debugging` — the defect is an intermittent replay race; the
  failing test must reproduce the divergence (reducer `idle` + server
  `streaming`) before the fix lands.
- `review-code` — non-trivial client change, run before commit.

## Impact

- `packages/client/src/App.tsx` (derive once inside `renderSessionDetail`,
  pass to `StatusBar` + `CommandInput` + the mobile info strip label; feed
  `ComposerSessionActions` `working` from the shared working predicate, D7).
- `packages/client/src/components/session/SessionCard.tsx` — `working` via the
  shared predicate (D7); no visual change outside the killed-in-retry case.
- `packages/client/src/lib/chat/` — new pure selector module (status ladder +
  working predicate) + unit tests.
- `packages/client/src/components/chat/CommandInput.tsx` — `isWorking` via the
  shared working predicate, i.e. terminal gate on the `retrying` leg (D6/D7) + prop docs; the prop shape (`"idle" | "streaming" | "ended"`) is unchanged, so
  `ComposerPanelSlot` consumers (`CommandInput.tsx:1285`) inherit the corrected
  value with no plugin change.
- `packages/grammar-plugin/`, `packages/dashboard-plugin-runtime/` — no code
  change; they receive the corrected value through the unchanged prop.
  Declared because their observable behaviour (auto-check skipping) shifts.
- Migration: none — client-only, no persisted state, no protocol field.
- Compatibility: older bridges that never report `agentRunning` are unaffected;
  the backstop reads `DashboardSession.status`, which every bridge version
  already drives through `agent_start`/`agent_end`.
- Rollback: revert the client commit; behaviour returns to reducer-only
  liveness. No data or protocol migration to undo.
- Residual risk: a server status latched at `"streaming"` after a lost
  `agent_end` would now also show a stale composer Stop. The card already shows
  that state today, and `reconcileAgentLiveness` heals it from the bridge's
  periodic beat (≤ 15 s) — not only on reconnect — while a bridge that stops
  beating entirely is declared dead by the gateway heartbeat watchdog
  (`HEARTBEAT_TIMEOUT = 180_000` ms, `packages/server/src/pi/pi-gateway.ts:40`),
  which ends the session (`status: "ended"`) and hides Stop via the ladder —
  worst case ≈ 180 s. (`openspec/specs/shared-protocol/spec.md` still says
  45 s: pre-existing spec/code drift, follow-up.) Making the server
  authoritative also costs a ≤ 15 s Stop-less window after a server restart
  mid-run (record re-seeded `active` until the first beat) — accepted (decision C2). A stale Stop click is not a
  pure no-op: it latches `AbortLatch` and calls `cachedCtx.abort()`
  (`packages/extension/src/bridge.ts:1459-1478`); the latch is cleared by the
  next user prompt, so it cannot cancel the user's next turn. Residual windows
  the backstop does not close are enumerated in `design.md` Risks.
