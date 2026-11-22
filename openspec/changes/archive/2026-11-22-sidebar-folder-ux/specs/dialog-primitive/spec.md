## MODIFIED Requirements

### Requirement: Focus Containment

The dialog SHALL move focus into itself on open — to the first focusable descendant marked `data-autofocus` when one exists, otherwise to the first focusable descendant — trap Tab and Shift+Tab within its focusable elements, and restore focus to the previously focused element on close.

When the dialog has no focusable descendant at the moment it opens, it SHALL keep watching its own subtree and move focus to the first focusable descendant that appears, at most once, and only while focus is still on the dialog container. A child that renders its controls asynchronously would otherwise strand focus on a non-interactive box: the built-in ✕ used to guarantee a non-empty focusable set, and suppressing it under `flush` removes that guarantee.

#### Scenario: Initial focus moves into the dialog

- **WHEN** the dialog transitions to open
- **THEN** focus moves to the first focusable descendant (matching links, enabled buttons/inputs/textareas/selects, or elements with a non-negative tabindex)
- **AND** if no focusable descendant exists, focus moves to the dialog container itself

#### Scenario: Marked control receives initial focus

- **GIVEN** a dialog whose Cancel button carries `data-autofocus` and whose first focusable element is the built-in ✕
- **WHEN** the dialog opens
- **THEN** focus SHALL be on the Cancel button

#### Scenario: Focus moves to a late-arriving focusable descendant

- **GIVEN** a dialog that opened with no focusable descendant, so focus is on the dialog container
- **WHEN** a focusable descendant first appears
- **THEN** focus SHALL move to it
- **AND** the dialog SHALL NOT move focus again for later descendants, nor take focus back from the user

#### Scenario: Hidden and aria-hidden elements are excluded from focus

- **WHEN** the dialog selects an initial or trapped focus target
- **THEN** elements carrying the `hidden` attribute or `aria-hidden="true"` are excluded from the focusable set, even when they match the focusable selector

#### Scenario: Tab cycles forward within the dialog

- **WHEN** focus is on the last focusable element and the user presses `Tab`
- **THEN** focus wraps to the first focusable element

#### Scenario: Shift+Tab cycles backward within the dialog

- **WHEN** focus is on the first focusable element and the user presses `Shift+Tab`
- **THEN** focus wraps to the last focusable element

#### Scenario: Tab is contained when no focusable element exists

- **WHEN** the dialog has no focusable descendants and the user presses `Tab`
- **THEN** the default tab behavior is prevented and focus stays on the dialog container

#### Scenario: Focus is restored on close

- **WHEN** the dialog closes or unmounts
- **THEN** focus returns to the element that was focused before the dialog opened, provided it is still in the document
