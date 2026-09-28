## MODIFIED Requirements

### Requirement: Composer is a unified container with model/thinking inside and session actions above
The chat view's composer (`CommandInput`) SHALL render as a single bordered container ("the card") that holds, top-to-bottom: an optional attachments row, the textarea, and an inner toolbar. The inner toolbar SHALL host — in one row — a `＋` attach control, the `ModelSelector` chip, the `ThinkingLevelSelector` chip, a `Steer | Queue` delivery control, an inline-terminal control, and a single morphing action button (send/stop). The standalone StatusBar model row SHALL NOT render for the selected session; model and thinking level SHALL be reachable only from the composer toolbar.

When and only when the chat view is bound to a session, a `ComposerSessionActions` context strip SHALL render **above** the card (not inside the StatusBar). It SHALL carry the OpenSpec and Git groups and the same `onSendPrompt` / `onReadArtifact` / refresh callbacks. Relocating the strip SHALL NOT change its slot wiring.

OpenSpec group gating:
- `Explore` SHALL render only when `!attachedProposal`, and SHALL NOT render at all when a proposal is attached.
- `Archive` SHALL render only when a proposal is attached AND `deriveChangeState === COMPLETE`. No disabled Archive button SHALL render.
- Every action SHALL remain subject to the folder's OpenSpec workflow configuration.
- The P/D/S artifact chips SHALL reflect the lifecycle bar's segment states, with `skipped` shown as done.
- The tasks chip SHALL render `<completed>/<total>` as its primary text with a proportional progress underline, replacing the `T` letter. It SHALL render only when `totalTasks > 0`. Its accessible name SHALL be "Tasks <completed> of <total> done".
- All actions SHALL be disabled when `status === "streaming"`, except refresh and the P/D/S chips. The P/D/S chips open read-only previews. The tasks chip SHALL be disabled while streaming, because its list can toggle checkboxes.
- The OpenSpec group SHALL be hidden when `hasOpenspecDir === false && pending === false`.

The strip SHALL additionally render every `composer-context-group` slot contribution between the Git group and the Status group. These contributions SHALL NOT be subject to the streaming disable that gates the strip's action buttons. The strip SHALL render whenever at least one host group or one `composer-context-group` contribution is present. Plugin groups SHALL render as one non-wrapping unit (divider + label + content) so the strip's wrapping never orphans a group label; host groups keep their existing markup.

#### Scenario: Composer renders as one container with toolbar controls
- **WHEN** the chat view is bound to a session
- **THEN** the composer SHALL render a single card containing the textarea and an inner toolbar
- **AND** the toolbar SHALL contain the model chip, thinking chip, delivery control, `＋`, inline-terminal, and the action button
- **AND** no standalone StatusBar model row SHALL render for that session

#### Scenario: Session-action strip relocates above the card with unchanged gating
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING` with `12/39` tasks
- **THEN** a `ComposerSessionActions` strip SHALL render above the composer card
- **AND** it SHALL NOT contain an `Explore` button or an `Archive` button
- **AND** it SHALL contain a tasks chip labelled `12/39`

#### Scenario: Complete change shows Archive
- **WHEN** the bound session is attached and `deriveChangeState` returns `COMPLETE`
- **THEN** the strip SHALL contain an enabled `Archive` button

#### Scenario: Unattached session shows Explore
- **WHEN** the bound session has `attachedProposal = null`
- **THEN** the strip SHALL contain an enabled `Explore` button and no `Archive` button

#### Scenario: Streaming disables strip actions except refresh
- **WHEN** the bound session has `status = "streaming"`
- **THEN** every OpenSpec and Git action button in the strip SHALL be disabled, including the tasks chip
- **AND** the refresh button SHALL remain enabled
- **AND** the P/D/S artifact chips SHALL remain enabled
- **AND** the tasks chip SHALL be disabled

#### Scenario: Firing Apply from the strip dispatches the skill prompt
- **WHEN** the user clicks `Apply` in the strip for session `"s1"` with attached change `"add-auth"`
- **THEN** the strip SHALL invoke `onSendPrompt` with `/skill:openspec-apply-change add-auth`

#### Scenario: Plugin context group renders between Git and Status and survives streaming
- **WHEN** a plugin claims `composer-context-group` whose component renders a `Quota` group and the bound session has `status = "streaming"`
- **THEN** a `QUOTA` group SHALL render after the Git group and before the Status group
- **AND** the group SHALL remain fully visible and interactive while the OpenSpec and Git action buttons are disabled
