## MODIFIED Requirements

### Requirement: Initialize button gated on worktree-init status

For a row whose repo declares a worktree-init hook (`hasHook: true`), the row SHALL display the init control when the cached worktree-init status reports `needsInit: true` OR the hook is not trusted (`trusted: false`). When `hasHook` is true, `needsInit` is false, and the hook is trusted, the control SHALL NOT be shown. The control SHALL label itself by reason: "Initialize" when `needsInit: true`; "Review & trust changes" when `needsInit: false` and `trusted: false` (the hook was edited after it was last trusted, invalidating its `repoRoot + sha256(canonical(worktreeInit))` trust key). Behavior for rows with no declared hook (`hasHook: false`) is governed by a separate capability and is out of scope here. Init-status SHALL be probed lazily per row and fail-open (on probe error the button is hidden).

Clicking Initialize SHALL run the hook via `POST /api/git/worktree/init`. When the hook is untrusted, the client SHALL first show a trust-confirm dialog naming the gate and the run command (or agent prompt + model); on confirm it SHALL re-issue the run with `confirmHash`. While the hook runs, the row SHALL show a status chip (label + elapsed time) with the last log line as a muted preview; the full log SHALL be opt-in behind a collapsed disclosure, NOT rendered inline as a raw output block. A hook failure SHALL render as a compact chip with a plain-language summary (exit code + short command) and a Retry action, with the stderr / log tail available behind the same opt-in disclosure; the failure chip SHALL NOT auto-dismiss on a timer. On success the client SHALL briefly show a success confirmation, then re-fetch init-status, after which the gate flips and the Initialize button disappears.

#### Scenario: Button shown when init needed

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: true }`
- **THEN** the row SHALL show the control labeled "Initialize"

#### Scenario: Button labeled for re-trust when hook edited

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false, trusted: false }` (the hook was edited after last trust, invalidating its trust key)
- **THEN** the row SHALL show the control labeled "Review & trust changes" (not "Initialize")
- **AND** clicking it SHALL open the trust-confirm dialog; granting trust SHALL clear the control without running an init when the gate reports `needsInit: false`

#### Scenario: Button hidden when initialized and trusted

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false, trusted: true }`
- **THEN** the row SHALL NOT show the init control

#### Scenario: Untrusted hook prompts before running

- **WHEN** the user clicks Initialize for an untrusted hook
- **THEN** the client SHALL show a trust-confirm dialog naming the gate and run command/prompt
- **AND** SHALL only run the hook (with `confirmHash`) after the user confirms

#### Scenario: Running shows a status chip with opt-in log

- **WHEN** a hook run is in flight
- **THEN** the row SHALL show a status chip with elapsed time and the last log line as a muted preview
- **AND** the full log SHALL be hidden until the user opens the disclosure (no inline raw output block)

#### Scenario: Failure renders a compact, retryable chip

- **WHEN** a hook run fails
- **THEN** the client SHALL render a compact failure chip with a plain-language summary and a Retry action
- **AND** the stderr / log tail SHALL be available behind an opt-in disclosure
- **AND** the failure chip SHALL NOT auto-dismiss on a timer

#### Scenario: Success removes the button

- **WHEN** a hook run succeeds
- **THEN** the client SHALL briefly show a success confirmation, then re-fetch init-status
- **AND** the Initialize button SHALL disappear once the gate reports `needsInit: false`
