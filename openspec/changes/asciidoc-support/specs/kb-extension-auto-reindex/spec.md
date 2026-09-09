## MODIFIED Requirements

### Requirement: Debounced hash-gated reindex on markdown edit

Job 1 SHALL run whenever a `write`, `edit`, or `bash` tool result carries a path ending in `.md`, `.mdx`, `.markdown`, `.adoc`, or `.asciidoc`, scheduling a debounced incremental reindex whose actual re-chunking is gated by file content changes. Reindex eligibility and DOX-nudge eligibility SHALL be decided by independent predicates: scheduling a reindex for an AsciiDoc edit MUST NOT exempt that edit from Job 2's nudge decision.

#### Scenario: Markdown edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.md`/`.mdx`/`.markdown` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd
- **AND** the reindex fires after the debounce window (default 800 ms) elapses with no further edit

#### Scenario: AsciiDoc edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.adoc`/`.asciidoc` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd, identically to a markdown edit

#### Scenario: AsciiDoc edit stays nudge-eligible
- **WHEN** DOX enforcement is on and a `.adoc` file lacking a fresh AGENTS.md row is edited
- **THEN** a reindex is scheduled AND the DOX nudge for that path is still evaluated and sent

#### Scenario: Rapid successive edits collapse to one reindex
- **WHEN** multiple markdown edits arrive for the same cwd within the debounce window
- **THEN** each new edit clears the pending timer and reschedules
- **AND** only a single reindex runs after the last edit, keyed per cwd

#### Scenario: Unchanged content skips re-chunking
- **WHEN** the debounced reindex walks the sources
- **THEN** the incremental indexer compares each file's mtime then sha256 hash
- **AND** files whose hash is unchanged are not re-chunked

#### Scenario: A bash tool result with no path is ignored
- **WHEN** a `bash` tool result carries a `command` but no `path`
- **THEN** no reindex is scheduled (bash commands are not parsed for edits)

#### Scenario: Reindex failure is swallowed
- **WHEN** the debounced reindex rejects
- **THEN** the error is logged as a warning and does not crash the session
