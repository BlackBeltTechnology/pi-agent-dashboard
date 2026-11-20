## MODIFIED Requirements

### Requirement: Parent and graph context expansion

Search SHALL support returning a child hit together with its parent
section/file (small-to-big), using the stored `parent_chunk_id` and `child_of`
edges, and SHALL optionally expand results with graph neighbors/backlinks.
Parent expansion SHALL be on by default; graph expansion SHALL be opt-in.
The attached parent SHALL carry only `headingPath`, as display/context — NOT a
refetch key — and SHALL NOT include `root`, `path`, `docType`, `chunkId`, a
constant `score`, or a `snippet`. The parent chunk is, by construction of the
indexer's per-file heading stack, in the same file as the child, so the omitted
location fields are redundant. `KbHit.parent` is consequently non-recursive.
A hit whose chunk has no parent reference (top-level, preamble, or a section
whose direct enclosing section emitted no chunk) SHALL carry no parent, never a
substitute ancestor or sibling.

#### Scenario: Parent context returned with a section hit

- **WHEN** `kb search --expand-parent` (or default) returns a subsection hit whose chunk has a parent reference
- **THEN** the result SHALL include the parent section/file context
- **AND** the parent SHALL expose `headingPath` only

#### Scenario: Parent carries no fields duplicated from the child

- **WHEN** parent expansion attaches a parent to a hit
- **THEN** the parent object SHALL NOT include `root`, `path`, `docType`,
  `chunkId`, a constant `score`, or a `snippet` field

#### Scenario: Attached parent is an enclosing heading of the hit

- **WHEN** parent expansion attaches a parent to a hit in a file whose heading titles contain no ` > `
- **THEN** the parent's `headingPath` SHALL be the hit's `headingPath` with its last ` > `-separated segment removed

#### Scenario: No parent reference, no parent

- **WHEN** a hit's chunk has no parent reference
- **THEN** the hit SHALL carry no parent

### Requirement: Section argument falls back to the last heading
A `section` argument SHALL first match a chunk's full heading path exactly. If nothing matches and the argument contains no ` > ` separator, it SHALL match chunks of that file whose last heading equals the argument. A single match SHALL return that section; several matches SHALL return their full heading paths as candidates and no body. When the path resolves to exactly one indexed file but no heading path or last heading matches, the fetch SHALL return a section-not-found marker that names the section and the path as the caller passed it, followed by the heading paths of the file's body sections in document order, each listed once and at most 50, with a count line for any further paths, and no body; when the file has no body sections the marker SHALL end `— no sections)` instead of listing any. The frontmatter title section SHALL NOT be listed. That marker SHALL differ from the path not-found marker, and the fetch SHALL report `found: false`.

#### Scenario: Exact heading path
- **WHEN** the agent calls `kb_get` with section `Guide > Setup > Files`
- **THEN** the tool SHALL return that exact section

#### Scenario: Unique last heading
- **WHEN** a file has exactly one section whose last heading is `Files` and the agent passes section `Files`
- **THEN** the tool SHALL return that section instead of not-found

#### Scenario: Ambiguous last heading
- **WHEN** a file has sections `A > Files` and `B > Files` and the agent passes section `Files`
- **THEN** the tool SHALL list both full heading paths and return no body

#### Scenario: Unknown section
- **WHEN** `guide.md` is indexed and no heading path or last heading of it matches the section `Guide > Nope`
- **THEN** the result SHALL be `(section not found: Guide > Nope in guide.md — sections:)` followed by one line per distinct body-section heading path of `guide.md` in document order
- **AND** the result SHALL NOT contain `(not found: guide.md)` or any section body
- **AND** the fetch SHALL report `found: false`

#### Scenario: Section list is capped
- **WHEN** an indexed file has 60 distinct body-section heading paths and the agent passes an unknown section
- **THEN** the marker SHALL list the first 50 heading paths in document order followed by `(+10 more sections)`
- **AND** with 51 paths the count line SHALL read `(+1 more section)`

#### Scenario: File without body sections
- **WHEN** an indexed file has frontmatter but no body sections and the agent passes an unknown section `Nope`
- **THEN** the result SHALL be `(section not found: Nope in <path> — no sections)`
- **AND** the fetch SHALL report `found: false`

#### Scenario: Listed heading path round-trips
- **WHEN** the agent passes any heading path listed by the section-not-found marker back to `kb_get` with the same path
- **THEN** the tool SHALL return a non-empty section body

#### Scenario: Unknown path still reports the path not-found marker
- **WHEN** the path is indexed in no source and a section is passed
- **THEN** the result SHALL be `(not found: <path>)` with no section list

#### Scenario: CLI and tool agree on an unknown section
- **WHEN** the same path and unknown section are fetched via `kb get <path> --section <s>` and via `kb_get`
- **THEN** both SHALL return the same section-not-found marker and the same heading-path list
