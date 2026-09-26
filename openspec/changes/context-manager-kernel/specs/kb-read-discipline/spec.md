## MODIFIED Requirements

### Requirement: Only knowledge access resets the chain
The chain SHALL reset when the agent consults knowledge: a kb retrieval tool call (`kb_search`, `kb_neighbors`, `kb_get`), a context-manager retrieval tool call (`context_search`, `context_get`) while the context manager is active for the session, or a bash command invoking the kb CLI — the discipline's own recommended path must reset, or compliant agents receive false nudges. Edits, writes, and other non-retrieval actions SHALL NOT reset it. A reset SHALL be clean-slate, clearing both the chain counter and the accumulated firing count, and SHALL be processed before the action itself is counted.

#### Scenario: A kb call clears the chain
- **WHEN** the agent calls a kb retrieval tool or invokes the kb CLI via bash
- **THEN** the chain counter and the firing count SHALL both return to zero

#### Scenario: A context-manager retrieval call clears the chain
- **WHEN** the context manager is active and the agent calls `context_search` or `context_get`
- **THEN** the chain counter and the firing count SHALL both return to zero

#### Scenario: A same-named tool from elsewhere does not reset
- **WHEN** the context manager is not active and another package's tool named `context_search` is called
- **THEN** the chain SHALL NOT reset

#### Scenario: An empty-query kb call still resets
- **WHEN** the agent calls `kb_search` or `context_search` with an empty query
- **THEN** the chain SHALL reset — an attempt to consult is a consult

#### Scenario: An interleaved edit does not clear the chain
- **WHEN** the agent edits a file between two search actions
- **THEN** the chain counter SHALL continue accumulating
