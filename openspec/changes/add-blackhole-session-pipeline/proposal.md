## Why

Split out of `add-blackhole-plugin` after five adversarial review cycles. That change ships the global settings surface for `pi-blackhole`; this one carries the per-session pipeline surface, which is **blocked on a platform gap** and should not hold up the settings work.

The value is real: `<sessionId>-pending.json` holds worker cursors and unflushed batch counts that are invisible from anywhere in the dashboard today, and `pi-blackhole-cooldown.json` records which model a worker actually fell back to. A user running several sessions has no way to see that a memory pipeline is degraded or stalled.

## Blocker — per-session capability data is not delivered for unselected sessions

A `session-card-*` claim whose **visibility** depends on per-session runtime state cannot be gated correctly today:

- `commands_list` and `flows_list` reach the browser via `browserGateway.sendToSubscribers(sessionId, …)`.
- Every `subscribe` send site is bound to `selectedId` (`packages/client/src/App.tsx:907, 1569, 1591`); there is no bulk subscribe.
- `session_added` / `session_updated` / `session_removed` **are** broadcast to all clients, but carry `DashboardSession`, which has no field describing loaded extensions or commands.
- The server holds the truth for every session (`sessionCommandRegistry.retain`), so the gap is purely client-side delivery.
- `useSlotHasClaimsForSession` calls `shouldRender` synchronously during render and subscribes to nothing, so a late-arriving signal does not re-render the wrapper.

`flows-plugin` has the same hole (`FlowsSubcard`); `fix-empty-flows-subcard` is the scar. This is a platform limitation, not a blackhole one.

## Five gate mechanisms were attempted and rejected

Recorded so the next attempt does not repeat them:

| # | Mechanism | Why it failed |
|---|---|---|
| 1 | `requires.piExtensions` deactivates the plugin | It does not. `loader.ts` keeps unsatisfied plugins loaded; `missingRequirements` is consumed only by the Packages UI. Only the enabled-set filter drops claims. |
| 2 | Plugin keeps an installed-flag cache | No feeder. `missingRequirements` is not in the plugin-facing surface. |
| 3 | Plugin self-publishes via `publishSessionData` | Called only by the host (`useMessageHandler.ts:475,482`); zero plugin precedent. The gate layer subscribes to nothing, so it would never re-render. |
| 4 | Read host-published `commandsList` | Delivered only for the subscribed session — a permanent false negative on every other card. Also depends on a bare `blackhole` command whose registration form is unverifiable. |
| 5 | Module-level fetch at boot, global installed-check | Delivery layer verified sound, but: a module-level `fetch` breaks the jsdom test suite; directory existence means "has run once", not "is installed"; no re-render path for idle/ended sessions; no retry, so a transient failure is permanent. |

Mechanism 5 is the closest. Its delivery path (eager static import of the client entry, plugin server route mounted before `listen`, synchronous `shouldRender`) is confirmed correct. What it still needs: the authoritative installed signal (`requirement-probes.ts` uses a caller-supplied `listInstalled()` reusing pi's package registry — the plugin's own server route can ask the same source), an environment guard so the boot fetch does not run under vitest, a retry path, and a re-render nudge for sessions that never broadcast again.

## What Changes

- Adds the `session-card-memory` claim and the `content-view` drill-in to the existing `blackhole` plugin package created by `add-blackhole-plugin`.
- Adds `GET /api/plugins/blackhole/session/:id`, returning per-session cursors and pending state plus the global fields the subcard needs.
- Adds the visibility gate, once a sound mechanism exists.

## Capabilities

### New Capabilities

- `blackhole-plugin-session-pipeline`: the per-session surface — subcard states, the session-id join, the approximate proximity meter and its presentation constraints, and the `content-view` drill-in. Spec already drafted and reviewed; the gate requirements are the part awaiting a mechanism.

### Modified Capabilities

<!-- None yet. If the chosen fix is a host-side per-session capability signal, this
     section gains a delta against the relevant platform capability — that is a
     legitimate platform change to argue on its own merits, which is precisely why
     it was split out of the plugin change rather than smuggled into it. -->

## Impact

Depends on `add-blackhole-plugin` having landed (package, shared config model, server scaffolding). Adds no new dependency. Touches no existing package **unless** the gate is resolved by a host-side signal, in which case it touches `packages/client/` and `packages/shared/` and needs a delta spec.

## Discipline Skills

- `doubt-driven-review` — the gate mechanism has failed five times; the next candidate gets reviewed before it is written into tasks.
- `scenario-design` — deferred until the gate is resolved; scenarios folded onto an unsettled mechanism would be rework.
- `security-hardening` — the per-session route interpolates a session id into a filename.
