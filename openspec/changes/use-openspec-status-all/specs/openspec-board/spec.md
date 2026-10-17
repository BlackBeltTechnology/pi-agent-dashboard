## ADDED Requirements

### Requirement: Card shows a per-change CLI error

When an `OpenSpecChange` carries `error: { code, message }`, its proposal card SHALL render an error badge in the card header using the severity-error token. The badge SHALL expose the message on hover and keyboard focus (`title` plus an accessible label). Because the change has `artifacts: []`, its lifecycle bar SHALL render every segment as `todo` and the change SHALL derive to `PLANNING` (so it matches the `planning` state filter). The card's `New session` / `New worktree` actions SHALL stay enabled. Other cards in the same directory SHALL render normally.

#### Scenario: Broken metadata shows an error badge

- **GIVEN** change `add-auth` arrives with `error: { code: "change_error", message: "Invalid YAML in metadata file" }`
- **WHEN** the board renders
- **THEN** the `add-auth` card SHALL show an error badge whose accessible label contains the message
- **AND** its lifecycle bar SHALL show all segments `todo`
- **AND** every other card SHALL render unchanged

#### Scenario: Missing schema names the schema

- **GIVEN** a change arrives with `error.message` "Unknown schema 'pi-spec-driven'. Available: spec-driven"
- **WHEN** the user hovers or focuses the badge
- **THEN** the full message SHALL be shown

## MODIFIED Requirements

### Requirement: Proposal cards
Each change SHALL render as a card showing its name, the compact lifecycle bar, its session list, card actions, and — only when the change carries a CLI `error` — an error badge (see "Card shows a per-change CLI error"). The card SHALL NOT render a separate state pill or a separate task-progress bar; the lifecycle bar carries both.

#### Scenario: Card content
- **WHEN** a change `add-auth` is `IMPLEMENTING` with `3/8` tasks
- **THEN** its card SHALL show the name, the lifecycle bar with the `Tasks` segment labelled `3/8`, its sessions, and `New session` / `New worktree` actions
- **AND** no state pill and no standalone progress bar SHALL render on the card
