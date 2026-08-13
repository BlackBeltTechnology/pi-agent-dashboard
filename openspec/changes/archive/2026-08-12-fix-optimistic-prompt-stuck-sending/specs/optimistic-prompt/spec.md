# optimistic-prompt

## ADDED Requirements

### Requirement: An optimistic prompt SHALL always settle

A prompt sent from the browser composer SHALL leave the `sending` state on
EVERY terminal outcome — acknowledgement, send failure, or timeout. It MUST NOT
remain `sending` indefinitely, and the composer MUST NOT stay disabled.

Acknowledgement and response rendering are DISTINCT settlement points.
`prompt_received{fresh:true}` promotes the pending prompt to `sent`; the
assistant response renders later. Settlement of the optimistic card SHALL be
governed by the acknowledgement, not by the arrival of the response.

#### Scenario: Acknowledgement settles the optimistic card

- **WHEN** the user sends a prompt through the composer
- **AND** the server emits `prompt_received{fresh:true}`
- **THEN** the optimistic prompt leaves `sending` and is marked `sent`
- **AND** the composer is re-enabled, without waiting for the response

#### Scenario: Send failure settles the optimistic card

- **WHEN** a sent prompt is never acknowledged (transport failure or timeout)
- **THEN** the optimistic prompt leaves `sending` into a visible failed state
- **AND** the composer is re-enabled so the user can retry

#### Scenario: Reset or replay does not resurrect `sending`

- **GIVEN** a prompt that already settled
- **WHEN** the session state is reset or replayed from cache
- **THEN** no pending prompt is restored to `sending`

#### Scenario: Faux E2E round-trips go green

- **WHEN** `tests/e2e/faux-text.spec.ts` and `tests/e2e/faux-ask.spec.ts` run
  against the docker harness
- **THEN** both pass — the scripted answer renders for `plain-text` and the
  interactive option button renders for `ask-select`
- **AND** no pending prompt card remains in `sending`
- **AND** the composer is enabled at the end of the round-trip
