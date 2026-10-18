## MODIFIED Requirements

### Requirement: Picker lists only providers that can be added

The dialog SHALL open on a searchable picker listing every provider that is NOT already configured, plus a pinned **Custom endpoint** entry. A configured provider SHALL NOT appear among these entries; it is managed from its row in the list. Search SHALL match on the provider's display name and id. The picker SHALL be operable by keyboard alone (type to filter, arrow keys to move, Enter to select, Esc to dismiss).

When the dashboard has the vault and the user may manage it, the picker SHALL also list, in a separate group "Another account for a connected provider", each configured OAuth provider that supports vault enrolment. Selecting one SHALL open a pane that names the account pi already uses, asks for a label, and runs the vault's enrolment, leaving `auth.json` unchanged. These entries SHALL NOT count toward the number named by the Add-provider control. After a successful enrolment, the pane SHALL offer to make the account available to a project, opening the vault's new model-provider form for that account.

#### Scenario: Configured provider absent from the picker

- **WHEN** `openrouter` is configured and the operator opens the dialog
- **THEN** `openrouter` SHALL NOT be offered in the picker

#### Scenario: Custom endpoint is always offered

- **WHEN** the picker renders, with or without a catalogue
- **THEN** a **Custom endpoint** entry SHALL be present regardless of the search term's match against known provider names

#### Scenario: Keyboard-only selection

- **WHEN** the operator types a filter, moves with arrow keys, and presses Enter
- **THEN** the highlighted provider SHALL be selected and its pane SHALL open

#### Scenario: Another account for a connected subscription

- **WHEN** `anthropic` holds a subscription in `auth.json` and the operator opens the dialog
- **THEN** the picker offers "Anthropic" under "Another account for a connected provider", and not as a provider to add
- **AND** completing it adds a vault account with the given label, leaves `auth.json` byte-identical, and does not change the Add-provider count
