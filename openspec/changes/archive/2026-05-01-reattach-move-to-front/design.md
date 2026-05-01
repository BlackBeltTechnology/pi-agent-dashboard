## Context

The dashboard server keeps a per-cwd ordered list of session IDs (`sessionOrder`) that drives how cards are rendered in each folder group. Three signals can mutate this list:

1. **Spawn / fresh registration** — `session_register` for a brand new id → prepend.
2. **Resume of a previously-ended session** — handled by the `endedSessionIds` transition tracker in `server.ts`, gated by the `pendingResumeIntents` registry's 3-way contract (`"front"` | `"keep"` | `null`).
3. **Drag-and-drop reorder** — `reorder_sessions` message replaces the array verbatim.

The fourth case — **bridge auto-reattach across a dashboard restart** — was deliberately routed into outcome (2) with `null` intent so it preserves the user's drag order. That decision is correct in the abstract and wrong in practice: most users notice the dashboard restart precisely because they were watching the session it buries.

Per `preserve-session-order-on-reboot` (AGENTS.md): the reboot reconnection flow re-emits `session_register` for every still-alive session via the bridge's `sendStateSync`. The hook `event-wiring.ts onSessionRegistered` fires for every register. Today it only consumes pending attach-proposal intents.

The two missing-cards repro (`019de04a…` at index 10 in `pi-agent-dashboard`, `019dd157…` at index 2 in `pi-flows`) is the exact scenario this design targets.

## Goals / Non-Goals

**Goals:**
- Make a freshly-rebooted dashboard surface the still-alive sessions at the top of their folders by default.
- Give the bridge an explicit, non-heuristic way to declare a `session_register` is a reattach (not a spawn).
- Keep the user-facing override path simple — one `config.json` field, one settings dropdown.
- Preserve backwards compatibility with old bridges (omitting the new field MUST keep the existing behavior, not crash).

**Non-Goals:**
- Changing how spawn / fork / drag-resume / button-resume work. Those continue to use their existing intent paths.
- Persisting reattach intent across crashes. The signal is in-flight per WebSocket message — if the message arrives we apply policy, otherwise we fall back to "preserve".
- Auto-detecting reattach on the server via `process.uptime()` heuristics or pid-tracking (rejected — see Decisions).
- A new "active tier sort by activity" — that would be a different change touching client rendering rules, not server `sessionOrder`.

## Decisions

### D1. Bridge declares the reason; server does not infer it

**Decision**: Add `registerReason: "spawn" | "reattach"` to the `session_register` protocol message. The bridge sets it directly.

**Alternatives considered:**
- *Server infers via `pendingDashboardSpawns` / `pendingResumeIntents` lookup* — fragile. A spawn that completes after intent expires looks like a reattach. A reattach that races a manual resume looks ambiguous.
- *Server infers via "first register in this gateway connection"* — wrong for multi-session bridges where each session registers once per connection.
- *Server infers via "session id already known to sessionManager from persistence"* — wrong on cold-boot where the manager is empty pre-scan.

The bridge has a single boolean of state (`hasRegisteredOnce`) that disambiguates this perfectly. Putting truth at the source is cheaper and never wrong.

**Rationale**: AGENTS.md explicitly cites this kind of issue (the `null` intent ambiguity). The `intent` registry was the right shape for resume; for reattach we want the same shape — a typed, explicit signal — but on the protocol message itself rather than a side-channel registry. Reattach has no temporal gap between user-action and `session_register` (unlike resume, where the user clicks Resume and *then* the bridge re-registers seconds later), so a registry is unnecessary.

### D2. Default is `"always"`, not `"streaming-only"`

**Decision**: New config `reattachPlacement: "preserve" | "streaming-only" | "always"` defaults to `"always"`.

**Alternatives considered:**
- *Default `"streaming-only"`* — only surfaces sessions actively producing tokens. Misses the common case where the user was reading a finished response when the dashboard rebooted.
- *Default `"preserve"`* — keeps current behavior. But the user explicitly asked for the inverse default.

**Rationale**: Direct user instruction in the design conversation. The escape hatch is one config key for users who want the old behavior; users get the new behavior without doing anything.

### D3. `handleSessionChange` always tags `"spawn"`

**Decision**: The `handleSessionChange` path in `session-sync.ts` (used for new/fork/resume — all paths that mint a fresh sessionId) sets `registerReason: "spawn"`. Only `sendStateSync` after the first invocation per process tags `"reattach"`.

**Rationale**: A session change creates a **new id** that the server has never seen. By definition that's a spawn, regardless of whether the bridge process predates this dashboard run. Treating it as reattach would wrongly move-to-front sessions the user just forked.

### D4. Backwards compatibility — missing field means `"spawn"`

**Decision**: When the server receives a `session_register` without `registerReason`, it treats it as `"spawn"` (current behavior).

**Rationale**: Old bridges (pre-this-change) only send `session_register` on initial connect, which is functionally a spawn or attach-from-persisted-state-after-restart. Treating unknown as "preserve" matches what those bridges do today. After the user updates the bridge, they get the new behavior.

### D5. Policy lives on the server, not the bridge

**Decision**: The bridge always tags accurately (`"spawn"` or `"reattach"`). The `reattachPlacement` config is read by the server's `event-wiring.ts onSessionRegistered` hook to decide whether to call `moveToFront`.

**Rationale**: The bridge has no concept of user UI preferences; the server owns rendering policy. Multiple bridges may reconnect to one server — putting policy on the server means a single config switch governs all sessions.

### D6. Streaming-only check uses the **prior** session status, captured before `register()` coerces it

**Decision**: For the `"streaming-only"` branch, the helper reads `priorStatus` (the value of `session.status` *before* `register()` overwrote it to `"active"`). If `priorStatus === "streaming"`, move to front; otherwise leave alone. When `priorStatus` is undefined (first-ever register, or paths that don't carry it), fall back to the post-register `session.status`.

**Rationale**: `memory-session-manager.ts::register` unconditionally sets `status: "active"` on every register — the design originally claimed "post-register status" but failed to account for this coercion, which would have made `"streaming-only"` silently equivalent to `"preserve"`. The fix is to capture `existing?.status` inside `register()` before assembling the new session record, then pass it into the `OnChangeContext` so the policy helper can see what the session was actually doing when the dashboard went down.

**Implementation**: `OnChangeContext.priorStatus` carries the captured value; `server.ts onChange` forwards it to `applyReattachPolicy(... , priorStatus)`; the helper computes `effectiveStatus = priorStatus ?? session.status` and feeds that into `decideReattachAction`. Pinned by a regression test in `reattach-placement.test.ts`.

## Risks / Trade-offs

- **Risk**: Users with carefully-curated drag orders will see them shuffled on the next dashboard restart.
  **Mitigation**: One config value (`reattachPlacement: "preserve"`) restores the old behavior. Settings UI exposes the dropdown so the discovery cost is low. CHANGELOG entry calls out the default change.

- **Risk**: A bridge bug that incorrectly tags every register as `"reattach"` would shuffle order on every spawn.
  **Mitigation**: The `hasRegisteredOnce` flag is module-private state on `BridgeContext`; impossible to flip externally. Unit tests pin the flag transition (`false` → `true` exactly once on first `sendStateSync`, regardless of session-change path).

- **Trade-off**: The protocol message grows by one optional field. This is the third such addition (after `pid`, `eventCount`, `firstMessage`); the message is intentionally extensible.

- **Trade-off**: Three policy values feels like over-design for a one-user feature. We chose three because the user explicitly asked for the config flag to expose all three points on the spectrum (`preserve` for the old behavior, `streaming-only` for cautious users, `always` for the new default).

## Migration Plan

1. Land protocol field as **optional** so the server tolerates pre-update bridges.
2. Land server policy default `"always"` — no-op for old bridges (they never tag `"reattach"` so reattach still hits the old `null` intent path).
3. Land bridge change tagging `"reattach"` — requires `npm run reload` after deploy to pick up; users who don't reload keep the old behavior until they restart their pi sessions.
4. Land settings UI dropdown.
5. CHANGELOG entry under `## [Unreleased]`.

**Rollback**: Set `reattachPlacement: "preserve"` in `~/.pi/dashboard/config.json` and `pi-dashboard restart`. No data migrations to undo.

## Open Questions

None — the user has explicitly chosen the default and the policy options.
