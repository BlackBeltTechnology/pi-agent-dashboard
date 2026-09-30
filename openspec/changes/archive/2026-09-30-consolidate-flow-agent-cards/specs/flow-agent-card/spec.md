## MODIFIED Requirements

### Requirement: Code nodes expose a handler-source open affordance

A `FlowAgentCard` SHALL render a code-source button (`mdiCodeBraces`, title
"Open handler in editor") in the card's bottom-right control row when its node
kind is `code` or `code-decision` AND it has a resolved `codeTarget`. Clicking it
SHALL open that handler file in the HOST editor pane, by navigating to the in-app
route `/session/:id/editor?file=<path>` through the shared `useOpenFileInEditor`
hook (wouter navigation, the same deep link the host's own file links and the
`goal-plugin`/flows YAML button use). The card SHALL NOT open a shell `ui:dialog`
for the handler and SHALL NOT fetch the handler's content: no `Dialog`, no fenced
`ts` rendering, and no `/api/pi-resource-file` request SHALL be issued by the card.

The affordance SHALL be available only where an editor can be targeted: without a
session id the hook yields no opener, so the code-source button SHALL NOT render.

The existing agent `.md` doc-open affordance (gated on `sourcePath`) SHALL be
unchanged in behaviour and SHALL be additive and independent of the code-source
button: both use the same session-scoped editor route, and a code-kind card
carrying both a `sourcePath` and a `codeTarget` SHALL render both buttons, each
opening its own file. The code-source affordance SHALL render only for code-kind
nodes.

**Name note (why two scenarios below still say "dialog").** This requirement was
authored by `open-code-handler-from-flow-card`, whose implementation opened a
`Dialog` and fetched `/api/pi-resource-file?path=<codeTarget>`. That was
superseded by `attach-flow-before-run`, whose design states that the file buttons
(flow YAML, agent `.md`, handler) open the file in the host's built-in editor via
the existing `/session/:id/editor?file=<path>` route, replacing the source
dialogs. This MODIFIED block is the reconciliation of that drift. A MODIFIED
block replaces the whole requirement and MUST NOT drop a scenario name the
current spec still has, so the two dialog-named scenarios are retained verbatim
in name and restated in body to the shipped editor behaviour.

#### Scenario: Code icon shows for a code node with a target

- **WHEN** a flow agent card renders for a node whose kind is `code` or
  `code-decision` and `codeTarget` is set
- **THEN** the card SHALL render a code-source (`mdiCodeBraces`) button in its
  control row
- **AND** that button's title SHALL be "Open handler in editor"

#### Scenario: No code icon for agent nodes

- **WHEN** a flow agent card renders for an `agent`-kind node
- **THEN** the card SHALL NOT render the code-source button (only the existing
  agent doc/source affordances may appear)

#### Scenario: No code icon when target missing

- **WHEN** a code-kind card has no `codeTarget`
- **THEN** the card SHALL NOT render the code-source button

#### Scenario: Clicking the code icon opens the handler in a dialog

- **WHEN** the user clicks the code-source button on a code-kind card
- **THEN** the app SHALL navigate to
  `/session/<sessionId>/editor?file=<codeTarget>`
- **AND** the handler SHALL render in the host editor pane
- **AND** no `Dialog` SHALL open
- **AND** the card SHALL NOT fetch the handler's content

#### Scenario: Fetch error surfaces in the dialog

- **WHEN** the handler path cannot be read by the host editor
- **THEN** the error SHALL surface in the host editor pane, which owns the
  read and its failure state
- **AND** the card SHALL NOT carry a loading / loaded / error state for the
  handler, because it performs no fetch of its own

#### Scenario: Code icon is hidden without a session id

- **WHEN** a code-kind card with a `codeTarget` renders without a session id
- **THEN** the card SHALL NOT render the code-source button, because no editor can
  be targeted

#### Scenario: Agent doc button stays additive

- **WHEN** a code-kind card carries both a `sourcePath` and a `codeTarget`
- **THEN** the card SHALL render both the agent doc button and the code-source
  button
- **AND** each button SHALL open its own file in the host editor via the same
  `/session/<sessionId>/editor?file=<path>` route

#### Scenario: Absolute target passed verbatim

- **WHEN** the card opens a code node's handler
- **THEN** the card SHALL pass `codeTarget` verbatim as the route's `file` query
  parameter (`useOpenFileInEditor` percent-encodes it and nothing else)
- **AND** the path SHALL NOT be resolved, rewritten, or trimmed by the card (the
  upstream `flow_agent_started` event emits an absolute path; a relative path is
  left as emitted, and interpreting it is the editor route's job)
