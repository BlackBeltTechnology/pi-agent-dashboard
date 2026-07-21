# kb-markdown-chunking Specification

## Purpose
Split a markdown document into structural, breadcrumb-aware chunks that never break inside code fences, while extracting frontmatter and outbound links. The output feeds a searchable knowledge base so each chunk carries a heading path, stable id, level, parent linkage, and content hash.

## Requirements

### Requirement: Frontmatter Extraction
The chunker SHALL detect and parse a leading YAML-style frontmatter block, remove it from the chunked body, and return its parsed key/value map separately.

#### Scenario: Frontmatter present
- **WHEN** the input text begins with `---\n` and a closing `\n---` exists after it
- **THEN** the region between the delimiters is parsed line by line as `key: value`, and the remaining text after the closing delimiter is used as the body to chunk
- **AND** the parsed map is returned as `frontmatter`

#### Scenario: Scalar and array values
- **WHEN** a frontmatter value begins with `[`
- **THEN** it is treated as an array: split on commas, each element trimmed and stripped of surrounding quotes, empty elements dropped
- **AND** otherwise the value is a scalar with surrounding quotes stripped

#### Scenario: No or malformed frontmatter
- **WHEN** the text does not start with `---\n`, or no closing `\n---` is found
- **THEN** the entire text is used as the body and `frontmatter` is returned as null

### Requirement: Fence-Safe Heading Splitting
The chunker SHALL split the body into sections at ATX headings, treating only headings that occur outside fenced code blocks as section boundaries.

#### Scenario: ATX heading starts a new section
- **WHEN** a line outside a code fence matches one to six leading `#` characters followed by whitespace and heading text
- **THEN** the current section is finalized and a new section begins with the parsed heading text and heading level (1–6)

#### Scenario: Code fence suppresses heading detection
- **WHEN** a line (after trimming leading whitespace) opens a fence with three or more backticks or tildes
- **THEN** the chunker enters fenced state and any `#`-prefixed lines until the fence closes are kept as body content, not treated as headings
- **AND** the fence closes only when a later line begins with the same fence character that opened it

#### Scenario: Content before the first heading
- **WHEN** body content appears before any heading
- **THEN** it becomes a preamble chunk whose heading and heading path are the file name with its `.md`/`.mdx`/`.markdown` extension removed, at level 0

#### Scenario: Empty sections dropped
- **WHEN** a section has no non-whitespace body
- **THEN** it is not emitted as a chunk

### Requirement: Breadcrumb and Parent Linkage
The chunker SHALL compute a hierarchical heading path and parent reference for each section based on heading nesting.

#### Scenario: Breadcrumb from heading stack
- **WHEN** a heading is encountered
- **THEN** ancestors whose level is greater than or equal to the new heading's level are removed from the stack before it is pushed
- **AND** the heading path is the `" > "`-joined titles of the remaining stack including the new heading

#### Scenario: Parent chunk reference
- **WHEN** a heading is nested under an ancestor heading
- **THEN** its `parentChunkId` references the nearest enclosing ancestor section
- **AND** a top-level or preamble section has `parentChunkId` of null

### Requirement: Tiny-Merge and Oversize-Split Normalization
The chunker SHALL normalize section sizes by merging undersized sections upward and splitting oversized sections by paragraph.

#### Scenario: Merge tiny section
- **WHEN** a section's trimmed body is shorter than 100 characters and a previous section exists
- **THEN** the tiny section's heading and body are appended onto the previous section instead of forming their own chunk

#### Scenario: Split oversized section
- **WHEN** a section's body exceeds 4000 characters
- **THEN** it is split on blank-line paragraph boundaries into multiple chunks that each stay within 4000 characters where possible, preserving the section's heading metadata

### Requirement: Chunk Identity and Metadata
The chunker SHALL assign each emitted chunk a stable id, content hash, and carried metadata.

#### Scenario: Stable chunk id and hash
- **WHEN** chunks are emitted
- **THEN** each chunk id is the first 8 hex characters of the SHA-256 of the file path, joined by `:` with the chunk's ordinal index
- **AND** `bodyHash` is the SHA-256 of the trimmed body and the emitted body is right-trimmed

#### Scenario: Carried document metadata
- **WHEN** chunks are emitted
- **THEN** each chunk carries the source root, relative path, heading, heading path, level, and the document type, defaulting to `doc` when none is supplied

### Requirement: Link Extraction
The chunker SHALL extract wiki-style and markdown-style outbound links from the full input text including frontmatter.

#### Scenario: Wiki links
- **WHEN** the text contains `[[target]]` occurrences
- **THEN** each inner target is returned trimmed in `wikilinks`

#### Scenario: Markdown links to markdown files
- **WHEN** the text contains `](path)` where the path ends in `.md` or `.mdx`
- **THEN** each such path is returned trimmed in `mdLinks`
