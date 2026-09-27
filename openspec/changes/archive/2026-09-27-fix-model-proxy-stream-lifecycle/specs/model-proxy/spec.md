## MODIFIED Requirements

### Requirement: Streaming abort propagates upstream

When a client closes the connection during a streaming response, the proxy SHALL cancel the upstream provider call within a bounded time and stop charging for further tokens. This SHALL hold for both `/v1/chat/completions` and `/v1/messages`. Disconnect SHALL be detected from the response side, because the request-side "close" event can fire as soon as the request body is consumed. Cancelling one conversation SHALL NOT affect any other in-flight conversation.

#### Scenario: Client disconnect during stream

- **GIVEN** an active `/v1/chat/completions` or `/v1/messages` stream
- **WHEN** the client closes the TCP connection
- **THEN** within 200ms the upstream provider call's `AbortSignal` is fired
- **AND** the upstream HTTP request to the provider is closed

#### Scenario: Disconnect of one client leaves concurrent streams untouched

- **GIVEN** several concurrent streams on the same API key
- **WHEN** one client disconnects mid-stream
- **THEN** only that stream's upstream `AbortSignal` is fired
- **AND** every other stream completes with its full content and an un-aborted signal

#### Scenario: Client closes after final chunk

- **WHEN** the client closes the connection AFTER the proxy has written `[DONE]`
- **THEN** no abort is needed
- **AND** no error is logged

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

- **WHEN** a client sends a system prompt (an OpenAI `system` message or the Anthropic `system` field)
- **THEN** the proxy SHALL hand it to pi-ai as `Context.systemPrompt` under either runtime generation, so it reaches the provider
- **AND** SHALL NOT pass it under any other key (the former `system` key was silently dropped by pi-ai; that mismatch is now repaired, not preserved)

#### Scenario: Abort still propagates

- **WHEN** a client aborts an in-flight completion
- **THEN** the abort SHALL propagate to the upstream request under either supported runtime generation

## ADDED Requirements

### Requirement: Mid-stream upstream failure terminates the stream

When the upstream call throws after the proxy has started a streaming response (headers already sent), the proxy SHALL end that SSE stream in the same shape as an upstream `error` event. It SHALL NOT attempt to send an HTTP error status. The failure SHALL NOT affect other in-flight conversations.

#### Scenario: OpenAI stream fails after the first delta

- **GIVEN** an active `/v1/chat/completions` stream that has delivered at least one chunk
- **WHEN** the upstream call throws
- **THEN** the proxy writes a final chunk and `data: [DONE]` and ends the response
- **AND** the client does not hang waiting for more data

#### Scenario: Anthropic stream fails after the first delta

- **GIVEN** an active `/v1/messages` stream that has delivered at least one frame
- **WHEN** the upstream call throws
- **THEN** the proxy writes an `event: error` frame carrying the error message and ends the response

#### Scenario: Failure does not reach concurrent conversations

- **GIVEN** several concurrent streams, one of which fails mid-stream
- **THEN** every other stream completes with its full content

### Requirement: Concurrent conversations are isolated

The proxy SHALL keep no conversation state between requests. Each request SHALL reach the upstream provider with only its own system prompt, message history, and tools, and SHALL receive only its own output, including while many streams overlap in time.

#### Scenario: Overlapping conversations see only their own context

- **GIVEN** N conversations with distinct system prompts and histories, streaming concurrently
- **WHEN** they are served at the same time
- **THEN** each upstream call carries exactly one conversation's context
- **AND** each response contains only its own conversation's output

#### Scenario: Each streamed response has its own message id

- **WHEN** concurrent streaming responses are produced (OpenAI or Anthropic format)
- **THEN** every frame of one response carries the same message id
- **AND** no two responses share a message id

#### Scenario: Multi-turn histories evolve independently

- **GIVEN** concurrent conversations that each append the assistant reply to their own history across several turns
- **THEN** every upstream call carries only its own conversation's turns, with one fewer assistant turn than user turns
