# client-utils-empty-state Specification

## Purpose
Define the shared `EmptyState` primitive in `client-utils`. Encodes the NN/g empty-state pattern (value-framed title, optional body, ≤1 primary CTA, ≤1 escape-hatch). Covered surfaces render empty states through it instead of bare text.
## Requirements
### Requirement: EmptyState primitive enforces the empty-state pattern

`packages/client-utils` SHALL export an `EmptyState` component taking `{ title, body?, icon?, action?, secondaryAction? }` that renders a value-framed heading, optional body, at most one primary action, and at most one secondary (escape-hatch) action. It SHALL NOT permit more than one primary action.

#### Scenario: Renders value-framed empty state

- **WHEN** `EmptyState` is rendered with `title`, `body`, and one `action`
- **THEN** it SHALL display the title, body, and a single primary CTA button

#### Scenario: Rejects multiple primary actions

- **WHEN** a consumer attempts to supply more than one primary action
- **THEN** the type/contract SHALL prevent it (single `action` prop)

### Requirement: Covered surfaces use EmptyState instead of bare text

Chat and OpenSpec board empty states SHALL render via `EmptyState` rather than a bare `<p>` string, so the empty copy carries value framing and (where applicable) a CTA.

#### Scenario: Chat empty uses EmptyState

- **WHEN** a session has zero messages and history is not loading
- **THEN** the chat empty view SHALL render an `EmptyState`, not a bare "No messages yet" paragraph

#### Scenario: Board empty uses EmptyState

- **WHEN** an OpenSpec board column/group has no proposals
- **THEN** the empty view SHALL render an `EmptyState`, not a bare "No proposals" paragraph

