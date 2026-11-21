## MODIFIED Requirements

### Requirement: Dialog focus management

When a `Dialog` opens it SHALL move focus into the dialog — to the first
focusable descendant marked `data-autofocus` when one exists, otherwise to the
first focusable element — and trap keyboard focus within it; when it closes it SHALL restore focus to the
element that was focused before the dialog opened.

When the dialog opens with NO focusable child, it SHALL keep watching its own
subtree and move focus to the first focusable child that appears — at most
once, and only while focus is still on the container. Suppressing the built-in
✕ under `flush` removed the guarantee that a focusable child always existed at
open time, and a surface that renders its controls asynchronously would
otherwise strand focus on a non-interactive box.

#### Scenario: Initial focus on open

- **WHEN** a `Dialog` transitions from `open={false}` to `open={true}`
- **THEN** focus SHALL move to the first focusable element inside the
  dialog, or to the dialog container itself if no focusable child exists

#### Scenario: Marked control receives initial focus

- **GIVEN** a `Dialog` whose Cancel button carries `data-autofocus` and whose
  first focusable element is the built-in ✕
- **WHEN** the dialog opens
- **THEN** focus SHALL be on the Cancel button

#### Scenario: Focus follows a late-arriving focusable child

- **GIVEN** a `Dialog` that opened with no focusable child, leaving focus on
  the container
- **WHEN** a focusable child first appears
- **THEN** focus SHALL move to it, once, and SHALL NOT be taken back from the
  user afterwards

#### Scenario: Focus trap on Tab

- **WHEN** the user presses `Tab` while focus is on the last focusable
  element inside the dialog
- **THEN** focus SHALL move to the first focusable element inside the
  dialog (not to elements outside)

#### Scenario: Focus trap on Shift+Tab

- **WHEN** the user presses `Shift+Tab` while focus is on the first
  focusable element inside the dialog
- **THEN** focus SHALL move to the last focusable element inside the
  dialog

#### Scenario: Focus restore on close

- **WHEN** a `Dialog` transitions from `open={true}` to `open={false}`
- **THEN** focus SHALL be restored to the element that was focused
  immediately before the dialog opened, if that element is still in the
  document
