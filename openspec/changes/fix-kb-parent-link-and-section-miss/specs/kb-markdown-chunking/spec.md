## MODIFIED Requirements

### Requirement: Breadcrumb and Parent Linkage
The chunker SHALL compute a hierarchical heading path and parent reference for each section based on heading nesting. The parent reference SHALL name the first emitted chunk of the section's direct enclosing section (the nearest preceding heading of a shallower level, i.e. fewer `#`), after empty-section dropping, tiny-merge and oversize-split normalization. It SHALL be null when the section is top-level or a preamble, or when its direct enclosing section has no chunk in the final output (dropped as empty, or merged away as tiny). It SHALL never name a sibling, a descendant, a grand-ancestor or the chunk itself.

#### Scenario: Breadcrumb from heading stack
- **WHEN** a heading is encountered
- **THEN** ancestors whose level is greater than or equal to the new heading's level are removed from the stack before it is pushed
- **AND** the heading path is the `" > "`-joined titles of the remaining stack including the new heading

#### Scenario: Parent chunk reference
- **WHEN** a heading is nested under an enclosing heading that emitted a chunk
- **THEN** its `parentChunkId` references the first chunk of that enclosing section
- **AND** a top-level or preamble section has `parentChunkId` of null

#### Scenario: Siblings share the enclosing parent
- **WHEN** a file has `# Title`, then sibling sections `## A` and `## B`, and all three have a trimmed body of at least 100 characters
- **THEN** the `parentChunkId` of both `## A` and `## B` is the chunk id of `# Title`
- **AND** neither section's `parentChunkId` is its own chunk id or the other sibling's chunk id

#### Scenario: Parent survives a blank preamble
- **WHEN** a file has blank lines before its first heading `# Title`, which has a nested `## A`, and both have a trimmed body of at least 100 characters
- **THEN** the `parentChunkId` of `## A` is the chunk id of `# Title`

#### Scenario: Chunkless enclosing section yields a null parent
- **WHEN** `# Title` has a trimmed body of at least 100 characters, its child `## P` has no body of its own or a trimmed body under 100 characters, and `## P` has a nested `### C` with a trimmed body of at least 100 characters
- **THEN** the `parentChunkId` of `### C` is null
- **AND** it is not the chunk id of `# Title` or of any other chunk

#### Scenario: Children of an oversize-split parent reference its first piece
- **WHEN** a section whose body consists of blank-line-separated paragraphs totalling at least 5000 characters is split into several chunks, and has a nested heading with a trimmed body of at least 100 characters
- **THEN** the nested section's `parentChunkId` is the chunk id of the first piece of that section
