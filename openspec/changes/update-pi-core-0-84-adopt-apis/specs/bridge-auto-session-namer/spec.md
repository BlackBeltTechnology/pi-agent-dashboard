## MODIFIED Requirements

### Requirement: In-process `@fast` title generation

The bridge SHALL generate the title by calling the `@fast` model in-process using pi-ai's `streamSimple` and the model registry's credential resolution, with a bounded transcript window and a short output cap. Credential resolution SHALL treat `ModelRegistry.getApiKeyAndHeaders()` as returning `ProviderHeaders` whose values are `string | null`, where a `null` value is a header-DELETION marker rather than an absent header. The bridge SHALL forward those markers to pi-ai unchanged and SHALL NOT coerce them to strings, drop them, or stringify them as `"null"`.

#### Scenario: Resolve the fast model role

- **WHEN** a naming attempt proceeds past the pre-filter
- **THEN** the bridge resolves the model reference via `lookupRole("@fast")`

#### Scenario: Bounded transcript window

- **WHEN** the bridge builds the model input
- **THEN** it sends only the first substantive user message plus the first assistant reply, each truncated to 2000 characters, never the full history

#### Scenario: Model invocation

- **WHEN** credentials resolve for the `@fast` model reference
- **THEN** the bridge calls `streamSimple` with the summarizer system prompt, the transcript as a single user message, and a max output of 16 tokens
- **AND** it accumulates the raw title from streamed `text_delta` events

#### Scenario: Null header markers are forwarded unchanged

- **WHEN** `getApiKeyAndHeaders()` returns a headers map containing an entry whose value is `null`
- **THEN** the bridge SHALL pass that entry through to the pi-ai request unchanged
- **AND** it SHALL NOT emit the literal string `"null"` as a header value

#### Scenario: A null-only header map counts as empty

- **WHEN** `getApiKeyAndHeaders()` returns a headers map whose every value is `null`
- **THEN** the bridge's non-empty-headers check SHALL treat that map as carrying no usable headers
- **AND** it SHALL NOT be satisfied merely because the map has a non-zero key count

#### Scenario: Done-event text fallback

- **WHEN** the stream reaches the `done` event and no `text_delta` text has accumulated
- **THEN** the bridge collects the title from the final message's text content parts (`collectText(ev.message)`)
