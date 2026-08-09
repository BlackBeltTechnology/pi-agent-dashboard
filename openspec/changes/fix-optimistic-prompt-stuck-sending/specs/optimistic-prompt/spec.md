# optimistic-prompt

## ADDED Requirements

### Requirement: An optimistic prompt SHALL always settle

A prompt sent from the browser composer SHALL leave the `sending` state once
the server acknowledges it, and the composer SHALL re-enable. An acknowledged
prompt MUST NOT remain optimistic indefinitely.

#### Scenario: Acknowledged prompt settles and re-enables the composer

- **WHEN** the user sends a prompt through the composer and the server
  acknowledges it
- **THEN** the optimistic message leaves `sending`, the scripted answer renders
  in the message DOM, and the composer is re-enabled

#### Scenario: Faux E2E round-trips go green

- **WHEN** `tests/e2e/faux-text.spec.ts` and `tests/e2e/faux-ask.spec.ts` run
  against the docker harness
- **THEN** both pass — the scripted answer renders for `plain-text` and the
  interactive option button renders for `ask-select`
