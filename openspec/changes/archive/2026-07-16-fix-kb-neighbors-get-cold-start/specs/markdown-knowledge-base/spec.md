# markdown-knowledge-base — delta

## MODIFIED Requirements

### Requirement: LLM-facing pull retrieval, not push injection

The knowledge base SHALL be exposed to LLM agents as a pull interface the agent
explicitly invokes (a SKILL-driven CLI in Phase 1, a registered native tool in
Phase 2). The system SHALL NOT auto-inject search results into the model context
via input or pre-tool hooks.

When the KB tools are registered for a cwd whose index has never been built,
each pull tool (`kb_search`, `kb_neighbors`, `kb_get`) SHALL self-populate the
index on first invocation before serving results, so an active-but-uninitialized
KB never returns a false-empty result. Self-population SHALL run only when the
index is empty (a warm index is not re-walked on the neighbors/get path), and a
failed population SHALL degrade to the existing store rather than error.

#### Scenario: Agent retrieves on demand via SKILL

- **WHEN** the `kb-search` SKILL is active and the agent encounters an unknown
  term or decision
- **THEN** the agent SHALL invoke the `kb` search interface to retrieve ranked
  sections before answering from memory or asking the user

#### Scenario: No push auto-injection

- **WHEN** a user message or tool call occurs
- **THEN** the system SHALL NOT automatically run a search and inject its results
  into the model context

#### Scenario: Cold KB self-populates on first neighbors/get

- **WHEN** the KB tools are active for a cwd whose index has never been built
  (`store.counts().chunks === 0`) and the agent invokes `kb_neighbors` or
  `kb_get`
- **THEN** the tool SHALL build the index once before serving results
- **AND** the invocation SHALL return the populated graph node / section rather
  than an empty result or "(not found)"

#### Scenario: Warm index is not re-walked on neighbors/get

- **WHEN** the index for a cwd is already populated and the agent invokes
  `kb_neighbors` or `kb_get`
- **THEN** the tool SHALL serve results without running a reindex walk
  (an empty-check `COUNT` only)

#### Scenario: Failed cold-start population degrades, not errors

- **WHEN** the first `kb_neighbors` / `kb_get` on an empty index triggers a build
  that throws
- **THEN** the tool SHALL fall back to the existing (empty) store and still
  return a well-formed result rather than propagating the error
