# shell-overlay-route Specification

## Purpose
TBD - created by archiving change add-flow-agent-popout. Update Purpose after archive.
## Requirements
### Requirement: `shell-overlay-route` slot in the frozen taxonomy

The frozen slot taxonomy in `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types` SHALL include a slot id `"shell-overlay-route"` with `multiplicity: "many"` and `payloadTier: "react-only"`. Adding this slot is a minor (additive) change to the v0.x taxonomy.

Each claim against this slot SHALL declare (as first-class top-level
fields on the `PluginClaim`, NOT inside the generic `config` bag — the
slot consumer reads them via the typed `ClaimEntry` contract):

- `component: string` — exported component name from the plugin's client entry.
- `path: string` — wouter path pattern (e.g. `/session/:sid/flow/:flowId/agent/:agentId`), MUST start with `/`.
- `sessionParam: string` (optional, default `"sid"`) — name of the URL parameter that holds the parent session id; used by the slot consumer to resolve `DashboardSession` metadata for the claim.
- `depth: 1 | 2` (optional) — the shell navigation depth this route occupies for the depth-aware back action (`1` = detail, `2` = overlay-on-detail). When omitted, the route SHALL be treated as `depth: 2` (overlay → cards) and the validator SHALL emit a non-fatal warning advising the author to declare `depth`.
- `parentPath: string` (optional) — for `depth: 2` routes, the wouter path pattern of the route the back action returns to; `:params` in `parentPath` SHALL be interpolated from the current route match. When omitted, a `depth: 2` route's back target defaults to `/` (cards).

Each `shell-overlay-route` claim SHALL contribute one route descriptor (`{ pattern: path, depth, computeParent }`) consumed by the back-target route classifier, so the global depth-aware back action resolves plugin routes without any core-shell edit.

For backward compatibility, `config.path` / `config.sessionParam` are
recognised by the validator and lifted to the top-level normalised
claim, but new manifests SHALL use the top-level fields directly.

#### Scenario: Manifest validator accepts a well-formed claim

- **WHEN** the manifest validator processes a claim with `slot: "shell-overlay-route"`, `component: "FooClaim"`, and `path: "/foo/:id"`
- **THEN** validation SHALL succeed
- **AND** the normalised claim SHALL have `path === "/foo/:id"` as a top-level field

#### Scenario: Manifest validator rejects missing path

- **WHEN** the manifest validator processes a `shell-overlay-route` claim without `path` (and without legacy `config.path`)
- **THEN** validation SHALL throw `ManifestValidationError` referencing the missing `path` field

#### Scenario: Manifest validator rejects non-rooted path

- **WHEN** the manifest validator processes a claim with `path: "foo/:id"` (no leading slash)
- **THEN** validation SHALL throw `ManifestValidationError` referencing the invalid path

#### Scenario: Legacy `config.path` is lifted to top-level

- **WHEN** the manifest validator processes a claim with `config: { path: "/legacy/:id", sessionParam: "sid" }` and no top-level `path`
- **THEN** validation SHALL succeed
- **AND** the normalised claim SHALL have `path === "/legacy/:id"` and `sessionParam === "sid"` as top-level fields

#### Scenario: Missing depth warns and defaults to overlay

- **WHEN** the manifest validator processes a `shell-overlay-route` claim with `path` but no `depth`
- **THEN** validation SHALL succeed with a non-fatal warning naming the claim
- **AND** the contributed route descriptor SHALL have `depth === 2` with a back target of `/`

#### Scenario: Declared depth and parent produce a descriptor

- **WHEN** the manifest validator processes a claim with `path: "/automation/run/:sid"`, `depth: 2`, `parentPath: "/folder/:encodedCwd/automations"`
- **THEN** validation SHALL succeed
- **AND** the contributed route descriptor SHALL have `depth === 2` and a `computeParent` that interpolates `:encodedCwd` from the current match

### Requirement: `<ShellOverlayRouteSlot>` consumer renders the first matching claim

The dashboard-plugin-runtime SHALL export `<ShellOverlayRouteSlot>`. It SHALL walk all registered `shell-overlay-route` claims, call `useRoute(claim.path)` for each (with the typed top-level `path` field), and render the first claim whose path matches the current URL. The claim's component SHALL be invoked with:

```ts
{
  params: Record<string, string>;     // decoded URL params from wouter
  session?: DashboardSession;          // resolved via useShellSession(params[claim.config.sessionParam])
  onBack: () => void;                  // shell-provided back-nav callback
  pluginContext: AnyPluginContext;     // standard plugin-context object
}
```

Claims are ordered by `(plugin.priority asc, plugin.id asc)`; the first match in that order wins. When no claim matches, the consumer SHALL render `null` (the shell falls through to non-overlay content).

The slot consumer SHALL read `path` and `sessionParam` from the
top-level `ClaimEntry` fields. Falling back to `config.path` /
`config.sessionParam` is permitted only as legacy compat.

#### Scenario: First matching claim renders

- **GIVEN** two plugins register `shell-overlay-route` claims with `path: "/session/:sid/subagent/:aid"` (subagents-plugin, priority 100) and `path: "/session/:sid/flow/:flowId/agent/:agentId"` (flows-plugin, priority 100)
- **WHEN** the URL is `/session/sess_1/flow/my-pipe/agent/agent_3`
- **THEN** `<ShellOverlayRouteSlot>` SHALL render the flows-plugin's claim component
- **AND** the subagents-plugin's claim SHALL NOT be rendered for this URL

#### Scenario: No matching claim returns null

- **WHEN** the URL is `/some/random/path` with no registered `shell-overlay-route` claim matching it
- **THEN** `<ShellOverlayRouteSlot>` SHALL render `null`

#### Scenario: Build-time generator emits first-class fields

- **WHEN** the Vite plugin generates the static plugin registry
- **THEN** every `shell-overlay-route` claim entry SHALL emit `path` and `sessionParam` as top-level fields on the runtime `ClaimEntry` object
- **AND** SHALL NOT bury them inside a generic `config` bag

#### Scenario: Param decoding follows wouter semantics

- **WHEN** the URL is `/session/sess_1/flow/my%20pipe/agent/agent_3` and a claim's `path` is `/session/:sid/flow/:flowId/agent/:agentId`
- **THEN** the claim's component SHALL receive `params.flowId === "my pipe"` (URL-decoded by wouter)

#### Scenario: Height propagation wrapper is present when a claim matches

- **GIVEN** the shell's desktop content area is a `flex-1 flex flex-col` container inside `h-screen`
- **WHEN** any `shell-overlay-route` claim matches the current URL
- **THEN** the rendered claim output SHALL be wrapped in a `flex-1 min-h-0 overflow-hidden` container
- **AND** the claimed component's root `h-full` element SHALL resolve to the shell layout's available height

#### Scenario: Height wrapper is absent when no claim matches

- **WHEN** no `shell-overlay-route` claim matches the current URL
- **THEN** the slot consumer SHALL render `null` (no wrapper element emitted)

### Requirement: `useShellOverlayRouteMatched` hook for aggregate gating

The dashboard-plugin-runtime SHALL export `useShellOverlayRouteMatched(): boolean`, returning `true` when any `shell-overlay-route` claim's path matches the current URL. The shell SHALL use this hook instead of hand-maintaining a `||`-chain of `useRoute` flags for plugin-owned routes.

#### Scenario: Aggregate flag flips with route activation

- **WHEN** the URL changes from `/` to `/session/sess_1/subagent/agent_x` (a registered claim path)
- **THEN** `useShellOverlayRouteMatched()` SHALL transition from `false` to `true` across re-render

### Requirement: `useShellSession` primitive for session metadata access

The dashboard-plugin-runtime SHALL export `useShellSession(sessionId: string): DashboardSession | undefined`. It reads from a `ShellSessionsContext` populated by App.tsx with the live sessions Map. The contract is narrow — metadata only (id, cwd, label, status, indicators); plugins MUST NOT use this primitive to reach for per-session derived state (events, subagent state, flow state). Per-session derived state SHALL flow through plugin-owned reducers + `useSessionEvents`.

#### Scenario: Hook returns the live DashboardSession

- **GIVEN** App.tsx wraps its tree in `<ShellSessionsProvider value={sessionsMap}>` where the map contains a session `{ id: "sess_1", cwd: "/repo" }`
- **WHEN** a plugin component calls `useShellSession("sess_1")`
- **THEN** the call SHALL return `{ id: "sess_1", cwd: "/repo", ... }`

#### Scenario: Hook returns undefined for unknown ids

- **WHEN** the plugin calls `useShellSession("missing")` and `"missing"` is not in the sessions Map
- **THEN** the hook SHALL return `undefined`

#### Scenario: Hook throws outside the provider

- **WHEN** a component calls `useShellSession(...)` outside of any `<ShellSessionsProvider>`
- **THEN** the hook SHALL throw a clear setup error (matching `useSlotRegistry`'s strict-hook contract)

### Requirement: Shell mounts exactly one slot consumer per layout

`packages/client/src/App.tsx` SHALL mount exactly one `<ShellOverlayRouteSlot>` at the top of the desktop overlay switch (the existing chain that handles `archiveMatch`, `specsMatch`, etc.), AND exactly one inside `MobileShell.detailPanel`. When the slot returns a non-null element, the shell SHALL render that element and SHALL NOT render any of the lower-priority branches in the chain (landing, session detail, etc.).

#### Scenario: Slot mount is unique per layout

- **WHEN** static analysis scans `packages/client/src/App.tsx`
- **THEN** the file SHALL contain at most two `<ShellOverlayRouteSlot` JSX mounts (one desktop, one mobile)

#### Scenario: Slot mount precedes landing-page fallback

- **WHEN** the URL matches a registered claim path on the desktop layout
- **THEN** the slot SHALL render the claim's component as the main content
- **AND** the desktop overlay chain SHALL NOT fall through to `LandingPage` or `sessionDetail`

