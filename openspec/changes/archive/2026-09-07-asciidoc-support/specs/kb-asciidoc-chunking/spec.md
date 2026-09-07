## Purpose

Split an AsciiDoc document into structural, breadcrumb-aware chunks that never break inside delimited blocks, while extracting document attributes and outbound xref links. Output feeds the same knowledge base as markdown chunks: heading path, stable id, level, parent linkage, content hash, and real line anchors.

## ADDED Requirements

### Requirement: Document-Attribute Header Extraction

The chunker SHALL detect the AsciiDoc document header (doctitle plus leading `:name: value` attribute entries) and return the attribute entries as a key/value map separate from the chunked body, analogous to markdown frontmatter. The parser SHALL be total (never throws) and pure (same bytes produce the same output). Line endings SHALL be normalized to LF before detection.

#### Scenario: Header attributes extracted
- **WHEN** the document starts with a `= Title` line followed by `:attr: value` lines before the first blank line
- **THEN** the attribute entries are parsed into a key/value map returned separately
- **AND** the doctitle is used as the level-0 document heading

#### Scenario: Boolean and empty attributes
- **WHEN** an attribute entry has no value (`:toc:`) or a negated form (`:!sectnums:`)
- **THEN** it is captured with an empty-string value (or a negation marker) and no exception is thrown

#### Scenario: No header
- **WHEN** the document has no `= Title` first line
- **THEN** the entire text is chunked as body and the attribute map is null
- **AND** the preamble chunk's heading is the file name with its `.adoc`/`.asciidoc` extension removed

### Requirement: Delimited-Block-Safe Section Splitting

The chunker SHALL split the body into sections at AsciiDoc section titles (`=` to `======` followed by whitespace and title text), treating only titles that occur outside delimited blocks as boundaries. Delimited blocks SHALL include listing (`----`), literal (`....`), example (`====`), sidebar (`****`), quote (`____`), passthrough (`++++`), open (`--`), table (`|===`), and comment (`////`) blocks.

#### Scenario: Section title starts a new section
- **WHEN** a line outside any delimited block matches one to six leading `=` characters followed by whitespace and title text
- **THEN** the current section is finalized and a new section begins with the parsed title and level

#### Scenario: Titles inside delimited blocks are content
- **WHEN** a `== Title`-shaped line occurs between an opening and closing delimiter of any listed block type
- **THEN** it is kept as body content, not treated as a section boundary
- **AND** the block closes only on a matching closing delimiter line

#### Scenario: Content before the first section title
- **WHEN** body content appears after the header but before any section title
- **THEN** it becomes a preamble chunk under the doctitle (or the file-name heading when no header exists)

#### Scenario: Empty sections dropped
- **WHEN** a section contains no body content
- **THEN** no chunk is emitted for it

### Requirement: Chunk Contract Parity

Chunks produced from AsciiDoc SHALL carry the same metadata contract as markdown chunks — breadcrumb heading path, parent chunk reference, tiny-merge and oversize-split normalization, stable chunk id, and content hash — and SHALL additionally carry line anchors referencing real line numbers in the source file (an adoc-first extension; markdown chunks carry no line anchors today). Oversize splitting SHALL only break at blank lines outside delimited blocks, keeping an oversized single chunk when no safe split point exists.

#### Scenario: Breadcrumb from section stack
- **WHEN** a section at level 3 is chunked under a level-2 and level-1 ancestor
- **THEN** its heading path is the ordered ancestor titles joined with the section's own title

#### Scenario: Line anchors are real
- **WHEN** a chunk is emitted
- **THEN** its start/end line anchors match the section's actual line range in the source file

#### Scenario: Tiny sections merge and oversized sections split
- **WHEN** a section is below the tiny threshold or above the oversize threshold
- **THEN** the same merge/split thresholds as the markdown chunker apply
- **AND** an oversize split point never falls inside a delimited block

### Requirement: Xref Link Extraction

The chunker SHALL extract outbound document-level links from `xref:target[]` macros and `<<target>>` cross-references whose file component (fragment stripped first) ends in `.adoc`/`.asciidoc`, and these links SHALL feed the same knowledge-graph edge construction as markdown document links.

#### Scenario: Xref macro to an adoc file
- **WHEN** the document body contains `xref:other.adoc[Label]` or `xref:other.adoc#section[Label]`
- **THEN** `other.adoc` is reported as an outbound link of the document

#### Scenario: Internal anchor references are not file links
- **WHEN** the document body contains `<<section-anchor>>` with no file component
- **THEN** no outbound file link is reported for it

#### Scenario: Xref links become graph edges
- **WHEN** an indexed adoc document links `other.adoc` and both are indexed
- **THEN** a graph edge connects the two documents, traversable via kb neighbors
