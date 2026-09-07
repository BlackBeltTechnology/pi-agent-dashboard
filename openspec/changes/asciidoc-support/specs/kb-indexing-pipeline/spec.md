## MODIFIED Requirements

### Requirement: Source directory walk and file selection
The indexer SHALL recursively walk each configured source directory, select Markdown and AsciiDoc files, and classify each by doc type, while excluding infrastructure directories and honoring caller-supplied include/exclude filters. Default include and extension filters SHALL admit AsciiDoc files, and each selected file SHALL be dispatched to the chunker matching its extension (markdown chunker for `.md`/`.mdx`/`.markdown`, AsciiDoc chunker for `.adoc`/`.asciidoc`).

#### Scenario: Recursive Markdown selection
- **WHEN** a source directory is walked
- **THEN** only files with a `.md`, `.mdx`, `.markdown`, `.adoc`, or `.asciidoc` extension are collected
- **AND** directories matching the built-in exclusion set (`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.kb`) are skipped

#### Scenario: Include/exclude and extension filters applied
- **WHEN** the caller supplies include globs, exclude globs, or an extensions list
- **THEN** a file is retained only if it matches the include filters (when present)
- **AND** a file matching an exclude glob is dropped

#### Scenario: Default filters admit AsciiDoc
- **WHEN** no caller-supplied include or extensions filters are present
- **THEN** the default configuration retains `.adoc` and `.asciidoc` files in addition to markdown

#### Scenario: Per-extension chunker dispatch
- **WHEN** a selected `.adoc` or `.asciidoc` file is indexed
- **THEN** it is chunked by the AsciiDoc chunker
- **AND** markdown files continue to be chunked by the markdown chunker
- **AND** a title fallback derived from the file name strips the `.adoc`/`.asciidoc` extension

#### Scenario: Doc-type classification
- **WHEN** a selected file is classified
- **THEN** files named `AGENTS.md`, `CLAUDE.md`, or ending in `.AGENTS.md` are typed as `agents`
- **AND** Markdown or AsciiDoc under a source path (`src`, `lib`, `app`, `packages`) is typed as `source-md` when source-markdown indexing is enabled, otherwise files are typed as `doc`

#### Scenario: Agents files excluded on request
- **WHEN** indexing of agents files is disabled
- **THEN** files classified as `agents` are excluded from the selection
