## MODIFIED Requirements

### Requirement: Plugin consumer shims preserve their public API

`SubagentDetailView.tsx`, `FlowAgentDetail.tsx`, AND `FlowArchitect.tsx`'s `FlowArchitectDetail` component SHALL each be reduced to a thin adapter that:

1. Accepts the same props it accepted before the migration.
2. Maps producer-specific state to `MinimalChatView` props.
3. Renders `MinimalChatView`.

The shim SHALL NOT contain any local declaration of `ToolCallEntry`,
`TextEntry`, `ThinkingEntry`, `extractInputPreview`, `statusIconPath`,
or `statusColor` — those live exclusively in `MinimalChatView`.

#### Scenario: FlowArchitectDetail retains its prop API

- **WHEN** the architect's eye-button popover renders
  `<FlowArchitectDetail state={...} onBack={...} />`
- **THEN** the component SHALL render successfully without code changes
  at the call site
- **AND** the rendered DOM SHALL be visually equivalent to the
  pre-extraction render (same title, status icon, mode pill,
  iteration counter, entries list)

#### Scenario: FlowArchitectDetail contains no duplicated helpers

- **WHEN** static analysis inspects
  `packages/flows-plugin/src/client/FlowArchitect.tsx`
- **THEN** the file SHALL NOT contain a local `function ToolCallEntry`,
  `function TextEntry`, `function ThinkingEntry`, or `function
  extractInputPreview` declaration
- **AND** it SHALL import `MinimalChatView` from the
  `client-utils/minimal-chat` subpath

## ADDED Requirements

### Requirement: Architect status maps to the shared status enum

`FlowArchitectDetail` SHALL map `ArchitectState.phase` to the shared
`MinimalChatStatus` union as follows:

| `ArchitectState.phase` | `MinimalChatStatus` |
|---|---|
| `"context"`        | `"running"` |
| `"designing"`      | `"running"` |
| `"abort_pending"`  | `"running"` |
| `"complete"`       | `"complete"` |
| `"error"`          | `"error"` |
| (any other)        | `"pending"` |

The mapping SHALL be exhaustive — adding a new phase value SHALL be a
compile-time error in the shim (via `never` default).

#### Scenario: Designing phase maps to running

- **WHEN** `FlowArchitectDetail` receives `state.phase === "designing"`
- **THEN** `MinimalChatView` SHALL be called with `status: "running"`

#### Scenario: Complete phase maps to complete

- **WHEN** `FlowArchitectDetail` receives `state.phase === "complete"`
- **THEN** `MinimalChatView` SHALL be called with `status: "complete"`
