## ADDED Requirements

### Requirement: A refresh that partially fails is reported, not discarded

When the bridge refreshes its `ModelRegistry` in response to `request_models`, it SHALL inspect the refresh outcome rather than discard it. A refresh may report that it was aborted, and may report a per-provider error for any provider it failed to refresh.

A failed refresh SHALL be treated as degraded, not fatal: the bridge SHALL still return the registry's last-known catalogue so the user keeps a usable model list.

For every provider reported as failing, the bridge SHALL log a warning that names that provider and includes the failure text. A bare "refresh failed" without a provider name SHALL NOT satisfy this requirement. An aborted refresh SHALL be logged distinctly from a provider failure.

A refresh that reports neither an abort nor any provider error SHALL produce no warning.

#### Scenario: One provider fails during a requested refresh

- **WHEN** the bridge handles `request_models` and the refresh reports an error for one provider
- **THEN** the bridge SHALL still return a `models_list` containing the last-known catalogue
- **AND** the bridge SHALL log a warning naming that provider and its failure text

#### Scenario: Several providers fail

- **WHEN** the refresh reports errors for more than one provider
- **THEN** the bridge SHALL log a warning for every failing provider, not only the first

#### Scenario: Refresh is aborted

- **WHEN** the refresh reports that it was aborted
- **THEN** the bridge SHALL log that the refresh was aborted
- **AND** the bridge SHALL still return a `models_list`

#### Scenario: Clean refresh logs nothing

- **WHEN** the refresh reports no abort and no provider error
- **THEN** the bridge SHALL emit no refresh warning

#### Scenario: Refresh outcome is unavailable

- **WHEN** the registry's refresh yields no outcome to inspect
- **THEN** the bridge SHALL return a `models_list` as before
- **AND** the bridge SHALL emit no refresh warning

### Requirement: models_list carries provider refresh failures to the browser

The `models_list` message SHALL carry an optional list of provider refresh failures, each identifying the provider and a human-readable failure message. The field SHALL be present only when at least one provider failed to refresh; a clean refresh SHALL omit it entirely so the message is byte-identical to today's on the success path.

An aborted refresh SHALL NOT populate this field: an abort names no failing provider and is a log-level concern only.

The server SHALL forward the field verbatim to every connected browser along with the rest of the message.

#### Scenario: Failures reach the browser

- **WHEN** a bridge pushes a `models_list` after a refresh in which a provider failed
- **THEN** the message SHALL carry that provider and its failure message
- **AND** the browser SHALL receive them unaltered

#### Scenario: Clean refresh omits the field

- **WHEN** a bridge pushes a `models_list` after a refresh with no provider failure
- **THEN** the message SHALL NOT include the refresh-failure field

#### Scenario: Abort does not populate the field

- **WHEN** a bridge pushes a `models_list` after a refresh that was aborted with no provider error
- **THEN** the message SHALL NOT include the refresh-failure field

#### Scenario: Older bridges remain compatible

- **WHEN** the browser receives a `models_list` from a bridge that never sets the refresh-failure field
- **THEN** the browser SHALL process the message without error
- **AND** SHALL render no refresh notice
