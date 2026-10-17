## ADDED Requirements

### Requirement: Dependency chips on proposal cards

When dependency UI is visible for the cwd, a card SHALL render chips derived from `OpenSpecChange.dependencies`. Dependency UI is visible when the default schema is `pi-spec-driven` or any change has `dependencies.yaml`. The chips are:
- **blocked by N**: open edges, error tone.
- **satisfied**: shown in the hover list only.
- **blocks N**.
- **overlaps N**: muted.
- a **wave** badge.
- an **issues** badge: error or warning tone by worst severity.

Hover or focus SHALL list the names with source and reason. Activating a name SHALL scroll to and highlight that change's card, or open the archive entry for an archived name. Inferred edges SHALL be visually distinguishable from declared ones. When dependency UI is not visible, no chip SHALL render.

#### Scenario: Blocked card

- **GIVEN** `add-acme-dns01-certs` is blocked by the active `add-tailscale-cert-tls` (declared) and is in wave 2
- **WHEN** the board renders
- **THEN** the card SHALL show "blocked by 1" in error tone and a wave 2 badge
- **AND** focusing the chip SHALL list `add-tailscale-cert-tls` with source `declared`

#### Scenario: Hidden when not adopted

- **GIVEN** the default schema is `spec-driven` and no change has `dependencies.yaml`
- **WHEN** the board renders
- **THEN** no dependency chip or wave badge SHALL render

### Requirement: Execution-order view

The board filter bar SHALL offer a view toggle `Default | Execution order` when dependency UI is visible. In execution order, each column SHALL sort its cards by `wave` ascending, then name. Changes with `wave: null` (cycle) SHALL sort last with their issues badge. The view SHALL NOT modify the persisted `changeOrder`, and drag-reorder SHALL be disabled while it is active.

#### Scenario: Waves order the column

- **GIVEN** a column holding `c` (wave 3), `a` (wave 1), `b` (wave 2)
- **WHEN** the user selects Execution order
- **THEN** the column SHALL render `a`, `b`, `c`
- **AND** `groups.json` SHALL be unchanged

### Requirement: Dependency editor dialog

A card action "Dependencies…" SHALL open a dialog listing:
- declared `blocked_by` entries, each removable;
- inferred edges, each with "Not a dependency", which adds the name to `not_blocked_by`;
- `related` entries;
- a picker over active and archived change names to add a blocker.

Saving SHALL call `PUT /api/openspec/dependencies` and show the server error on failure. The dialog SHALL be keyboard operable with labelled controls.

#### Scenario: Reject an inferred edge

- **GIVEN** an inferred edge `foo` blocked by `bar`
- **WHEN** the user chooses "Not a dependency" and saves
- **THEN** `foo/dependencies.yaml` SHALL list `bar` under `not_blocked_by`
- **AND** after the next poll the edge SHALL no longer render
