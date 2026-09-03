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
- `presentation: "page" | "dialog"` (optional, default `"dialog"`) — the container the shell renders the claim in. `"dialog"` SHALL render a route-backed overlay: a `Dialog` over a scrim over the pinned background underlay on desktop, and the `MobileShell` depth slide on mobile. The underlay SHALL be rendered from the frozen background path captured at navigation time (or, on a cold load, synthesized from the claim's back target), NOT from the current location. `"page"` SHALL render the claim full-viewport on **both** desktop and mobile, outside the `MobileShell` detail panel. An unrecognised value SHALL be a fatal `ManifestValidationError`, NOT a warn-and-default, so a typo cannot silently restore the behaviour the author opted out of.

Each `shell-overlay-route` claim SHALL contribute one route descriptor (`{ pattern: path, depth, computeParent }`) consumed by the back-target route classifier, so the global depth-aware back action resolves plugin routes without any core-shell edit. `depth` remains REQUIRED for `presentation: "page"` claims, because a page has no dialog dismissal and the descriptor table is the only thing driving its back action. `parentPath` is required under exactly the same rule as any other claim — whenever `depth: 2` — and NOT as an extra condition of `"page"`, which would be unsatisfiable for a `depth: 1` claim.

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

- **WHEN** the manifest validator processes a claim with `path: "/folder/:encodedCwd/automations/run/:sid"`, `depth: 2`, `parentPath: "/folder/:encodedCwd/automations"`
- **THEN** validation SHALL succeed
- **AND** the contributed route descriptor SHALL have `depth === 2` and a `computeParent` that interpolates `:encodedCwd` from the current match

#### Scenario: Omitted presentation defaults to dialog

- **WHEN** the manifest validator processes a `shell-overlay-route` claim with no `presentation` field
- **THEN** validation SHALL succeed
- **AND** the claim SHALL be rendered by the shell as a route-backed dialog

#### Scenario: Unrecognised presentation is fatal

- **WHEN** the manifest validator processes a `shell-overlay-route` claim with `presentation: "modal"`
- **THEN** validation SHALL throw `ManifestValidationError` naming the claim index and the accepted values `"page"` and `"dialog"`
- **AND** the claim SHALL NOT be silently defaulted to `"dialog"`

#### Scenario: Build-time generator emits presentation

- **WHEN** the Vite plugin generates the static plugin registry for a claim declaring `presentation: "page"`
- **THEN** the emitted runtime `ClaimEntry` SHALL carry `presentation: "page"` as a top-level field

### Requirement: `<ShellOverlayRouteSlot>` consumer renders the first matching claim

The dashboard-plugin-runtime SHALL export `<ShellOverlayRouteSlot>`. It SHALL walk all registered `shell-overlay-route` claims, call `useRoute(claim.path)` for each (with the typed top-level `path` field), and render the first claim whose path matches the current URL. The claim's component SHALL be invoked with:

```ts
{
  params: Record<string, string>;     // decoded URL params from wouter
  session?: DashboardSession;          // resolved via useShellSession(params[claim.sessionParam ?? claim.config?.sessionParam ?? "sid"])
  onBack: () => void;                  // shell-provided back-nav callback
  pluginContext: AnyPluginContext;     // standard plugin-context object
}
```

Claims are ordered by `(plugin.priority asc, plugin.id asc)`; the first match in that order wins. When no claim matches, the consumer SHALL render `null` (the shell falls through to non-overlay content).

The slot consumer SHALL read `path` and `sessionParam` from the
top-level `ClaimEntry` fields. Falling back to `config.path` /
`config.sessionParam` is permitted only as legacy compat.

The consumer SHALL select the matched claim's container from its effective `presentation`:

- `"dialog"` (default) — on desktop the claim SHALL render inside a `Dialog` over a scrim over the pinned background underlay. On mobile the claim SHALL render inside the `MobileShell` detail panel at its declared `depth`.
- `"page"` — the claim SHALL render full-viewport on desktop AND mobile, outside the `MobileShell` detail panel.

A matched slot claim SHALL NOT render any lower-priority branch of the shell chain **derived from the current location**. The pinned background underlay is not such a branch: it is rendered from a frozen path through a location source independent of `window.location`, so exactly one branch is ever derived from the URL. The underlay SHALL be `aria-hidden`, outside the overlay's focus trap, and non-interactive while the claim is open.

The URL SHALL be identical in every case. Changing a claim's `presentation` SHALL NOT change its path, its deep-linkability, or its browser back behaviour.

Dismissing a `"dialog"` claim (backdrop click, `Esc`, or the close affordance) SHALL leave the claim's surface entirely and return to the route that launched it. Dismissal SHALL NOT be defined as a single history step: a claim whose component pushes history entries for its own internal navigation would otherwise land on its own earlier state with the dialog still open.

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

#### Scenario: Default-presentation claim renders as a dialog

- **GIVEN** the user is on `/folder/<encodedCwd>` on a desktop viewport
- **WHEN** the user opens the Goals board at `/folder/<encodedCwd>/goals` (a claim with no declared `presentation`)
- **THEN** the board SHALL render in a `Dialog` over a scrim
- **AND** the folder view SHALL be rendered behind it as the pinned underlay, `aria-hidden` and non-interactive
- **AND** no branch of the shell chain other than the board SHALL be derived from the current location
- **AND** the URL SHALL be `/folder/<encodedCwd>/goals`

#### Scenario: Dismissal survives a claim's own internal history pushes

- **GIVEN** a `"dialog"` claim opened from `/folder/<encodedCwd>` whose component pushed one history entry for its own internal navigation
- **WHEN** the user presses `Esc`
- **THEN** the claim's surface SHALL be dismissed entirely
- **AND** the URL SHALL return to `/folder/<encodedCwd>`

#### Scenario: Dismissing a dialog claim returns to the launching route

- **GIVEN** the user opened `/folder/<encodedCwd>/goals` as a dialog from `/folder/<encodedCwd>`
- **WHEN** the user presses `Esc` or clicks the backdrop
- **THEN** the URL SHALL return to `/folder/<encodedCwd>`
- **AND** the folder SHALL NOT be lost to `/`

#### Scenario: `presentation: "page"` opts out of the dialog on desktop and the depth panel on mobile

- **GIVEN** a top-level claim declaring `presentation: "page"` with `depth: 1` (not nested under a folder or session)
- **WHEN** the claim's path matches on a desktop viewport
- **THEN** the claim SHALL render full-viewport and SHALL NOT be wrapped in a `Dialog`
- **AND** when the same path matches on a mobile viewport the claim SHALL render full-viewport outside the `MobileShell` detail panel

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

### Requirement: Overlay claims SHALL declare a reachable back target

Every `shell-overlay-route` claim in a first-party plugin SHALL declare an explicit `depth`. Every claim declaring `depth: 2` SHALL declare a `parentPath`. Every declared `parentPath` SHALL be interpolable from the `:params` its own `path` captures.

The third condition is separately necessary: `interpolateParentPath` returns `null` — degrading the back target to `/` — when the parent pattern names a `:param` the child path never captures. A `parentPath` can therefore be present, well-formed, and still dead. The runtime degradation remains a safety net for third-party manifests; it SHALL NOT be relied on by bundled plugins.

A repository test SHALL enforce all three conditions by scanning every bundled plugin manifest, and SHALL fail the build when any claim violates them. That test SHALL also assert it found a non-trivial number of claims, so a scan bug cannot make it vacuously green.

#### Scenario: A claim omitting depth fails the build

- **GIVEN** a bundled plugin manifest with a `shell-overlay-route` claim that declares no `depth`
- **WHEN** the repository manifest-scan test runs
- **THEN** the test SHALL fail naming the plugin id, claim index, and path

#### Scenario: A depth-2 claim without a parentPath fails the build

- **GIVEN** a bundled plugin manifest with a `depth: 2` claim and no `parentPath`
- **WHEN** the repository manifest-scan test runs
- **THEN** the test SHALL fail naming the offending claim

#### Scenario: An uninterpolable parentPath fails the build

- **GIVEN** a claim with `path: "/automation/run/:sid"` and `parentPath: "/folder/:encodedCwd/automations"`
- **WHEN** the repository manifest-scan test runs
- **THEN** the test SHALL fail reporting that `:encodedCwd` cannot be supplied by the claim's own path

#### Scenario: The scan test is not vacuous

- **GIVEN** the manifest scan returns an empty claim list because of a discovery bug
- **WHEN** the repository manifest-scan test runs
- **THEN** the test SHALL fail rather than reporting success over zero claims

### Requirement: Goal, Knowledge Base, and Automation claims declare correct back targets

The `goal`, `kb`, `automation`, and `subagents` plugin manifests SHALL declare `depth` on every `shell-overlay-route` claim, and `parentPath` on every `depth: 2` claim, such that the depth-aware back action returns to the owning folder, board, or session rather than the card list — on the in-app path AND the cold-load path.

Declaring `depth` is necessary but NOT sufficient. A repository test SHALL additionally assert the resulting back *target*, walking the generated plugin registry and resolving each nested claim's back action through the real `computeBackTarget` and `goBack` code paths. A claim declared `depth: 1` under a depth-1 parent satisfies a declaration check while resolving to `/`.

The automation run monitor SHALL be addressed at a path that encodes its owning board's `:encodedCwd`, so its declared `parentPath` is interpolable.

#### Scenario: Goals board backs to its folder on mobile

- **GIVEN** the user opened `/folder/<encodedCwd>/goals` on a mobile viewport
- **WHEN** the user invokes the depth-aware back action with no tracked predecessor
- **THEN** the URL SHALL resolve to the folder, NOT to `/`

#### Scenario: A folder-scoped board is not declared depth 1

- **GIVEN** any bundled claim whose path is nested under `/folder/:encodedCwd`
- **WHEN** its declared `depth` is inspected
- **THEN** it SHALL be `2` with a `parentPath` naming its owning parent
- **AND** it SHALL NOT be `1`, which would lose the strictly-shallower history fast-path and eject the user to `/`

#### Scenario: Goal detail backs to the goals board

- **GIVEN** the user is at `/folder/<encodedCwd>/goals/<goalId>`
- **WHEN** the user invokes the depth-aware back action with no tracked predecessor
- **THEN** `computeParent` SHALL return `/folder/<encodedCwd>/goals`

#### Scenario: Knowledge Base backs to its folder on mobile

- **GIVEN** the user opened `/folder/<encodedCwd>/kb` on a mobile viewport
- **WHEN** the user invokes the depth-aware back action with no tracked predecessor
- **THEN** the URL SHALL resolve to the folder, NOT to `/`

#### Scenario: Subagent popout backs to its session

- **GIVEN** the user is at `/session/<sessionId>/subagent/<agentId>`
- **WHEN** the user invokes the depth-aware back action with no tracked predecessor
- **THEN** `computeParent` SHALL return `/session/<sessionId>`

#### Scenario: Automation run monitor backs to its board on a cold load

- **GIVEN** the user cold-loads `/folder/<encodedCwd>/automations/run/<sid>` with no tracked predecessor
- **WHEN** the user invokes the depth-aware back action
- **THEN** `computeBackTarget` SHALL return `/folder/<encodedCwd>/automations`
- **AND** SHALL NOT degrade to `/`

#### Scenario: Automation board backs to its folder

- **GIVEN** the user opened `/folder/<encodedCwd>/automations` from `/folder/<encodedCwd>`
- **WHEN** the user invokes the depth-aware back action
- **THEN** the back action SHALL resolve to `/folder/<encodedCwd>`
- **AND** SHALL NOT resolve to `/`

#### Scenario: The registry-walking test fails on a wrong back target

- **GIVEN** a bundled nested claim whose declared `depth`/`parentPath` resolve its back action to `/`
- **WHEN** the registry-walking back-target test runs
- **THEN** the test SHALL fail naming the claim path and the resolved target

### Requirement: Route-backed overlay content SHALL be reachable

Every route-backed overlay SHALL present its content as reachable: no part of
the surface may be clipped away with no gesture able to bring it into view, and
no interactive element may be occluded by whichever close control the surface presents.

This is a **layout** contract, distinct from the routing contract. It is stated
separately because it is invisible to the verification the routing contract
uses: jsdom has no layout engine and reports a zero box for every element, and
`toBeVisible()` passes on an element that is rendered but clipped. A surface can
therefore satisfy every routing requirement while presenting an unusable box.

Verification SHALL run in a real browser against every overlay route.

#### Scenario: Overlay content is either bounded or scrollable

- **GIVEN** any route-backed overlay route
- **WHEN** its content exceeds the dialog container's height cap
- **THEN** a descendant of the container SHALL be a working scroller
  (`overflow-y` of `auto`/`scroll` with `scrollHeight > clientHeight`), so the
  overflowing content is reachable

#### Scenario: Content that fits is not clipped

- **GIVEN** any route-backed overlay route
- **WHEN** its content fits within the dialog container's height cap
- **THEN** the container's `scrollHeight` SHALL NOT exceed its `clientHeight`
  beyond a rounding tolerance

#### Scenario: No interactive element is occluded by the close control

- **GIVEN** any route-backed overlay route, and its EFFECTIVE close control —
  the container's built-in ✕ where one is rendered, otherwise the dismissal
  control the surface itself presents
- **WHEN** the overlay is displayed
- **THEN** no OTHER visible interactive element (`button`, `a`, `input`,
  `select`) within the container SHALL have a bounding box intersecting the
  control's bounding box

#### Scenario: The gate covers every overlay route, not a known-bad list

- **WHEN** a new route-backed overlay route is added
- **THEN** it SHALL be covered by the same reachability assertions as the
  existing routes, so a newly converted surface cannot regress silently

