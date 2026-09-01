## ADDED Requirements

### Requirement: Single KnowledgeBackend seam over two implementations
The system SHALL expose one internal `KnowledgeBackend` interface implemented twice — a kb-backed implementation over `@blackbelt-technology/pi-dashboard-kb` and a fallback implementation over the vendored `set-copilot` `knowledge/sources.ts` + `knowledge/markdown-adapter.ts` — so that meeting-copilot and the knowledge view are backend-agnostic.

#### Scenario: Copilot flow does not branch on backend
- **WHEN** meeting-copilot resolves knowledge for a project
- **THEN** it calls the `KnowledgeBackend` interface only, with no backend-specific branching in the copilot control flow

#### Scenario: Both implementations satisfy one contract suite
- **WHEN** the shared knowledge-backend contract tests run
- **THEN** they execute against BOTH the kb-backed and the fallback implementation, and both pass

### Requirement: kb-first backend selection with explicit fallback
The system SHALL select the kb backend when the folder has an indexed, admissible kb, and SHALL otherwise select the vendored fallback backend. Selection SHALL be a distinct, observable outcome — never silently conflated with "the knowledge base returned no results".

#### Scenario: Folder has an indexed kb
- **WHEN** a project folder is admissible to kb and its kb index is populated
- **THEN** the kb backend is selected for that folder

#### Scenario: Folder has no kb index
- **WHEN** a project folder has no kb configuration or an empty kb index
- **THEN** the vendored fallback backend is selected, using the project's `knowledge.sources` globs, and no kb setup is required for the plugin to work

#### Scenario: kb rejects the folder by admission guard
- **WHEN** kb's cwd admission guard rejects the folder
- **THEN** the system records an explicit "kb unavailable for this folder" selection outcome and uses the fallback, rather than reporting an empty knowledge result

#### Scenario: Active backend is attributable
- **WHEN** knowledge is resolved for a project
- **THEN** the selected backend is surfaced to the client (knowledge view and copilot status) so differing behaviour between backends is attributable

### Requirement: Faceted decision queries on the kb path
On the kb path, the system SHALL query decisions using kb's structured facets rather than ad-hoc text matching, using the server-side store API (which exposes `filters`) rather than the `kb_search` tool (which does not).

#### Scenario: Active decisions retrieved by facet filter
- **WHEN** the kb backend resolves decisions whose status is active
- **THEN** it issues a search carrying a `status` equality filter, and only files whose normalized `status` property matches are returned

#### Scenario: Decision status counts
- **WHEN** the kb backend requests decision facet counts
- **THEN** it receives a map of status value to count of distinct files

#### Scenario: Fallback path has no facets
- **WHEN** the fallback backend resolves decisions
- **THEN** it uses the vendored adapter's frontmatter parsing, and the system does not present facet counts for that backend

### Requirement: Keyword-matcher index seeded from the active backend
The system SHALL continue to use the vendored `knowledge/keyword-matcher.ts` for per-transcript-line `topics` annotation on BOTH paths, and SHALL seed its keyword index from the active backend at meeting-copilot start. The system SHALL NOT perform a knowledge-base search per transcript line.

#### Scenario: Index seeded from kb when kb is active
- **WHEN** meeting-copilot starts for a folder using the kb backend
- **THEN** the keyword index is built from kb's indexed titles, headings, and tags before capture begins

#### Scenario: Index seeded from the vendored digest on fallback
- **WHEN** meeting-copilot starts for a folder using the fallback backend
- **THEN** the keyword index is built from the vendored digest over the configured `knowledge.sources`

#### Scenario: No per-line knowledge-base query
- **WHEN** a transcript line is written during an active capture
- **THEN** its `topics` are computed by the in-memory keyword matcher only, with no knowledge-base search issued for that line
