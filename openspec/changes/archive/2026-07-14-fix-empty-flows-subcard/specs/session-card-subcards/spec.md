## MODIFIED Requirements

### Requirement: Subcards hide when their content is empty

Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

For MEMORY, WORKSPACE, and FLOWS, the wrapper's visibility is governed by the `shouldRender` claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender` **whose boolean condition matches the claim component's own render/skip condition**, so the wrapper never renders an empty panel.

For the FLOWS subcard specifically, the `session-card-flows` claim (`SessionFlowActionsClaim`) returns `null` when the session has zero flows AND edit mode is off AND no flow is running or has run. Its `shouldRender` predicate (`shouldRenderFlowsSubcard`) SHALL therefore return `true` **iff at least one of**: the session's `flowsList` is non-empty, the flows plugin's edit mode (`editFlow`) is on, or the session has at least one flow event. The predicate SHALL NOT open on mere pi-flows extension presence (existence of a `flows` / `flows:*` command) when none of those conditions hold.

#### Scenario: Empty PROCESS subcard is hidden

- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: FLOWS subcard hidden when extension loaded but nothing actionable

- **WHEN** a desktop session card is rendered for a session whose cwd has the pi-flows extension loaded (a `flows` command is present)
- **AND** the session's `flowsList` is empty
- **AND** the flows plugin edit mode (`editFlow`) is off
- **AND** the session has no flow event (no flow running or previously run)
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** no empty flows panel SHALL be rendered

#### Scenario: FLOWS subcard appears in edit mode with zero flows

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList`
- **AND** the flows plugin edit mode (`editFlow`) is on
- **THEN** an element with title text `FLOWS` SHALL appear (the author-first / New-Edit entry point)

#### Scenario: FLOWS subcard appears when a flow has run with zero listed flows

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList` and edit mode off
- **AND** the session has at least one flow event (a flow ran or is running)
- **THEN** an element with title text `FLOWS` SHALL appear
