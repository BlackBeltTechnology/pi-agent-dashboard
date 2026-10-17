## MODIFIED Requirements

### Requirement: Per-session actions on proposal cards
Each session row SHALL expose lifecycle actions — resume/continue, fork, and hide/unhide — and an OpenSpec command menu. The menu SHALL expose the session OpenSpec block as defined by `openspec-attach-combo` (independent of how the desktop session card condenses its own controls): for an attached session, the header with at most one state-driven primary action plus a `⋯` overflow (Fast-forward / Verify / Archive anyway… / Explore… / Detach as applicable), and the lifecycle bar. Action clicks SHALL NOT trigger row navigation.

#### Scenario: Resume and fork available
- **WHEN** a session row has a session file
- **THEN** the row SHALL offer a fork action, and a resume action when the session is ended or hidden

#### Scenario: Hide toggles
- **WHEN** the user activates hide on a visible session row
- **THEN** the session SHALL be hidden and the row SHALL offer an unhide action

#### Scenario: OpenSpec command menu
- **WHEN** the user opens the OpenSpec command menu of a session row attached to an `IMPLEMENTING` change, with all workflows enabled
- **THEN** it SHALL show an **Apply** primary action and a `⋯` button
- **AND** the `⋯` menu SHALL list **Explore…** and **Detach**

#### Scenario: Action click does not navigate
- **WHEN** the user clicks any session-row action
- **THEN** the app SHALL NOT navigate to the session chat view

#### Scenario: Board rows keep inline OpenSpec controls after the session card condenses
- **WHEN** a session row for a session attached to an `IMPLEMENTING` change renders on a proposal card, while the desktop session card for the same session shows no Apply button
- **THEN** the board row's OpenSpec command menu SHALL still show the **Apply** primary action and its `⋯` button
