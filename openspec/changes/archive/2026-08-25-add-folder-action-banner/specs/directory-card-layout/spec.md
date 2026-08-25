## ADDED Requirements

### Requirement: The directory card has a named tier model with a call-to-action tier

The directory card SHALL be organised into named tiers, so that every element on the card has one defensible home:

| Tier | Content | Rule |
|---|---|---|
| 1 | identity + urgency — folder icon, path, status, the folder actions menu trigger | — |
| 2 | git facts — branch, dirty state | facts only, no call-to-action control |
| 0 | the call-to-action banner | renders only when the folder cannot proceed |
| 3 | directory state pills — Automations, Goals, KB, OpenSpec | state only |

Tier 0 SHALL render **below tier 2** — below the git row when one exists, and directly below the tier-1 header row when the directory has no git row. It is numbered 0 because, when present, it outranks every other tier in importance while remaining below the identity block visually.

The tier model was previously described only in change prose and bound nothing. It is promoted here because tier 0 is introduced by this change and its placement, exclusivity and gating rules need a normative home.

#### Scenario: Tier 0 sits below the git row

- **GIVEN** a git-backed directory qualifying for a banner
- **WHEN** the card renders
- **THEN** the banner SHALL render below the git row and above the slot-pill grid

#### Scenario: Tier 0 sits below the header when there is no git row

- **GIVEN** a non-git directory qualifying for a banner
- **WHEN** the card renders
- **THEN** the banner SHALL render directly below the header row and above the slot-pill grid

### Requirement: Card invariants govern where an element may live

The directory card SHALL uphold four invariants:

1. **Pills read a number; the menu changes something.** A state pill SHALL NOT host a mutation control.
2. **Tier 2 is facts only.** The git row SHALL carry no call-to-action beyond the branch/dirty affordances themselves.
3. **Tier 0 means the folder cannot proceed.** An optional, non-blocking or merely-informational state SHALL NOT render a banner; it is a menu affordance.
4. **No glyph may mean two things on the same card.** Glyph distinctness SHALL be assessed against what the rendered card shows, not against a repo-wide inventory.

#### Scenario: A non-blocking state does not banner

- **GIVEN** a directory whose only pending state is optional or informational
- **WHEN** the card renders
- **THEN** no tier-0 banner SHALL render
- **AND** the state SHALL be reachable from the folder actions menu

#### Scenario: The git row carries no call to action

- **GIVEN** a directory with a pending initialization
- **WHEN** the card renders
- **THEN** the git row SHALL carry only branch and dirty-state affordances
- **AND** the initialization control SHALL render in tier 0
