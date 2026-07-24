## MODIFIED Requirements

### Requirement: Frontmatter Extraction
The chunker SHALL detect and parse a leading YAML-style frontmatter block using a
vendored zero-dependency YAML subset parser, remove it from the chunked body, and
return its parsed key/value map separately. Line endings SHALL be normalized to LF
before detection. The parser SHALL be total (it never throws) and pure (same bytes
produce the same output).

#### Scenario: Frontmatter present
- **WHEN** the input text (after CRLF→LF normalization) begins with `---\n` and a
  closing `\n---` exists after it
- **THEN** the region between the delimiters is parsed and the remaining text after
  the closing delimiter is used as the body to chunk
- **AND** the parsed map is returned as `frontmatter`

#### Scenario: Typed scalar, array, and block-list values
- **WHEN** a value is an inline `[a, b]` array or a block list of `- item` lines
- **THEN** it is parsed to a string array (elements trimmed, quotes stripped, empty
  dropped)
- **AND** a bare scalar is parsed as boolean (`true`/`false`), number
  (integer/float), or string, with surrounding quotes stripped and `#` comments
  removed

#### Scenario: Unsupported constructs fall back to string
- **WHEN** a value uses an unsupported construct (anchors/aliases, multiline block
  scalars `|`/`>`, general nested maps, merge keys)
- **THEN** that key is skipped or kept as a raw string and no exception is thrown

#### Scenario: Machine kb block is discarded
- **WHEN** the frontmatter contains a top-level `kb:` key
- **THEN** its entire indented subtree is consumed and excluded from the returned
  `frontmatter` map

#### Scenario: No or malformed frontmatter
- **WHEN** the text does not start with `---\n` (after normalization), or no
  closing `\n---` is found
- **THEN** the entire text is used as the body and `frontmatter` is returned as null

#### Scenario: CRLF-delimited frontmatter is detected
- **WHEN** the input uses `\r\n` line endings
- **THEN** frontmatter is detected and parsed identically to the LF form
