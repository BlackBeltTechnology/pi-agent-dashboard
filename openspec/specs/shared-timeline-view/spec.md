# shared-timeline-view Specification

## Purpose
TBD - created by archiving change extract-minimal-chat-view. Update Purpose after archive.
## Requirements
### Requirement: Shared timeline renderer lives in client-utils

The dashboard SHALL ship a single `MinimalChatView` React component in the workspace package `@blackbelt-technology/pi-dashboard-client-utils` under the subpath `./minimal-chat`. The package SHALL declare a corresponding `exports` entry so consumer plugins can import the component, its types, and its status union via the canonical subpath without traversing relative paths into a sibling package.

The component SHALL render the subagent-style timeline shape that both `packages/subagents-plugin/` and `packages/flows-plugin/` previously implemented inline: a header (status icon, title, optional subtitle, optional model/tokens/duration meta), a timeline body (tool / text / thinking / error entries), and a three-way `mode` switch (`inline`, `popout`, `row`).

#### Scenario: Subpath export resolves

- **WHEN** any workspace package imports `MinimalChatView` from `@blackbelt-technology/pi-dashboard-client-utils/minimal-chat`
- **THEN** TypeScript SHALL resolve the import via the package's `exports` map
- **AND** the resolved module SHALL provide named exports `MinimalChatView`, `MinimalChatStatus`, `MinimalChatEntry`, `MinimalChatMode`, `MinimalChatViewProps`

#### Scenario: Component renders entry kinds

- **WHEN** `MinimalChatView` receives `entries` containing one each of `kind: "tool"`, `kind: "text"`, `kind: "thinking"`, `kind: "error"`
- **THEN** the rendered DOM SHALL contain the tool name (for the tool entry), the markdown-rendered text (for the text entry), a collapsible "Thinking" label (for the thinking entry), and a red error line (for the error entry)
- **AND** the four entries SHALL appear in the order supplied

#### Scenario: Three modes adjust layout

- **WHEN** `MinimalChatView` is rendered with `mode="popout"`
- **THEN** the root container SHALL be `flex h-full overflow-hidden`
- **WHEN** rendered with `mode="inline"`
- **THEN** the body container SHALL cap height with `max-h-[60vh] overflow-hidden`
- **WHEN** rendered with `mode="row"`
- **THEN** the component SHALL render only a single-line summary (status icon + title + optional activity) with no entry body

### Requirement: Status enum is a normalized superset

`MinimalChatStatus` SHALL be the union `"pending" | "running" | "complete" | "error" | "blocked"`. Consumer adapters (the shims at `SubagentDetailView` and `FlowAgentDetail`) SHALL map their producer-specific enums into this union before passing the value to `MinimalChatView`.

| Producer status | Maps to |
|---|---|
| `SubagentState.status = "created"` | `"pending"` |
| `SubagentState.status = "running"` | `"running"` |
| `SubagentState.status = "completed"` | `"complete"` |
| `SubagentState.status = "failed"` | `"error"` |
| `FlowAgentState.status = "pending"` | `"pending"` |
| `FlowAgentState.status = "running"` | `"running"` |
| `FlowAgentState.status = "complete"` | `"complete"` |
| `FlowAgentState.status = "error"` | `"error"` |
| `FlowAgentState.status = "blocked"` | `"blocked"` |

#### Scenario: Status icon and color are driven by the normalized enum

- **WHEN** `MinimalChatView` receives `status="complete"`
- **THEN** the header SHALL render the `mdiCheckCircle` icon in green (`text-green-400`)
- **WHEN** `status="error"`
- **THEN** the header SHALL render `mdiCloseCircle` in red (`text-red-400`)
- **WHEN** `status="running"`
- **THEN** the header SHALL render `mdiCircle` in yellow (`text-yellow-400`)
- **WHEN** `status="blocked"`
- **THEN** the header SHALL render `mdiAlertCircle` in orange (`text-orange-400`)
- **WHEN** `status="pending"`
- **THEN** the header SHALL render `mdiCircleOutline` in the muted tertiary text color

#### Scenario: Shim normalizes subagent status

- **WHEN** `SubagentDetailView` receives a `SubagentState` with `status: "failed"`
- **THEN** `MinimalChatView` SHALL be called with `status: "error"`

#### Scenario: Shim normalizes flow status

- **WHEN** `FlowAgentDetail` receives a `FlowAgentState` with `status: "complete"`
- **THEN** `MinimalChatView` SHALL be called with `status: "complete"` (identity for this value, but exercises the adapter path)

### Requirement: Entry shape is the structural intersection plus optional fields

`MinimalChatEntry` SHALL be the discriminated union:

```ts
{ kind: "tool"; toolName: string; input: unknown; output?: unknown; isError?: boolean }
| { kind: "text"; text: string }
| { kind: "thinking"; text: string }
| { kind: "error"; text: string }
```

Consumer adapters SHALL convert their producer-specific entry arrays (`SubagentTimelineEntry[]`, `FlowDetailEntry[]`) into `MinimalChatEntry[]` before passing to `MinimalChatView`. Producer fields outside this shape (e.g. `ts: number` on `SubagentTimelineEntry`) SHALL be dropped at the shim boundary; if a future renderer-visible field is required, it MUST be added to `MinimalChatEntry` deliberately.

#### Scenario: Tool entry without output

- **WHEN** an entry `{ kind: "tool", toolName: "Read", input: { file_path: "foo.ts" } }` is rendered
- **THEN** the row SHALL show the tool name "Read" and the input preview "foo.ts"
- **AND** SHALL NOT render an expand toggle (no output to show)

#### Scenario: Tool entry with output is collapsible

- **WHEN** an entry has `output` set
- **THEN** the row SHALL render a toggle (▸/▾) that expands a pre-formatted block showing the output

#### Scenario: isError styles the tool row

- **WHEN** a tool entry has `isError: true`
- **THEN** the row's left border SHALL be `border-red-500/50` and the tool name SHALL be `text-red-400`

### Requirement: Header meta renders only when present

The header meta block (model name, tokens, duration) SHALL render only when the corresponding fields are supplied via `props.meta`. When `meta` is omitted or its fields are absent, no placeholder dashes or "—" SHALL appear.

#### Scenario: No meta supplied

- **WHEN** `MinimalChatView` is called without a `meta` prop
- **THEN** the header SHALL render the title only, with no token/duration/model badge

#### Scenario: Tokens and duration supplied

- **WHEN** `meta = { tokens: { input: 1234, output: 567 }, durationMs: 4500 }` is passed
- **THEN** the header SHALL render `↑1k ↓567 · 4.5s` (formatted via the UI primitive registry's `formatTokens` and `formatDuration`)

#### Scenario: Subtitle path renders below title

- **WHEN** `subtitle="~/.pi/agent/agents/Explore.md"` is passed
- **THEN** the second line of the title block SHALL render the path in monospace muted-tertiary text with `title` attribute set to the same value

### Requirement: UI primitives accessed via the registry

`MinimalChatView` SHALL access `MarkdownContent`, `formatTokens`, and `formatDuration` exclusively through the existing UI primitive registry (`useUiPrimitive(UI_PRIMITIVE_KEYS.*)`). It SHALL NOT import these symbols directly from shell packages.

#### Scenario: Test wrapper supplies primitives

- **WHEN** tests for `MinimalChatView` render the component
- **THEN** they SHALL wrap the render in `withUiPrimitiveProvider(...)` so the primitive hooks resolve to mock implementations
- **AND** rendering without such a wrapper SHALL throw a hook-resolution error (so missing setup is loud)

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

