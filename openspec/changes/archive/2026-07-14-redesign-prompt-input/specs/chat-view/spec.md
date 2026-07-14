# chat-view (delta: redesign-prompt-input)

## RENAMED Requirements

- FROM: `### Requirement: Composer mounts a session-action strip above the textarea`
- TO: `### Requirement: Composer is a unified container with model/thinking inside and session actions above`

## MODIFIED Requirements

### Requirement: Composer is a unified container with model/thinking inside and session actions above
The chat view's composer (`CommandInput`) SHALL render as a single bordered container ("the card") that holds, top-to-bottom: an optional attachments row, the textarea, and an inner toolbar. The inner toolbar SHALL host — in one row — a `＋` attach control, the `ModelSelector` chip, the `ThinkingLevelSelector` chip, a `Steer | Queue` delivery control, an inline-terminal control, and a single morphing action button (send/stop). The standalone StatusBar model row SHALL NOT render for the selected session; model and thinking level SHALL be reachable only from the composer toolbar.

When and only when the chat view is bound to a session, a `ComposerSessionActions` context strip SHALL render **above** the card (not inside the StatusBar), carrying the same OpenSpec and Git groups, the same action gating (`Explore` enabled only when `!attachedProposal`; `Archive` enabled only when `attachedProposal`; all actions disabled when `status === "streaming"` except refresh; OpenSpec group hidden when `hasOpenspecDir === false && pending === false`), and the same `onSendPrompt` / `onReadArtifact` / refresh callbacks as before. Relocating the strip SHALL NOT change its behaviour or slot wiring.

#### Scenario: Composer renders as one container with toolbar controls
- **WHEN** the chat view is bound to a session
- **THEN** the composer SHALL render a single card containing the textarea and an inner toolbar
- **AND** the toolbar SHALL contain the model chip, thinking chip, delivery control, `＋`, inline-terminal, and the action button
- **AND** no standalone StatusBar model row SHALL render for that session

#### Scenario: Session-action strip relocates above the card with unchanged gating
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** a `ComposerSessionActions` strip SHALL render above the composer card
- **AND** it SHALL contain a disabled `Explore` button and an enabled `Archive` button (gating identical to the sidebar)

#### Scenario: Streaming disables strip actions except refresh
- **WHEN** the bound session has `status = "streaming"`
- **THEN** every action button in the strip SHALL be disabled
- **AND** the refresh button SHALL remain enabled

#### Scenario: Firing Apply from the strip dispatches the skill prompt
- **WHEN** the user clicks `Apply` in the strip for session `"s1"` with attached change `"add-auth"`
- **THEN** the strip SHALL invoke `onSendPrompt` with `/skill:openspec-apply-change add-auth`

## ADDED Requirements

### Requirement: One morphing send/stop action button
The composer SHALL render a single action button whose glyph and behaviour derive from session state, replacing the previous four-button cluster. WHEN idle with non-empty draft it SHALL render a send affordance (enabled). WHEN idle with an empty draft it SHALL render the send affordance disabled. WHEN the session is working (`streaming` or `retrying`) it SHALL render a stop affordance; a first activation SHALL request abort and a second activation SHALL escalate to force-stop, preserving the existing `idle → aborting → killing` escalation semantics. A `stop-after-turn` affordance SHALL render as a slim secondary control beside the action button while working, not as an additional primary icon. Every icon-only state SHALL carry an `aria-label`.

#### Scenario: Send disabled while empty
- **WHEN** the draft is empty and the session is idle
- **THEN** the action button SHALL render a disabled send affordance

#### Scenario: Send enabled with text
- **WHEN** the draft is non-empty and the session is idle
- **THEN** the action button SHALL render an enabled send affordance
- **AND** activating it SHALL send the draft

#### Scenario: Morph to stop while working
- **WHEN** the session status is `streaming`
- **THEN** the action button SHALL render a stop affordance
- **AND** a first activation SHALL request abort
- **AND** a second activation SHALL escalate to force-stop

### Requirement: Delivery mode is a visible Steer/Queue control
The composer SHALL render a delivery control with two states, `Steer` and `Queue`, defaulting to `Steer`. The control SHALL map to the existing keyboard contract: `Enter` delivers per the selected state (`Steer` = steer, `Queue` = follow-up) and `Alt+Enter` delivers as follow-up regardless. Selecting a state and pressing `Enter` SHALL produce the same `delivery` value the keyboard contract produces.

#### Scenario: Queue selected routes Enter to follow-up
- **WHEN** the delivery control is set to `Queue`
- **AND** the user presses `Enter` on a non-empty draft
- **THEN** the composer SHALL send with `delivery = "followUp"`

#### Scenario: Steer selected routes Enter to steer
- **WHEN** the delivery control is set to `Steer`
- **AND** the user presses `Enter` on a non-empty draft
- **THEN** the composer SHALL send with `delivery = "steer"`

### Requirement: Footer hint line revealed on focus
The composer SHALL render a footer hint line listing the key affordances (`⏎` send, `⇧⏎` newline, `/` commands, `@` files, `!` shell). The footer SHALL be hidden while the composer is unfocused and empty, and SHALL appear on focus or first keystroke, so the resting composer height stays within ~15% of the pre-redesign height. Footer text SHALL meet WCAG-AA contrast against its background.

#### Scenario: Footer hidden at rest
- **WHEN** the composer is unfocused and the draft is empty
- **THEN** the footer hint line SHALL NOT be visible

#### Scenario: Footer revealed on focus
- **WHEN** the composer receives focus
- **THEN** the footer hint line SHALL become visible

### Requirement: Attach menu entry point
The composer SHALL render a `＋` control that opens a menu offering, at minimum, attach image, attach file, and inline preview (`/view`). Selecting attach-image SHALL follow the same image-attachment path as paste; selecting inline preview SHALL follow the existing `/view` local-interception path.

#### Scenario: Attach menu opens
- **WHEN** the user activates the `＋` control
- **THEN** a menu SHALL render with image, file, and preview entries

### Requirement: Mobile composer adaptation
At a phone-width viewport the composer toolbar SHALL keep a persistent row of `＋`, the model chip, a `⋯` overflow control, and the action button; thinking level, the `Steer | Queue` control, and the inline terminal SHALL be reachable from the `⋯` overflow, and attach/tools from the `＋` menu. The send/stop action button SHALL be at least 44×44 CSS px.

#### Scenario: Overflow hosts folded controls on mobile
- **WHEN** the composer renders at phone width
- **THEN** the persistent toolbar row SHALL contain `＋`, model, `⋯`, and the action button
- **AND** thinking / delivery / terminal SHALL be reachable from `⋯`

#### Scenario: Action button meets touch-target minimum
- **WHEN** the composer renders at phone width
- **THEN** the send/stop action button SHALL be at least 44×44 CSS px
