## ADDED Requirements

### Requirement: Slash-command dropdown selection survives parent rerenders and session switches
Selecting a `/` slash-command entry from the `CommandInput` dropdown — by mouse click, by `Tab`, or by `Enter` while the dropdown is open — SHALL insert the chosen value into the textarea and into the parent-controlled draft (when `draft` / `onDraftChange` are provided), regardless of how many times the parent has rerendered the component or whether the active `sessionId` changed since mount. The handler MUST observe the latest `onDraftChange` identity at the time of the click / keystroke, not the identity captured at first render.

This requirement is scoped to the `/` slash-command path because that is what users observably break on session switch. The `@`-file path is not part of this requirement; its current behaviour (selection works) is expected to continue but is governed by the existing autocomplete spec, not by this addition.

#### Scenario: Tab selects a slash-command after a session switch
- **WHEN** the user mounts `CommandInput` with `sessionId="A"`, types `/dep`, switches to `sessionId="B"`, retypes `/dep`, and presses `Tab`
- **THEN** the textarea SHALL update to `/deploy ` and the parent's `onDraftChange` SHALL receive `/deploy ` for session "B"

#### Scenario: Click selects a slash-command after a session switch
- **WHEN** the user mounts `CommandInput` with `sessionId="A"`, types `/dep`, switches to `sessionId="B"`, retypes `/dep`, and clicks the `/deploy` dropdown entry
- **THEN** the textarea SHALL update to `/deploy ` and the parent's `onDraftChange` SHALL receive `/deploy ` for session "B"

#### Scenario: Repeated parent rerenders do not break slash-command selection
- **WHEN** the parent rerenders the component multiple times with new `onDraftChange` identities while the `/` dropdown is open
- **THEN** subsequent `Tab` / click selections SHALL still update the textarea and the parent draft using the most recent `onDraftChange`

#### Scenario: `@`-file selection continues to work as today
- **WHEN** the user mounts `CommandInput`, types `@foo`, and clicks a file entry in the dropdown (with or without a prior session switch)
- **THEN** the textarea SHALL update to include the chosen `@<path>` token (this scenario documents that the `@`-path behaviour does not regress as a side effect of the `/`-path fix)
