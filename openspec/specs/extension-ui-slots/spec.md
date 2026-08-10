# extension-ui-slots Specification

## Purpose

Decorator-driven UI slots render plugin-contributed `uiDecorators` from a `DashboardSession` by decorator kind. The `agent-metric`, `breadcrumb`, and `gate` slots each select the decorators relevant to their context, apply a kind-specific aggregation rule when multiple decorators contribute, and render nothing when no relevant decorator exists.

## Requirements

### Requirement: Decorator selection by kind and context

Each slot SHALL select from `session.uiDecorators` only the descriptors whose `kind` matches the slot's kind, further filtered by the payload field that scopes them to the slot's context, and SHALL render nothing when the session is absent or no matching descriptor exists.

#### Scenario: Session absent

- **WHEN** a slot is rendered with an undefined session
- **THEN** the slot renders nothing

#### Scenario: No matching descriptor

- **WHEN** a slot is rendered and no `uiDecorators` entry matches the slot's kind and context filter
- **THEN** the slot renders nothing

#### Scenario: Context-scoped selection

- **WHEN** the `agent-metric` slot filters descriptors by `payload.agentId` equal to the parent agent id, and the `gate` slot filters descriptors by `payload.flowId` equal to the target flow id
- **THEN** only descriptors matching that id are selected and descriptors targeting a different id are ignored

### Requirement: Agent-metric slot rendering

The `agent-metric` slot SHALL render every `agent-metric` descriptor whose `payload.agentId` matches the parent agent, showing each descriptor's `payload.text` with `payload.tooltip` as its title, in iteration order, separated by a divider between adjacent entries.

#### Scenario: Multiple matching metrics

- **WHEN** more than one `agent-metric` descriptor matches the agent id
- **THEN** all matching metrics render in iteration order
- **AND** a divider separates each metric from the previous one

#### Scenario: Metric for unknown agent

- **WHEN** an `agent-metric` descriptor targets an `agentId` not rendered by the parent
- **THEN** it is silently ignored and not rendered

### Requirement: Breadcrumb slot last-write-wins

The `breadcrumb` slot SHALL render a single breadcrumb step indicator from the last `breadcrumb` descriptor in iteration order, marking the active step as the one identified by `payload.current` or, absent that, the first step whose `status` is `active`, and reflecting each step's `status` (`pending`, `active`, `done`, `error`).

#### Scenario: Multiple breadcrumbs pushed

- **WHEN** more than one `breadcrumb` descriptor exists
- **THEN** only the last descriptor in iteration order is rendered

#### Scenario: Active step resolution

- **WHEN** the breadcrumb payload provides `current`
- **THEN** the step with that id is marked active
- **AND** when `current` is absent, the first step with `status: "active"` is marked active instead

#### Scenario: Step status display

- **WHEN** a step has `status: "done"` it renders dimmed with a check, `status: "error"` renders in the error style with an alert icon, the active step renders highlighted, and other steps render neutral

### Requirement: Gate slot most-restrictive aggregation

The `gate` slot SHALL aggregate all `gate` descriptors matching the target `flowId` into a single availability state where any descriptor with `available: false` makes the aggregate unavailable, and SHALL render an unavailable banner only when the aggregate is unavailable.

#### Scenario: No gate descriptors for flow

- **WHEN** no `gate` descriptor targets the flow id
- **THEN** the aggregate state is available and the slot renders nothing

#### Scenario: All matching gates available

- **WHEN** every matching `gate` descriptor has `available: true`
- **THEN** the aggregate state is available and the slot renders nothing

#### Scenario: One or more gates block

- **WHEN** any matching `gate` descriptor has `available: false`
- **THEN** the aggregate state is unavailable
- **AND** the slot renders a banner whose text is the newline-joined non-empty `reason` values of all blocking descriptors, falling back to a default unavailable label when no reason is present
