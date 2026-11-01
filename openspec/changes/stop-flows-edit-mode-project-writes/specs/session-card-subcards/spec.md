## MODIFIED Requirements

### Requirement: Subcards render nothing when their content is empty

Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no
element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

For MEMORY, WORKSPACE, and FLOWS, the wrapper's visibility is governed by the `shouldRender`
claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no
plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that
registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender`
**whose boolean condition matches the claim component's own render/skip condition**, so the
wrapper never renders an empty panel.

For the FLOWS subcard specifically, the `session-card-flows` claim (`SessionFlowActionsClaim`)
now renders only flow status; the flow actions moved to the session actions menu (see
`flows-plugin`). The claim returns `null` when the session has no flow event. Its `shouldRender`
predicate SHALL therefore return `true` **iff** the session has at least one flow event (a flow
is running or has run). The predicate SHALL NOT open on `flowsList` contents, on edit mode, or
on mere pi-flows extension presence.

**The OPENSPEC subcard is exempt from the empty-content rule.** Its visibility is governed by
readiness, and in the `BROKEN` and `STALE` states it renders deliberately with no action
controls. An OPENSPEC panel containing only a reason line and a single remediation control
SHALL NOT be treated as empty.

#### Scenario: Empty PROCESS subcard is hidden

- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: Control-less OPENSPEC subcard is not treated as empty

- **WHEN** the OPENSPEC subcard renders disabled, containing only a reason line and a single
  remediation control
- **THEN** the panel and its `OPENSPEC` title SHALL still render

#### Scenario: FLOWS subcard hidden without flow activity

- **WHEN** a desktop session card is rendered for a session whose cwd has the pi-flows
  extension loaded (a `flows` command is present)
- **AND** the session's `flowsList` is empty
- **AND** the session's effective flows edit mode (`flows.editFlow`, project overriding global) is off
- **AND** the session has no flow event (no flow running or previously run)
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** no empty flows panel SHALL be rendered

#### Scenario: Edit mode alone does not show the FLOWS subcard

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList`
- **AND** the session's effective flows edit mode (`flows.editFlow`, project overriding global) is on
- **AND** the session has no flow event
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** the author-first **New / Edit…** entry point SHALL be offered in the session actions menu instead

#### Scenario: FLOWS subcard appears once a flow has run

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList` and edit
  mode off
- **AND** the session has at least one flow event (a flow ran or is running)
- **THEN** an element with title text `FLOWS` SHALL appear

