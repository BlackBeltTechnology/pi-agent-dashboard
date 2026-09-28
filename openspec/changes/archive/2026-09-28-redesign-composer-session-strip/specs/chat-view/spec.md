## MODIFIED Requirements

### Requirement: Composer is a unified container with model/thinking inside and session actions above
The chat view's composer (`CommandInput`) SHALL render as a single bordered container ("the card") that holds, top-to-bottom:
1. an optional attachments row;
2. an **input row**: the textarea, with the inline-terminal control and the single morphing action button (send/stop) on its trailing side. Both controls SHALL be aligned to the textarea's bottom edge, so they stay beside the last line as the draft grows;
3. a **settings row**: the `＋` attach control, the `ModelSelector` chip, the `ThinkingLevelSelector` chip, and a `Steer | Queue` delivery control.

The settings row SHALL NOT contain the action button or the inline-terminal control. The textarea SHALL NOT draw a focus indicator of its own. The card's focus border SHALL be the single focus indicator and SHALL meet 3:1 non-text contrast against the surrounding surface. The standalone StatusBar model row SHALL NOT render for the selected session; model and thinking level SHALL be reachable only from the composer.

When and only when the chat view is bound to a session, a `ComposerSessionActions` context strip SHALL render **above** the card (not inside the StatusBar). It SHALL carry the OpenSpec and Git groups and the same `onSendPrompt` / `onReadArtifact` / refresh callbacks, plus `onAttach` / `onDetach`. Relocating the strip SHALL NOT change its slot wiring.

In this requirement, a session is **working** when its status is `streaming` or it is auto-retrying a provider error.

Strip structure:
- Every group (OpenSpec, Git, each `composer-context-group` contribution, Status) SHALL render as one labelled container with `role="group"`, whose accessible name is its label.
- The strip's own groups SHALL NOT draw borders around individual items inside the group. Plugin-rendered content is styled by the plugin.
- Every interactive item in the strip's own groups SHALL have a target of at least 24×24 CSS px.
- The spacing between groups SHALL be larger than the spacing between items inside a group.
- When the strip wraps, a group SHALL move to the next line as a unit. A group wider than the whole strip SHALL wrap inside its own container, keeping its label on the same line as its first item. No group SHALL overflow the strip horizontally.
- A group whose content renders nothing SHALL NOT render its container or label. This applies to the Status group too.

OpenSpec group:
- The group SHALL render only when the folder's OpenSpec readiness is ready or pending (falling back to `hasOpenspecDir !== false || pending` when readiness is unknown) and the session has not ended.
- **Unattached** (`attachedProposal == null`): the group SHALL contain:
  - an `Attach change…` control that opens the change picker, disabled and labelled "No changes" when the folder has no changes;
  - an `Explore` button;
  - a `⋯` overflow offering the same unattached workflow entries as the session card (e.g. New change…, Propose…), subject to the workflow configuration. Folder-level bulk actions MAY remain card-only.
  - It SHALL NOT contain a lifecycle bar, a primary action, or an `Archive` button.
- **Attached:** the group SHALL contain, in order:
  - a change chip showing the attached change name. It SHALL open a menu with `Open proposal` and `Detach`;
  - the OpenSpec lifecycle bar (Proposal · Design · Specs · Tasks · Archive) with the same segment states, glyphs and hatching as the session card, in its compact (letter) form;
  - at most one primary action, chosen by the same per-`ChangeState` candidate order and workflow gating as the session card;
  - a `⋯` overflow listing the same remaining items as the session card's overflow (including `Explore…`), except `Detach`.
- Every action SHALL remain subject to the folder's OpenSpec workflow configuration.
- The session card SHALL apply the same working-state definition to its OpenSpec actions and worktree actions.
- While the session is working:
  - the primary action, the `⋯` workflow items and `Explore` SHALL be disabled; a disabled action SHALL remain focusable and SHALL expose the reason;
  - the Tasks segment SHALL be inert;
  - the Proposal/Design/Specs segments, `Open proposal`, `Attach change…`, `Detach` and refresh SHALL remain enabled.

Git group:
- The group SHALL render only when `session.gitWorktree` is set.
- It SHALL begin with a worktree identity segment:
  - the branch name, when known;
  - `← <base>`, only when `gitWorktree.base` is present;
  - when `gitStatus` is present: the dirty-file count when non-zero, `↑<ahead>` / `↓<behind>` when non-zero, or a "no local changes" marker when all are zero. The marker SHALL NOT claim the branch is in sync with a remote. When `gitStatus` is absent, no drift or no-changes marker SHALL render.
  - Every marker SHALL have a text alternative.
  - The segment's tooltip SHALL name the worktree and its main checkout path.
- The identity segment SHALL be followed by the worktree actions (see `worktree-lifecycle`).

At most one control in the whole strip SHALL render as a filled primary. When the worktree Merge qualifies as the filled primary (see `worktree-lifecycle`), the OpenSpec primary SHALL render outlined and enabled. Otherwise, the OpenSpec primary is the filled one.

The strip SHALL additionally render every `composer-context-group` slot contribution between the Git group and the Status group. These contributions SHALL NOT be subject to the working-state disable that gates the strip's action buttons. The strip SHALL render whenever at least one host group or one `composer-context-group` contribution is present.

#### Scenario: Composer renders as one container with toolbar controls
- **WHEN** the chat view is bound to a session
- **THEN** the composer SHALL render a single card containing an input row and a settings row
- **AND** the input row SHALL contain the textarea, the inline-terminal control and the action button
- **AND** the settings row SHALL contain `＋`, the model chip, the thinking chip and the delivery control, and SHALL NOT contain the action button
- **AND** no standalone StatusBar model row SHALL render for that session

#### Scenario: Action button follows a growing draft
- **WHEN** the user types a four-line draft
- **THEN** the action button's bottom edge SHALL align with the textarea's bottom edge

#### Scenario: Single focus indicator
- **WHEN** the textarea receives keyboard focus
- **THEN** the card border SHALL show the focus colour at no less than 3:1 contrast
- **AND** the textarea SHALL NOT render a separate focus ring

#### Scenario: Strip groups expose group semantics
- **WHEN** the strip renders the OpenSpec and Git groups
- **THEN** each SHALL be exposed as `role="group"` with accessible name `OpenSpec` / `Git`

#### Scenario: Oversized group wraps inside itself
- **WHEN** the strip is narrower than the Git group's natural width
- **THEN** the Git group's content SHALL wrap inside its container
- **AND** the `GIT` label SHALL stay on the same line as the group's first item
- **AND** no part of the strip SHALL overflow horizontally

#### Scenario: Empty Status group leaves no label
- **WHEN** a `session-card-badge` claim exists but its component renders nothing for the bound session
- **THEN** no visible `STATUS` label or group container SHALL render

#### Scenario: Unattached session shows Explore
- **WHEN** the bound session has `attachedProposal = null` and the folder has changes
- **THEN** the OpenSpec group SHALL contain an enabled `Attach change…` control and an enabled `Explore` button
- **AND** it SHALL NOT contain a lifecycle bar or an `Archive` button

#### Scenario: Attach from the strip
- **WHEN** the user activates `Attach change…` and picks change `"add-auth"`
- **THEN** the strip SHALL invoke `onAttach` with `"add-auth"`

#### Scenario: No changes to attach
- **WHEN** the bound session is unattached and the folder has no OpenSpec changes
- **THEN** the attach control SHALL render disabled with the label `No changes`

#### Scenario: Session-action strip relocates above the card with unchanged gating
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"`, `deriveChangeState` returns `IMPLEMENTING` with `12/39` tasks, and `apply` is enabled
- **THEN** a `ComposerSessionActions` strip SHALL render above the composer card
- **AND** its OpenSpec group SHALL contain a change chip labelled `add-auth`, a lifecycle bar whose Tasks segment reads `12/39`, an `Apply` primary and a `⋯` control
- **AND** it SHALL NOT contain a standalone `Explore` button (Explore is reachable from `⋯`)

#### Scenario: Composer and session card choose the same primary
- **WHEN** the same attached session is shown in the composer strip and on its session card, for any `ChangeState` and workflow configuration
- **THEN** both SHALL offer the same primary action
- **AND** both overflows SHALL list the same workflow items, apart from `Detach`, which only the session card's overflow lists

#### Scenario: Change chip offers detach
- **WHEN** the user opens the change chip for attached change `"add-auth"` and activates `Detach`
- **THEN** the strip SHALL invoke `onDetach`
- **AND** the `⋯` overflow SHALL NOT offer `Detach`

#### Scenario: Complete change shows Archive
- **WHEN** the bound session is attached, `deriveChangeState` returns `COMPLETE`, `archive` is enabled, and Merge does not qualify as the filled primary
- **THEN** the OpenSpec group's filled primary action SHALL be `Archive`

#### Scenario: Streaming disables strip actions except refresh
- **WHEN** the bound session is attached and is working
- **THEN** the primary action and every `⋯` workflow item SHALL be disabled, and the Tasks segment SHALL be inert
- **AND** the Proposal/Design/Specs segments, `Open proposal`, `Attach change…`, `Detach` and refresh SHALL remain enabled
- **AND** each disabled item, including those inside `⋯`, SHALL remain focusable and expose why it is disabled

#### Scenario: Auto-retry counts as working
- **WHEN** the bound session's status is `idle` but it is auto-retrying a provider error
- **THEN** the OpenSpec primary action SHALL be disabled
- **AND** it SHALL remain focusable and expose why it is disabled

#### Scenario: Firing Apply from the strip dispatches the skill prompt
- **WHEN** the user clicks `Apply` in the strip for session `"s1"` with attached change `"add-auth"`
- **THEN** the strip SHALL invoke `onSendPrompt` with `/skill:openspec-apply-change add-auth`

#### Scenario: Git identity shows branch, base and drift
- **WHEN** the bound session has `gitBranch = "os/x"`, `gitWorktree = { name: "os-x", mainPath: "/repo", base: "develop" }` and `gitStatus = { dirtyCount: 3, ahead: 2, behind: 0, … }`
- **THEN** the Git group's identity segment SHALL show `os/x`, `← develop`, a dirty count of `3` and `↑2`
- **AND** it SHALL NOT show a behind count

#### Scenario: Base omitted when unknown
- **WHEN** `gitWorktree.base` is absent
- **THEN** the identity segment SHALL NOT render a `←` base marker

#### Scenario: Unknown status is not shown as clean
- **WHEN** `gitStatus` is absent
- **THEN** the identity segment SHALL render neither a no-changes marker nor drift markers

#### Scenario: Session card honours auto-retry too
- **WHEN** a session is auto-retrying a provider error and its session card is visible
- **THEN** the card's OpenSpec primary action and its worktree Push / Merge actions SHALL be disabled

#### Scenario: Green PR on a complete change takes the single primary
- **WHEN** the attached change is `COMPLETE` and the PR is open, not a draft, with `gitPrChecks = "passing"`
- **THEN** Merge SHALL render as the strip's only filled primary
- **AND** the OpenSpec primary SHALL render outlined and enabled

#### Scenario: Plugin context group renders between Git and Status and survives streaming
- **WHEN** a plugin claims `composer-context-group` whose component renders a `Quota` group and the bound session has `status = "streaming"`
- **THEN** a `QUOTA` group SHALL render after the Git group and before the Status group
- **AND** the group SHALL remain fully visible and interactive while the OpenSpec and Git action buttons are disabled

### Requirement: One morphing send/stop action button
The composer SHALL render a single action button whose glyph and behaviour derive from session state, replacing the previous four-button cluster.
- WHEN idle with a non-empty draft, it SHALL render a send affordance (enabled).
- WHEN idle with an empty draft, it SHALL render the send affordance disabled.
- WHEN the session is working (`streaming` or `retrying`), it SHALL render a stop affordance. A first activation SHALL request abort and a second activation SHALL escalate to force-stop, preserving the existing `idle → aborting → killing` escalation semantics.

While working, the `stop-after-turn` affordance SHALL render joined to the stop affordance as one split control (`after turn | stop`), not as a separate control elsewhere in the composer. When the composer is narrow, the `after turn` label MAY collapse to an icon, which SHALL keep its accessible name. Every icon-only state SHALL carry an `aria-label`. The action button SHALL render in the composer's input row (see the unified-composer requirement).

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
- **THEN** a stop-after-turn control SHALL render immediately adjacent to the stop affordance, as one split control
- **AND** activating it SHALL request stop-after-turn, not an abort

### Requirement: Mobile composer adaptation
The composer SHALL fold based on the composer container width (container query), NOT the viewport width, so a narrow split chat pane on a wide viewport folds identically to a phone. When the composer container is narrow:
- the input row SHALL keep the textarea and the action button;
- the settings row SHALL keep `＋`, the model chip and a `⋯` overflow control;
- thinking level, the `Steer | Queue` control and the inline terminal SHALL be reachable from the `⋯` overflow;
- attach/tools SHALL be reachable from the `＋` menu.

The fold threshold SHALL sit above the composer's natural inline width, so the fully-inline layout never overflows its pane. The send/stop action button SHALL be at least 44×44 CSS px and SHALL never be clipped by the pane.

#### Scenario: Overflow hosts folded controls on mobile
- **WHEN** the composer renders at phone width
- **THEN** the input row SHALL contain the textarea and the action button
- **AND** the settings row SHALL contain `＋`, model and `⋯`
- **AND** thinking / delivery / terminal SHALL be reachable from `⋯`

#### Scenario: Narrow split pane folds controls on a wide viewport
- **WHEN** the composer renders inside a split chat pane narrower than its natural inline width, while the browser viewport is wide
- **THEN** thinking / delivery / terminal SHALL fold into the `⋯` overflow
- **AND** the send/stop action button SHALL remain fully visible within the pane (no clipping by `overflow-hidden`)

#### Scenario: Wide composer keeps controls inline
- **WHEN** the composer container is at least as wide as its natural inline width
- **THEN** thinking level and `Steer | Queue` SHALL render inline in the settings row, and the inline terminal SHALL render inline in the input row
- **AND** the `⋯` overflow control SHALL be hidden

#### Scenario: Action button meets touch-target minimum
- **WHEN** the composer renders at phone width
- **THEN** the send/stop action button SHALL be at least 44×44 CSS px
