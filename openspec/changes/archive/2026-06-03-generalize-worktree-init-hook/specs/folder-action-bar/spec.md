## ADDED Requirements

### Requirement: Initialize button gated on worktree-init status

For a row whose repo declares a worktree-init hook (`hasHook: true`), the row SHALL display an "Initialize" button when, and only when, the cached worktree-init status reports `needsInit: true`. When `hasHook` is true and `needsInit` is false, the Initialize button SHALL NOT be shown. Behavior for rows with no declared hook (`hasHook: false`) is governed by a separate capability and is out of scope here. Init-status SHALL be probed lazily per row and fail-open (on probe error the button is hidden).

Clicking Initialize SHALL run the hook via `POST /api/git/worktree/init`. When the hook is untrusted, the client SHALL first show a trust-confirm dialog naming the gate and the run command (or agent prompt + model); on confirm it SHALL re-issue the run with `confirmHash`. Hook progress SHALL stream to a live tail. A hook failure SHALL render in a card reusing the spawn-error card surface (stderr / log tail). On success the client SHALL re-fetch init-status, after which the gate flips and the Initialize button disappears.

#### Scenario: Button shown when init needed

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: true }`
- **THEN** the row SHALL show an "Initialize" button

#### Scenario: Button hidden when already initialized

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false }`
- **THEN** the row SHALL NOT show an "Initialize" button

#### Scenario: Untrusted hook prompts before running

- **WHEN** the user clicks Initialize for an untrusted hook
- **THEN** the client SHALL show a trust-confirm dialog naming the gate and run command/prompt
- **AND** SHALL only run the hook (with `confirmHash`) after the user confirms

#### Scenario: Failure renders a card

- **WHEN** a hook run fails
- **THEN** the client SHALL render the failure in a card with the stderr / log tail

#### Scenario: Success removes the button

- **WHEN** a hook run succeeds
- **THEN** the client SHALL re-fetch init-status
- **AND** the Initialize button SHALL disappear once the gate reports `needsInit: false`
