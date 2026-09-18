## Purpose

Makes the production client artifact self-describing so the dashboard server can report whether the static bundle it actually serves agrees with its runtime plugin set, and so the local rebuild path deploys one verified artifact set instead of silently drifting.

## ADDED Requirements

### Requirement: Production client build emits a build declaration

A production build of the dashboard web client SHALL write a build declaration file alongside the built assets. The declaration SHALL carry a schema version, the deterministic plugin-registry hash that is also embedded in the built bundle, and the fixture policy the build applied (a closed enum). The declaration SHALL NOT contain timestamps, machine-specific paths, or any other host-dependent value, so that two builds of the same sources and the same plugin set produce byte-identical declarations.

#### Scenario: Production build writes the declaration

- **WHEN** the client is built for production with a given plugin set
- **THEN** a build declaration file is emitted into the build output directory
- **AND** it records a schema version and the same plugin-registry hash that is embedded in the built bundle

#### Scenario: Declaration is reproducible across hosts

- **WHEN** the same sources and the same declared plugin set are built twice on different machines or in different directories
- **THEN** both builds emit byte-identical declaration contents

#### Scenario: Development mode emits no declaration

- **WHEN** the client runs in development / HMR mode
- **THEN** registry generation stays source-only and no build declaration file is written

### Requirement: Plugin-registry hash is computed over a declared plugin set

The plugin-registry hash SHALL be derived from an explicitly declared plugin set rather than from filesystem discovery order, so that the hash depends only on the identity of the participating plugins. The declared set SHALL be selected by the shared client-registry selector (see the `plugin-manifest-staleness` capability), and the digest SHALL be produced by the existing deterministic serialization rather than a second implementation of it.

#### Scenario: Discovery order does not affect the hash

- **WHEN** the same plugins are supplied to the build in a different order or from different absolute locations
- **THEN** the computed plugin-registry hash is unchanged

#### Scenario: Plugin set change changes the hash

- **WHEN** a plugin is added to or removed from the declared set
- **THEN** the computed plugin-registry hash changes

### Requirement: Health endpoint reports served-artifact coherence

The server health response SHALL include an additive `clientBuild` object reporting the plugin-registry hash of the artifact the server actually serves and a `status` of `matched`, `mismatched`, `metadata-missing`, or `not-served`. The existing `bundleHash` field and its consumer contract SHALL be unchanged. The reported value SHALL NOT expose any filesystem path.

#### Scenario: Served artifact agrees with the runtime plugin set

- **WHEN** the served static directory carries a declaration whose plugin-registry hash equals the server's runtime plugin-registry hash
- **THEN** health reports `clientBuild.status` of `matched` with that hash

#### Scenario: Comparison uses the same basis as the staleness hash

- **WHEN** the server computes `clientBuild` and `bundleHash` in the same process in production
- **THEN** both are computed from the same client-registry plugin set
- **AND** a plugin that is excluded from one is excluded from the other

#### Scenario: Comparison honours the artifact's declared fixture policy

- **WHEN** the server compares against an artifact whose declaration records a fixture policy differing from the server's own mode default
- **THEN** the comparison SHALL select the runtime set under the artifact's declared policy
- **AND** a fixture plugin SHALL NOT by itself produce `mismatched`

#### Scenario: Reported state is a startup snapshot

- **WHEN** the served directory's declaration changes on disk while the server is running
- **THEN** health continues to report the snapshot read at startup until the server restarts
- **AND** that snapshot semantics is what the field documents

#### Scenario: Served artifact disagrees with the runtime plugin set

- **WHEN** the served static directory carries a declaration whose hash differs from the server's runtime hash
- **THEN** health reports `clientBuild.status` of `mismatched` with the served artifact's hash

#### Scenario: Served artifact carries no usable declaration

- **WHEN** the served static directory exists but its declaration is absent or unreadable as a valid declaration
- **THEN** health reports `clientBuild.status` of `metadata-missing` with a null hash

#### Scenario: Server serves no static client

- **WHEN** the server runs without a resolvable static client directory
- **THEN** health reports `clientBuild.status` of `not-served` with a null hash

#### Scenario: Existing health fields are unchanged

- **WHEN** any client reads the health response
- **THEN** `bundleHash` and all previously present health fields keep their prior meaning and shape

### Requirement: Server serves exactly the static directory it reports

The server SHALL resolve its static client directory once at startup, serve assets from exactly that directory, and read its declaration from that same directory. Resolution SHALL keep the existing precedence: the installed web package first, the workspace sibling build as a development fallback. At startup the server SHALL emit a diagnostic naming the coherence condition without printing a filesystem path.

#### Scenario: Installed package wins over workspace build

- **WHEN** both an installed web package and a workspace client build are present
- **THEN** the server serves and reports on the installed package's directory

#### Scenario: Startup diagnostic omits filesystem paths

- **WHEN** the server starts with a mismatched or missing declaration
- **THEN** it logs a diagnostic naming the condition
- **AND** the diagnostic contains no filesystem path, including when the declaration could not be read because of a filesystem error

#### Scenario: Resolution precedence is unchanged when the package has no build

- **WHEN** the web package resolves but carries no `index.html`
- **THEN** the server reports no static client rather than falling back to the workspace sibling
- **AND** the workspace sibling is used only when the package is unresolvable

#### Scenario: Dev mode with a live Vite server

- **WHEN** the server runs in dev mode and proxies the client to a running Vite dev server
- **THEN** `clientBuild` describes the production fallback directory it would serve, not the Vite module graph
- **AND** the field documents that scoping

### Requirement: Local rebuild path verifies one coherent artifact set

The developer rebuild path SHALL, between building and restarting, resolve the served destination the same way the server does, deploy the freshly built workspace output into it when the two differ, and verify that both sides then carry identical declarations. An incoherent or unverifiable outcome SHALL fail the rebuild before any restart or session reload is triggered. The step SHALL refuse rather than guess when the two sides disagree structurally.

#### Scenario: Every rebuild entry point is gated

- **WHEN** any repository script rebuilds the client and then restarts or reloads the running system
- **THEN** it SHALL run the verification step between the build and the restart

#### Scenario: Freshly built output is deployed to the served destination

- **WHEN** the resolved served destination differs from the workspace build output and both are structurally valid builds
- **THEN** the workspace output is synced into the served destination
- **AND** both sides are verified to carry identical declarations

#### Scenario: Served destination equals the workspace build

- **WHEN** the resolved served destination is the workspace build output itself
- **THEN** no copy is performed and the step reports success

#### Scenario: Legacy destination without a declaration is adopted

- **WHEN** the served destination is a structurally valid client build that predates this change and therefore carries no declaration, and the source build carries a valid one
- **THEN** the step SHALL deploy the source build into it rather than refuse
- **AND** verification afterwards finds identical declarations on both sides

#### Scenario: Deploy removes superseded assets

- **WHEN** the served destination contains hashed assets from an earlier build that the source build no longer contains
- **THEN** after the step the destination contains the source build's asset set and no superseded assets

#### Scenario: Incoherent set aborts before restart

- **WHEN** the build output or the served destination lacks a valid declaration, or the two declarations still differ after syncing
- **THEN** the rebuild fails with a message naming the condition
- **AND** no server restart and no session reload is triggered

#### Scenario: API-only host is an explicit outcome

- **WHEN** the host serves no static client at all
- **THEN** the step reports that supported outcome explicitly rather than reporting a mismatch or a silent success
