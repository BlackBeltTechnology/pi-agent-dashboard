## MODIFIED Requirements

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
