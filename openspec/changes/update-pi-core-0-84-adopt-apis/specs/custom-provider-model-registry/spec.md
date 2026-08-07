## ADDED Requirements

### Requirement: Model-registry refresh SHALL honor cancellation and surface provider errors

pi 0.84.0 changed `ModelRegistry.refresh()` to accept `ModelsRefreshOptions` and return a `ModelsRefreshResult` instead of discarding cancellation and provider errors. Every dashboard call site SHALL pass the options it needs and SHALL inspect the result rather than fire-and-forget. A refresh that fails for one provider SHALL NOT be reported as a successful refresh.

#### Scenario: Refresh result is inspected

- **WHEN** the dashboard triggers a model-registry refresh
- **THEN** it SHALL read the returned `ModelsRefreshResult`
- **AND** it SHALL NOT discard the return value

#### Scenario: Provider error is surfaced, not swallowed

- **WHEN** a refresh completes with a per-provider error in its result
- **THEN** that error SHALL be logged with the provider identity
- **AND** the refresh SHALL NOT be reported to the caller as fully successful

#### Scenario: Refresh is not wrapped in a bare catch

- **WHEN** a refresh call site is invoked
- **THEN** it SHALL NOT discard the outcome inside an empty `catch {}` block

#### Scenario: Cancellation is propagated

- **WHEN** a caller supplies an abort signal in `ModelsRefreshOptions`
- **AND** that signal aborts before the refresh completes
- **THEN** the refresh SHALL stop and the aborted outcome SHALL be distinguishable from a successful refresh

#### Scenario: Scoped provider refresh

- **WHEN** only one provider's catalog needs re-fetching
- **THEN** the call site SHALL pass that provider in `ModelsRefreshOptions` rather than refreshing every provider
