## REMOVED Requirements

### Requirement: Composer is a unified container with model/thinking inside and session actions above
**Reason**: The composer stack is redesigned. The context strip above the card becomes the composer dock, the settings row and input row merge into one toolbar row with the action button at its end, the inline-terminal chip moves into the `＋` menu, and model and thinking merge into one chip.
**Migration**: The card's structure is "Composer card has an input row and one toolbar row" and "Composer toolbar shows working status and one model chip" (this capability). The OpenSpec group, Git group, single-primary, working-state and plugin context-group rules move unchanged in substance to `composer-dock` (OpenSpec lane, Changes lane, Context lane).

## ADDED Requirements

### Requirement: Composer card has an input row and one toolbar row
The composer SHALL render as one bordered card holding an optional attachments row, an input row containing only the textarea, one toolbar row, and the existing focus-revealed footer hint line. The toolbar's leading cluster SHALL hold `＋` and the delivery control; its trailing cluster SHALL end with the action cluster. The inline terminal SHALL be a `＋` menu item named `Open inline terminal`. The card border SHALL be the only focus indicator, at 3:1 non-text contrast.

#### Scenario: Composer renders as one container with toolbar controls
- **WHEN** the chat view is bound to a session and the composer container is at least 880 px wide
- **THEN** the composer SHALL render a single card containing an input row and a toolbar row
- **AND** the input row SHALL contain the textarea only
- **AND** the toolbar row SHALL contain `＋`, the delivery control, the merged model chip and, at its trailing end, the action button

#### Scenario: Inline terminal is reached from the add menu
- **WHEN** the user opens the `＋` menu
- **THEN** the menu SHALL offer an item with accessible name "Open inline terminal"
- **AND** no inline-terminal chip SHALL render in the toolbar row

#### Scenario: Toolbar row never overflows
- **WHEN** the composer container is 1 px wider than a fold threshold and the longest model id is selected
- **THEN** the merged model chip SHALL truncate the model id with an ellipsis, keeping its full value in its accessible name
- **AND** the toolbar row SHALL NOT overflow horizontally

#### Scenario: Action button stays at the draft's bottom edge
- **WHEN** the user types a four-line draft
- **THEN** the action button SHALL remain at the bottom-right of the card, below the textarea's last line

#### Scenario: Single focus indicator
- **WHEN** the textarea receives keyboard focus
- **THEN** the card border SHALL show the focus colour at no less than 3:1 contrast
- **AND** the textarea SHALL NOT render a separate focus ring

### Requirement: Composer toolbar shows working status and one model chip
While working, the toolbar SHALL show the working status as text in `--text-secondary` beside an `aria-hidden` status shape; no standalone status row SHALL render. Model and thinking level SHALL share one chip that shows and names both, opening one non-modal popover with the model list and the thinking levels. The toolbar SHALL NOT render a context gauge; the session header owns context usage.

#### Scenario: Working status lives in the toolbar
- **WHEN** the session is streaming and running a bash tool
- **THEN** the toolbar SHALL show `Running bash…` beside an `aria-hidden` status shape
- **AND** no standalone working-status row and no standalone StatusBar model row SHALL render

#### Scenario: Merged model chip names both values
- **WHEN** the session runs `anthropic/claude-opus-5-5` at thinking level `xhigh`
- **THEN** one chip SHALL show the model id and `xhigh`, and its accessible name SHALL contain both
- **AND** activating it SHALL open one popover offering the model list and the thinking levels

#### Scenario: No context gauge in the toolbar
- **WHEN** the composer renders for a session with 46% of its context used
- **THEN** the toolbar row SHALL render no context ring or bar

## MODIFIED Requirements

### Requirement: One morphing send/stop action button
The composer SHALL render a single action button whose glyph and behaviour derive from session state, replacing the previous four-button cluster.
- WHEN idle with a non-empty draft, it SHALL render a send affordance (enabled).
- WHEN idle with an empty draft, it SHALL render the send affordance disabled.
- WHEN the session is working (`streaming` or `retrying`), it SHALL render a stop affordance. A first activation SHALL request abort and a second activation SHALL escalate to force-stop, preserving the existing `idle → aborting → killing` escalation semantics.

While working, the `stop-after-turn` affordance SHALL render immediately before the stop affordance, and the two SHALL form one labelled group (`Stop options`), not separate controls elsewhere in the composer. When the composer is narrow, the `after turn` label MAY collapse to an icon, which SHALL keep its accessible name. Every icon-only state SHALL carry an `aria-label`. The action button SHALL render at the trailing end of the composer's toolbar row (see "Composer card has an input row and one toolbar row"), SHALL be at least 44×44 CSS px, and SHALL paint its send and stop states from theme tokens rather than fixed palette colours. The force-stop state SHALL differ from the stop state by glyph as well as colour.

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

#### Scenario: Stop-after-turn joins the stop control
- **WHEN** the session status is `streaming`
- **THEN** a stop-after-turn control SHALL render immediately before the stop affordance, in one group named `Stop options`
- **AND** activating it SHALL request stop-after-turn, not an abort

#### Scenario: Action button sits at the toolbar's trailing end
- **WHEN** the composer renders at any width
- **THEN** the action button SHALL be the last control of the toolbar row and SHALL NOT render in the input row

#### Scenario: Force-stop is not colour-only
- **WHEN** the stop state escalates to force-stop
- **THEN** the action button's glyph SHALL change as well as its colour

### Requirement: Delivery mode is a visible Steer/Queue control
The composer SHALL render a delivery control with two states, `Steer` and `Queue`, defaulting to `Steer`. The control SHALL be a chip that shows the current state and opens a menu offering both states, each with a one-line description and its key. Below a 420 px composer container, the delivery states SHALL be offered inside the `＋` menu instead of a chip. The control SHALL map to the existing keyboard contract: `Enter` delivers per the selected state (`Steer` = steer, `Queue` = follow-up) and `Alt+Enter` delivers as follow-up regardless. Selecting a state and pressing `Enter` SHALL produce the same `delivery` value the keyboard contract produces.

#### Scenario: Queue selected routes Enter to follow-up
- **WHEN** the delivery control is set to `Queue`
- **AND** the user presses `Enter` on a non-empty draft
- **THEN** the composer SHALL send with `delivery = "followUp"`

#### Scenario: Steer selected routes Enter to steer
- **WHEN** the delivery control is set to `Steer`
- **AND** the user presses `Enter` on a non-empty draft
- **THEN** the composer SHALL send with `delivery = "steer"`

#### Scenario: Delivery menu describes both states
- **WHEN** the user opens the delivery chip
- **THEN** the menu SHALL offer `Steer` and `Queue` as radio items, the current one checked, each with its description and key

#### Scenario: Delivery folds into the add menu when narrow
- **WHEN** the composer container is 375 px wide
- **THEN** no delivery chip SHALL render in the toolbar row
- **AND** the `＋` menu SHALL offer `Steer` and `Queue` as radio items

### Requirement: Mobile composer adaptation
The composer SHALL fold based on the composer container width (container query), NOT the viewport width, so a narrow split chat pane on a wide viewport folds identically to a phone. The toolbar row SHALL fold in steps:
- below 55rem (880 px at the default 16 px root): the stop-after-turn label and the labels of other toolbar controls MAY collapse to icons, keeping their accessible names;
- below 40rem (640 px): the working-status word becomes visually hidden but stays exposed to assistive technology, its status shape stays visible, and the delivery chip drops its text label;
- below 26.25rem (420 px): the delivery states move into the `＋` menu, and the merged model chip drops the thinking level from its face (keeping it in its accessible name).

The `＋` menu SHALL be the toolbar's only fold host; no `⋯` overflow control SHALL render. A toolbar control that folds below 420 px SHALL be offered inside `＋`. Thinking level stays reachable from the merged model chip and the inline terminal from `＋` at every width. The send/stop action button SHALL be at least 44×44 CSS px and SHALL never be clipped by the pane.

#### Scenario: Overflow hosts folded controls on mobile
- **WHEN** the composer renders at phone width
- **THEN** the toolbar row SHALL contain `＋`, the merged model chip and the action button
- **AND** thinking level SHALL be reachable from the merged model chip, and delivery and the inline terminal from `＋`, which hosts the folded controls
- **AND** no `⋯` overflow control SHALL render

#### Scenario: Narrow split pane folds controls on a wide viewport
- **WHEN** the composer renders inside a split chat pane narrower than 420 px, while the browser viewport is wide
- **THEN** the delivery states SHALL be offered from `＋`
- **AND** the send/stop action button SHALL remain fully visible within the pane (no clipping by `overflow-hidden`)

#### Scenario: Wide composer keeps controls inline
- **WHEN** the composer container is at least 880 px wide
- **THEN** the delivery chip with its label and the working-status word (while working) SHALL render inline in the toolbar row
- **AND** no `⋯` overflow control SHALL render

#### Scenario: Action button meets touch-target minimum
- **WHEN** the composer renders at phone width
- **THEN** the send/stop action button SHALL be at least 44×44 CSS px
