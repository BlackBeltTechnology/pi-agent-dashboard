## ADDED Requirements

### Requirement: Confirm preset built on Dialog

The `Confirm` component SHALL be implemented as a thin preset on top of
the `Dialog` primitive, delegating all chrome (portal, overlay, focus
management, ARIA, dismissal sources) to `Dialog`. `Confirm` SHALL NOT
implement its own portal, overlay, or focus management.

#### Scenario: Confirm renders a Dialog

- **WHEN** a `Confirm` with `open={true}` is rendered
- **THEN** the rendered tree SHALL contain a `Dialog` root with
  `role="dialog"` and `aria-modal="true"`

#### Scenario: Confirm omits Dialog when closed

- **WHEN** a `Confirm` is rendered with `open={false}`
- **THEN** no portal SHALL be mounted

### Requirement: Confirm dialog content shape

The `Confirm` SHALL accept `title` (string), `message` (string),
optional `body` (ReactNode rendered between message and footer), and
SHALL render exactly one cancel button and one action button in the
footer.

#### Scenario: Title is the dialog title

- **WHEN** a `Confirm` is rendered with `title="Forget workspace?"`
- **THEN** the rendered dialog SHALL display "Forget workspace?" as its
  title and SHALL set `aria-labelledby` on the dialog container

#### Scenario: Message renders as body text

- **WHEN** a `Confirm` is rendered with `message="This cannot be
  undone."`
- **THEN** the message SHALL render as a paragraph in the dialog body

#### Scenario: Optional body content

- **WHEN** a `Confirm` is rendered with a `body` ReactNode (e.g. a list
  of files)
- **THEN** that node SHALL render after the message and before the
  footer

#### Scenario: Two-button footer

- **WHEN** a `Confirm` is rendered
- **THEN** the footer SHALL contain exactly two buttons: a cancel button
  and an action button, in that order

### Requirement: Confirm intent drives action button style

The `Confirm` SHALL accept `intent="primary" | "danger" | "neutral"`
(default `primary`) and apply it to the action button via
`Dialog.Action`'s `intent` prop. The cancel button's appearance is
intent-independent.

#### Scenario: Primary intent

- **WHEN** a `Confirm` is rendered with `intent="primary"` (or omitted)
- **THEN** the action button SHALL render with the accent-primary
  background

#### Scenario: Danger intent

- **WHEN** a `Confirm` is rendered with `intent="danger"`
- **THEN** the action button SHALL render with a red background
  (`bg-red-600`)

#### Scenario: Cancel button is unaffected by intent

- **WHEN** a `Confirm` is rendered with any intent
- **THEN** the cancel button SHALL render with the neutral
  bordered-transparent style

### Requirement: Confirm action wiring

The `Confirm` SHALL invoke `onConfirm` when the action button is
clicked, and `onClose` when the cancel button is clicked, the overlay
is clicked, or `Esc` is pressed. `onConfirm` SHALL NOT also invoke
`onClose` automatically; consumers control whether the dialog stays
open after confirm (e.g. for a loading state).

#### Scenario: Action button calls onConfirm

- **WHEN** the user clicks the `Confirm` action button
- **THEN** `onConfirm` SHALL be called exactly once and `onClose` SHALL
  NOT be called by the `Confirm` component

#### Scenario: Cancel button calls onClose

- **WHEN** the user clicks the `Confirm` cancel button
- **THEN** `onClose` SHALL be called exactly once and `onConfirm` SHALL
  NOT be called

#### Scenario: Esc calls onClose

- **WHEN** the user presses `Esc` while the `Confirm` is open
- **THEN** `onClose` SHALL be called and `onConfirm` SHALL NOT be called

### Requirement: Confirm default labels

The `Confirm` SHALL accept optional `confirmLabel` and `cancelLabel`
strings, defaulting to "Confirm" and "Cancel" respectively.

#### Scenario: Default labels

- **WHEN** a `Confirm` is rendered without `confirmLabel` or
  `cancelLabel`
- **THEN** the action button SHALL display "Confirm" and the cancel
  button SHALL display "Cancel"

#### Scenario: Custom labels

- **WHEN** a `Confirm` is rendered with `confirmLabel="Forget"` and
  `cancelLabel="Keep"`
- **THEN** the action button SHALL display "Forget" and the cancel
  button SHALL display "Keep"

### Requirement: Confirm replaces legacy ConfirmDialog

The change SHALL fold the legacy `ConfirmDialog` component into `Confirm`,
remove the `packages/client/src/components/ConfirmDialog.tsx` re-export shim
and the legacy plugin clones `JjForgetConfirmDialog` and `JjFoldBackDialog`,
and SHALL migrate all host call sites to the new `Confirm` component. The
registered `ui:confirm-dialog` primitive SHALL be preserved with its existing
contract (`{ message, confirmLabel?, onConfirm, onCancel }`), re-skinned via an
adapter that renders `Confirm`/`Dialog`, so plugins consuming it through
`useUiPrimitive` require no source edits.

#### Scenario: Shim file removed

- **WHEN** the change is complete
- **THEN** `packages/client/src/components/ConfirmDialog.tsx` SHALL NOT
  exist

#### Scenario: Plugin clones removed

- **WHEN** the change is complete
- **THEN** `packages/jj-plugin/src/client/JjForgetConfirmDialog.tsx` and
  `packages/jj-plugin/src/client/JjFoldBackDialog.tsx` SHALL NOT exist

#### Scenario: No legacy relative imports remain

- **WHEN** the change is complete
- **THEN** no source file under `packages/` SHALL import from
  `./ConfirmDialog`, `../ConfirmDialog`, `JjForgetConfirmDialog`, or
  `JjFoldBackDialog`

#### Scenario: Registry contract preserved

- **WHEN** the change is complete
- **THEN** `UI_PRIMITIVE_KEYS.confirmDialog` SHALL remain registered and its
  contract `UiConfirmDialogProps` SHALL keep `onCancel` and a non-required
  `title`, and plugin call sites resolving it via `useUiPrimitive` SHALL
  remain unchanged

### Requirement: Confirm testId hooks

The `Confirm` SHALL accept a `testId` prop and apply it through to
the underlying `Dialog`, exposing the same derived ids
(`-overlay`, `-cancel`, `-action`).

#### Scenario: testId on Confirm

- **WHEN** a `Confirm` is rendered with `testId="archive-change"`
- **THEN** the dialog container SHALL have
  `data-testid="archive-change"`, the cancel button SHALL have
  `data-testid="archive-change-cancel"`, and the action button SHALL
  have `data-testid="archive-change-action"`
