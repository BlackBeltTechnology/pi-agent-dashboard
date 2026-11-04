# Spec Delta

## ADDED Requirements

### Requirement: Section fetch resolves a path across every configured source
A section fetch by path (the `kb_get` tool and the `kb get` CLI) SHALL look for the path in every resolved source, not only the first. Both surfaces SHALL apply the same resolution rules. A path that matches in exactly one source SHALL return that source's section. A path that matches in no source SHALL return the not-found marker naming the requested path.

#### Scenario: Hit in a non-first source is fetchable
- **WHEN** the KB has sources A then B, `guide.md` is indexed only in B, and the agent calls `kb_get` with path `guide.md`
- **THEN** the tool SHALL return the first section of B's `guide.md`, not `(not found: guide.md)`

#### Scenario: Every kb_search path in a multi-source KB resolves
- **WHEN** a multi-source KB has no relative path indexed in more than one source, and the agent passes each path printed by `kb_search` to `kb_get`
- **THEN** every call SHALL return a section body and none SHALL return the not-found marker

#### Scenario: CLI and tool agree
- **WHEN** the same path is fetched via `kb get <path>` and via `kb_get`
- **THEN** both SHALL return the same section, the same collision list or the same not-found marker

#### Scenario: Unknown path still reports not found
- **WHEN** the path is indexed in no source
- **THEN** the result SHALL be `(not found: <path>)`

### Requirement: Section fetch accepts a source-qualified path
A fetch path MAY be qualified by a source. The qualifier is either the source's directory relative to the working directory (e.g. `.pi/docs/knowledge-base.md`) or the source id followed by `:` and the path. A qualified path SHALL resolve only within that source. When the literal reading and a qualified reading of the same argument both resolve to different sections, the fetch SHALL treat the argument as ambiguous.

#### Scenario: Directory-qualified path
- **WHEN** source `.pi/docs` indexes `knowledge-base.md` and the agent calls `kb_get` with `.pi/docs/knowledge-base.md`
- **THEN** the tool SHALL return that source's `knowledge-base.md` section

#### Scenario: Source-id-qualified path for a remote source
- **WHEN** a git source with id `git:https://github.com/o/r` indexes `README.md` and the agent calls `kb_get` with `git:https://github.com/o/r:README.md`
- **THEN** the tool SHALL return that source's `README.md` section

#### Scenario: Qualifier selects among colliding sources
- **WHEN** `README.md` is indexed in sources `docs` and `vendor` and the agent fetches `vendor/README.md`
- **THEN** the tool SHALL return the `vendor` source's section and no collision list

#### Scenario: Literal and qualified readings both resolve
- **WHEN** source `.` indexes `docs/a.md` and another source with directory `docs` indexes `a.md`, and the agent fetches `docs/a.md`
- **THEN** the fetch SHALL return the candidates `.:docs/a.md` and `docs:a.md` and no body

### Requirement: An ambiguous path returns candidates, never an arbitrary match
When an unqualified path is indexed in more than one source, a section fetch SHALL NOT return any section body. It SHALL return a list of candidates in the form `<source-id>:<path>`, each accepted unchanged by a follow-up fetch even when a source id itself contains `:`, and SHALL report `found: false` with the candidate count in its details.

#### Scenario: Same relative path in two sources
- **WHEN** `AGENTS.md` is indexed in sources `packages/a` and `packages/b` and the agent calls `kb_get` with `AGENTS.md`
- **THEN** the output SHALL name `packages/a:AGENTS.md` and `packages/b:AGENTS.md` as candidates and contain no section body

#### Scenario: Candidate round-trips
- **WHEN** the agent passes a listed candidate back to `kb_get`
- **THEN** the tool SHALL return that candidate's section

### Requirement: Section argument falls back to the last heading
A `section` argument SHALL first match a chunk's full heading path exactly. If nothing matches and the argument contains no ` > ` separator, it SHALL match chunks of that file whose last heading equals the argument. A single match SHALL return that section; several matches SHALL return their full heading paths as candidates and no body.

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
- **WHEN** no heading path or last heading of the file matches the section
- **THEN** the result SHALL be the not-found marker
