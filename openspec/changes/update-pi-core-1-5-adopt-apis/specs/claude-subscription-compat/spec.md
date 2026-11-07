## MODIFIED Requirements

### Requirement: Docs-section rewrite on Anthropic sessions
While the switch is on, a run's model provider is `anthropic`, and the run uses pi's default prompt, its docs section SHALL read `the cli itself` and `cli packages` instead of `pi itself` and `pi packages` wherever those phrases occur. Every other part of the docs section SHALL stay unchanged. A run with no model, a custom `SYSTEM.md` prompt, or a forced whole prompt SHALL NOT be rewritten. Since pi 1.5.0 ("Tightened system prompt") the default docs section reads "…about the harness itself, its SDK, …" and carries neither phrase, so on the 1.5.0 floor the rewrite finds nothing to change and the docs section is sent unmodified; the rewrite stays in place for a pi that renders a flagged phrase again, and a canary test against the installed pi pins the wording.

#### Scenario: Anthropic run with switch on
- **WHEN** the switch is on and an agent run starts on an `anthropic` model
- **THEN** the outbound system prompt SHALL NOT contain `pi itself` or `pi packages`
- **AND** wherever pi's docs section contained one of those phrases, the outbound prompt SHALL contain `the cli itself` or `cli packages` in its place

#### Scenario: pi 1.5 default prompt carries no flagged phrase
- **GIVEN** the installed pi is 1.5.0 and renders its default docs section
- **WHEN** the switch is on and an agent run starts on an `anthropic` model
- **THEN** the docs block SHALL appear exactly once and contain neither `pi itself` nor `pi packages`
- **AND** the dashboard SHALL send the docs section unmodified (the rewrite is a no-op)

#### Scenario: Other provider
- **WHEN** the switch is on and an agent run starts on a non-`anthropic` provider
- **THEN** the docs section SHALL be sent unmodified

#### Scenario: Switch off
- **WHEN** the switch is off and an agent run starts on an `anthropic` model
- **THEN** the dashboard SHALL send the docs section unmodified

#### Scenario: Custom system prompt
- **WHEN** the switch is on and the session uses a `SYSTEM.md` custom prompt
- **THEN** the dashboard SHALL NOT add or change any docs section, even if the custom prompt or a context file contains a `<docs>` tag
