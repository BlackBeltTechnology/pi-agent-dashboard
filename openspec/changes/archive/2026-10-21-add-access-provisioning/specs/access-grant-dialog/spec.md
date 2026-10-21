## REMOVED Requirements

### Requirement: Prompting is opt-in and can be disabled outright

**Reason**: The operator decided prompting defaults to on, so access provisioning works on default installs; the default-never-prompts rule no longer holds.

**Migration**: Replaced by "Prompting is on by default and can be disabled outright". Explicit `accessGrants.promptEnabled` values are kept; only an absent setting changes meaning (off → on). Set it to `false` explicitly to keep the old behaviour.

## ADDED Requirements

### Requirement: Prompting is on by default and can be disabled outright

Prompting SHALL be enabled by default: an absent setting enables it, and only an
explicit operator configuration of `false` disables it. An existing explicit
setting SHALL be kept as it is. An environment variable SHALL disable prompting
regardless of configuration, for automated environments where a browser is
connected but no human is present.

Disabling prompting SHALL suppress only the prompt: existing grants SHALL remain
in force, and denials SHALL still be recorded for review.

#### Scenario: Default deployment prompts

- **GIVEN** a configuration with no prompting setting, Host admission enforced and an operator browser connected
- **WHEN** a prompt-eligible denial occurs
- **THEN** a dialog SHALL be raised

#### Scenario: Explicitly disabled deployment never prompts

- **GIVEN** prompting is set to `false` in configuration
- **WHEN** a prompt-eligible denial occurs
- **THEN** no dialog SHALL be raised
- **AND** every guard SHALL behave exactly as it does with prompting absent from the product

#### Scenario: An explicit setting survives the default change

- **GIVEN** a configuration written before this change with prompting set to `false`
- **WHEN** the dashboard starts
- **THEN** prompting SHALL stay disabled

#### Scenario: Automated environments suppress prompts despite a connected browser

- **GIVEN** the disabling environment variable is set and a browser is connected
- **WHEN** a prompt-eligible denial occurs
- **THEN** no dialog SHALL be raised
- **AND** the denial SHALL still be recorded

#### Scenario: Disabling does not revoke

- **WHEN** prompting is disabled after grants were created
- **THEN** those grants SHALL continue to apply
