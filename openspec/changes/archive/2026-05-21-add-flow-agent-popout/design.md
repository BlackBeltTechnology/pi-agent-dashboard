## Context

Two long-running problems converge in this change:

1. **No mechanism for plugin-owned URL routes.** Today, `App.tsx` directly imports `SubagentPopoutPage` from the subagents-plugin, calls `useRoute("/session/:sessionId/subagent/:agentId")`, decodes params, runs a cold-open subscribe effect, and dispatches the popout in BOTH the desktop top-level overlay switch AND the mobile `MobileShell.detailPanel`. The flow agent popout would replicate every step for `/session/:sid/flow/:flowId/agent/:agentId`. Both routes are plugin-owned but live in shell code. Adding a third plugin overlay route would mean a third copy. Each copy is also a structural trap — wouter's strict matching means nesting the route inside `selectedId`-gated JSX silently breaks it (the bug `fix-subagent-popout-desktop-dispatch` was originally written to patch).

2. **Subagent state lives in the shell, not the plugin.** `SessionState.subagents: Map<string, SubagentState>` is populated by four `case "subagent_*"` arms inside `packages/client/src/lib/event-reducer.ts` plus an `entry_persisted` backfill. The subagents-plugin reads from this shell field. By contrast, the flows-plugin owns its own reducer + `useFlowsSessionState(sessionId)` context — established by `pluginize-flows-via-registry`. Until we mirror that for subagents, any subagent popout claim needs to reach into shell state, defeating the plugin boundary.

This change fixes both at once by:

- Introducing a `shell-overlay-route` slot in the frozen plugin taxonomy.
- Adding a `useShellSession(sessionId)` primitive in `dashboard-plugin-runtime` so claims can read session **metadata** (cwd, label) without coupling to internal state.
- Moving subagent reducer + state into the subagents-plugin (mirror of flows-plugin).
- Declaring `shell-overlay-route` claims in BOTH the subagents-plugin and the flows-plugin manifests.
- Stripping App.tsx of all per-route plugin-page code; mounting one generic `<ShellOverlayRouteSlot>` per layout.

`MinimalChatView` (from the prior `extract-minimal-chat-view` change) is the body renderer that both `FlowAgentDetail` and `SubagentDetailView` already wrap.

## Goals / Non-Goals

**Goals:**

- App.tsx contains zero imports of plugin popout pages and zero plugin-owned `useRoute` calls.
- Per-route shell code (param decoding, cold-open subscribe, dispatch arm) is removed; the plugin claim owns all of it.
- Subagent state lives entirely in the subagents-plugin.
- The `shell-overlay-route` slot is reusable for any future plugin overlay route (no per-route hand-wiring).
- Existing `SubagentPopoutPage` continues working — the migration is structural, not user-visible.

**Non-Goals:**

- Not redesigning the popout chrome or visual treatment.
- Not changing on-the-wire types (`subagent_*` events, `prompt_request` payload, etc.).
- Not generalising the slot to arbitrary nested routes (e.g. `/foo/:bar/baz/:qux`) — V1 supports any wouter-pattern path, just doesn't ship special tooling beyond that.
- Not adding a plugin-owned mobile-tab-bar slot or shell-sidebar slot. Out of scope.
- Not migrating `FileDiffView` (`/session/:id/diff`) into the slot system. It is shell-built-in, not a plugin page. Existing diff dispatch in App.tsx stays.

## Decisions

### Decision 1 — Slot name `shell-overlay-route`, multiplicity `many`, payload `react-only`

The name reads as "overlay (full-screen) route mounted at the top of the shell". Multiplicity is `many` because every plugin can declare multiple paths and multiple plugins can coexist. Payload is `react-only` because the slot consumer needs a React component to render with slot props.

Rejected alternatives:

- `route` (too generic — conflicts with the existing `command-route` slot, which is for slash-command-triggered content views inside a session).
- `shell-route` (ambiguous — could read as "any shell route", but the shell owns its own non-plugin routes like settings).
- `overlay` (too generic; doesn't say "URL route").

### Decision 2 — `config.path` instead of a top-level `path` field

`PluginClaim` already supports `config: Record<string, unknown>` as the slot-specific extra-config bucket. The path lives there. We could promote `path` to a top-level claim field (parallel to `command`, `toolName`, `trigger`), but:

- It's slot-specific. Promoting it would expand `PluginClaim` for every consumer when only `shell-overlay-route` uses it.
- `command` was promoted because two slots (`command-route`, hypothetical future) might share it. `path` doesn't have that future.
- Validator inspects `claim.config?.path` cheaply.

If the path becomes load-bearing for a second slot, promote it then.

### Decision 3 — `config.sessionParam` default of `"sid"`

The slot consumer needs to know which URL param holds the session id so it can resolve `session: DashboardSession` via `useShellSession()`. Defaulting to `"sid"` matches the flow popout claim's path (`/session/:sid/...`). The subagents claim uses `:sessionId` (legacy) so it sets `config.sessionParam: "sessionId"` explicitly.

Alternative considered: always require the param to be named `:sid`. Rejected — would force the subagents-plugin to break its URL contract just for naming uniformity. Backward compat for the existing subagent popout URL takes precedence.

### Decision 4 — Claim ordering: `(plugin.priority asc, plugin.id asc)`, first wouter match wins

Matches the existing claim ordering rule used by every other slot in the runtime. There is no per-claim priority within a plugin — adding two `shell-overlay-route` claims in the same plugin means whichever's path matches first (in path-array order) wins.

This is deterministic because route patterns for plugin overlays don't realistically overlap (e.g. `/session/:sid/subagent/:aid` vs `/session/:sid/flow/:flowId/agent/:agentId` — no URL matches both). If overlap ever happens, plugin priority is the tiebreaker.

### Decision 5 — `useShellSession` is the ONLY new shell-boundary primitive

We could have added `useShellSubscriptions`, `useShellConnectionStatus`, `useShellSubscribe`, etc. We don't. Reasons:

- **Subscribe** — already available via `usePluginSend({ type: "subscribe", sessionId, lastSeq: 0 })`. Idempotent on the server. Claims call it on mount.
- **Connection status** — the claim renders "Loading parent session…" when its own state hook returns empty. No need for a global connection-status hook.
- **Subscriptions Set** — was used by App.tsx to gate the cold-open effect (`!subscribedRef.current.has(sid)`). Now the claim emits unconditionally on mount; the server handles idempotency.
- **Session metadata** — needed for the breadcrumb (cwd label). This is metadata, not state. `useShellSession` is narrow and correct.

If a future claim turns out to need something else, add another narrow primitive then. Don't speculate.

### Decision 6 — Subagent reducer migration mirrors `pluginize-flows-via-registry` exactly

- Pure reducer: `reduceSubagentEvent(map, event): Map<string, SubagentState>`. Returns the same reference when the event isn't a subagent event (no spurious re-renders).
- Hook: `useSubagentsSessionState(sessionId)` calls `useSessionEvents(sessionId)` from the runtime, folds, memoizes.
- `EMPTY_STATE` constant returned when no events to avoid React identity churn.
- Subpath export `./reducer` for tests + downstream tooling.

The four `subagent_*` cases plus the `entry_persisted` backfill arm port verbatim from `event-reducer.ts`. No semantic changes.

### Decision 7 — `SubagentDetailView` keeps its `session: SessionStateLike` prop API

The shim (already extracted to call `MinimalChatView`) takes `{ session, agentId, mode, onBack }` where `session.subagents` is a map. We don't change this — `AgentToolRenderer` constructs the map via `useSubagentsSessionState(sessionId)` and passes it through. Keeps the shim's external contract stable; subagents-plugin tests don't churn.

Alternative considered: make `SubagentDetailView` accept `sessionId` and call the hook internally. Rejected — tightly couples the view to the plugin's hook setup, making it harder to test in isolation.

### Decision 8 — `<ShellOverlayRouteSlot>` returns `{ matched: boolean; element: React.ReactNode }`

Rather than returning just the element (and the shell separately calling `useShellOverlayRouteMatched()` to know "did it match?"), the slot returns both. Saves a duplicate walk of claims per render.

Actually — rethinking. The hook needs to exist anyway for the aggregate "is any overlay active" flag (used by mobile depth calculation, deep within `getMobileDepth`). Having the slot return `{matched, element}` is redundant with the hook. Settle on:

- `<ShellOverlayRouteSlot>` returns `ReactNode | null`. Renders the matched claim's element or null.
- `useShellOverlayRouteMatched()` returns boolean. Cheap re-walk of claims with `useRoute` per claim; runtime cost is N `useRoute` calls per render where N is the number of registered claims (typically 2–5). Negligible.

Both internally call the same per-claim `useRoute` loop. Memoize the claim list per registry version to avoid recomputation.

### Decision 9 — Strip vs deprecate the shell's subagent-popout dispatch

Strip. The structural property requirement in `url-routing` is "shell SHALL NOT contain plugin-page imports / useRoute". Keeping the old dispatch as a fallback alongside the new slot would violate that and confuse the dispatch order. The slot is the only path.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Subagent reducer migration ripples through `SessionState`. Every consumer of `session.subagents` (AgentToolRenderer, SubagentDetailView, BackgroundSubagentsPanel, tests) breaks at compile time. | Strict compile-driven migration: TS errors guide the call-site fix. Targeted tests at the boundary (subagent-reducer.test.ts ported from event-reducer.test.ts arms) confirm equivalence. |
| Slot consumer renders the wrong claim due to path-overlap ambiguity. | Each plugin's claim paths are unique. The two V1 claims (`/session/:sid/subagent/:aid` and `/session/:sid/flow/:flowId/agent/:agentId`) don't overlap. Validator could optionally warn on overlap; deferred until needed. |
| `useShellSession` outside provider throws — easy to hit in tests. | Document in the hook's JSDoc and add `withShellSessionsProvider` test helper alongside `withUiPrimitiveProvider`. |
| Cold-open subscribe from inside a claim could fire repeatedly during HMR. | Server-side `subscribe` is idempotent. Plugin emits via `usePluginSend` which is safe. No client-side gating needed (matches behavior of other plugin subscriptions). |
| `useShellOverlayRouteMatched` re-walks claims per render. | Trivial cost (N=2–5). If it ever matters, memoize on the registry's claim-list reference. |
| Plugin manifest validator changes — could break existing plugins. | Additive: only adds new validation for `shell-overlay-route` claims. Existing plugins (which don't declare such claims) are unaffected. |

## Migration Plan

This change ships as one PR. No staged rollout, no flags. Migration order in the PR:

1. Land the new shared types (`slot-types.ts`, `slot-props.ts`).
2. Land the manifest validator updates.
3. Land the runtime additions (`<ShellOverlayRouteSlot>`, `useShellOverlayRouteMatched`, `useShellSession`, `ShellSessionsProvider`).
4. Land the subagents-plugin reducer migration (new files + subpath export).
5. Land the two plugin claims (subagents + flows manifest entries; claim components).
6. Strip App.tsx (event-reducer + App.tsx changes) and mount the slot.
7. Update tests.

Step 6 is the load-bearing one; everything before is additive.

**Rollback:** revert the single PR. App.tsx regains its direct imports; subagent state goes back into the shell reducer; both plugin manifests lose their `shell-overlay-route` claims. The slot taxonomy gains an unused entry — `shell-overlay-route` is still in the frozen types but no plugin uses it. Acceptable noise; can be removed in a follow-up.

## Open Questions

- Should `useShellSession` also expose mutation actions (rename, hide)? **Tentative answer:** no. Mutations route through `usePluginSend` (the standard plugin-state-mutation path). Read-only metadata is the narrow contract.
- Should the slot expose a per-claim render-priority for overlap resolution? **Tentative answer:** no. Use plugin priority as tiebreaker. If two claims in different plugins ever match the same URL, the higher-priority plugin wins — same as every other slot.
- Should the URL pattern allow regex (wouter v3 supports it)? **Tentative answer:** yes, transparently — the slot just passes `config.path` to `useRoute`. No special tooling.
- Should the validator warn on path-overlap across plugins? **Tentative answer:** defer. Walk every pair O(N²) at validator time, log a warning. Cheap. Not blocking V1.
- Should `BackgroundSubagentsPanel` (a non-mounted row-mode consumer of subagent state) migrate now or later? **Tentative answer:** migrate now in step 6 since it imports from the shell reducer. Trivial fix.
