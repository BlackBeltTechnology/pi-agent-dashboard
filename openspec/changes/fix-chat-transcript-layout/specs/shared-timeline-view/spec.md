## MODIFIED Requirements

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
- **THEN** the root container SHALL size to its content, capped with `max-h-[60vh] overflow-hidden`, and the body SHALL scroll at the cap
- **WHEN** rendered with `mode="row"`
- **THEN** the component SHALL render only a single-line summary (status icon + title + optional activity) with no entry body
