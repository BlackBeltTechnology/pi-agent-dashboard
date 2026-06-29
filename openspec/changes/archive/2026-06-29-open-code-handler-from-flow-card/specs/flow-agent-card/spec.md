# flow-agent-card delta

## ADDED Requirements

### Requirement: Code nodes expose a handler-source open affordance

A `FlowAgentCard` SHALL render a code-source button (`mdiCodeBraces`) in the
card's bottom-right control row when its node kind is `code` or `code-decision`
AND it has a resolved `codeTarget`. The button SHALL open the shell `ui:dialog`
primitive. The dialog body SHALL fetch the
handler file via `GET /api/pi-resource-file?path=<codeTarget>` and render the
returned content. Because the handler is TypeScript (not markdown), the content
SHALL be wrapped in a fenced `ts` code block before being passed to the
`ui:markdown-content` primitive. The fetch SHALL reuse the same loading / loaded
/ error state machine the card uses for the agent `.md` source.

The existing agent `.md` doc-open affordance (gated on `sourcePath`) SHALL be
unchanged; the code-source affordance is additive and SHALL render only for
code-kind cards.

#### Scenario: Code icon shows for a code node with a target

- **WHEN** a flow agent card renders for a node whose kind is `code` or
  `code-decision` and `codeTarget` is set
- **THEN** the card SHALL render a code-source (`mdiCodeBraces`) button in its
  control row

#### Scenario: No code icon for agent nodes

- **WHEN** a flow agent card renders for an `agent`-kind node
- **THEN** the card SHALL NOT render the code-source button (only the existing
  agent doc/source affordances may appear)

#### Scenario: No code icon when target missing

- **WHEN** a code-kind card has no `codeTarget`
- **THEN** the card SHALL NOT render the code-source button

#### Scenario: Clicking the code icon opens the handler in a dialog

- **WHEN** the user clicks the code-source button on a code-kind card
- **THEN** a `Dialog` SHALL open and the card SHALL fetch
  `/api/pi-resource-file?path=<codeTarget>`
- **AND** on success the handler content SHALL be rendered as a fenced `ts`
  code block via `ui:markdown-content`

#### Scenario: Fetch error surfaces in the dialog

- **WHEN** the handler fetch fails or returns an error response
- **THEN** the dialog SHALL show the error message instead of source content

#### Scenario: Absolute target passed verbatim

- **WHEN** the card fetches a code node's handler source
- **THEN** the card SHALL pass `codeTarget` verbatim to
  `/api/pi-resource-file?path=<codeTarget>` (the upstream `flow_agent_started`
  event emits an absolute path, which `path.resolve` leaves unchanged and the
  server allow-list `<cwd>/.pi/...` accepts)
