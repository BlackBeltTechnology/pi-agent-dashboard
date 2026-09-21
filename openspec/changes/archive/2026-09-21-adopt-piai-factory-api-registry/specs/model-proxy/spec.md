## ADDED Requirements

### Requirement: Proxy completions SHALL behave identically across runtime generations

A completion served by the proxy SHALL produce the same upstream request regardless of which supported pi-ai generation is resolved. Changing the resolved runtime SHALL NOT alter which request fields reach the provider.

#### Scenario: Built-in model completion is unchanged end to end

- **WHEN** a client streams a chat completion for a built-in model through `/v1/chat/completions`
- **THEN** the response SHALL stream upstream events as before this change
- **AND** the upstream request SHALL carry the dashboard-resolved credential for that model's provider

#### Scenario: Custom-provider model completion is unchanged end to end

- **WHEN** a client streams a chat completion for a custom-provider model
- **THEN** the request SHALL be dispatched using the model's declared `api` and effective base URL
- **AND** the upstream request SHALL carry the dashboard-resolved credential for that provider

#### Scenario: Tool definitions survive the runtime change

- **WHEN** a client sends a completion request carrying tool definitions
- **THEN** those tools SHALL be present in the upstream request under either runtime generation

#### Scenario: Existing system-prompt handling is not altered

- **WHEN** a proxy route supplies the request's system prompt under the key it uses today
- **THEN** whether that prompt reaches the provider SHALL be unchanged by this change
- **AND** any pre-existing mismatch SHALL be preserved rather than silently repaired

#### Scenario: Abort still propagates

- **WHEN** a client aborts an in-flight completion
- **THEN** the abort SHALL propagate to the upstream request under either supported runtime generation
