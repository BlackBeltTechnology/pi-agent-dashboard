## MODIFIED Requirements

### Requirement: Proxy completions SHALL behave identically across runtime generations

A completion served by the proxy SHALL produce the same upstream request after the server moves onto the single pi model runtime as it did before. Replacing the dashboard's own registry and dispatch with the runtime SHALL NOT alter which request fields reach the provider.

#### Scenario: Built-in model completion is unchanged end to end

- **WHEN** a client streams a chat completion for a built-in model through `/v1/chat/completions`
- **THEN** the response SHALL stream upstream events as before this change
- **AND** the upstream request SHALL carry the dashboard-resolved credential for that model's provider

#### Scenario: Custom-provider model completion is unchanged end to end

- **WHEN** a client streams a chat completion for a custom-provider model
- **THEN** the request SHALL be dispatched using the model's declared `api` and effective base URL
- **AND** the upstream request SHALL carry the credential configured for that provider

#### Scenario: Tool definitions survive the runtime change

- **WHEN** a client sends a completion request carrying tool definitions
- **THEN** those tools SHALL be present in the upstream request

#### Scenario: Existing system-prompt handling is not altered

- **WHEN** a client sends a system prompt (an OpenAI `system` message or the Anthropic `system` field)
- **THEN** the proxy SHALL hand it to the runtime as the context's system prompt, so it reaches the provider
- **AND** SHALL NOT pass it under any other key

#### Scenario: Abort still propagates

- **WHEN** a client aborts an in-flight completion
- **THEN** the abort SHALL propagate to the upstream request
