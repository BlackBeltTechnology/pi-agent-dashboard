# bounded-input-parsing Specification

## Purpose
TBD - created by archiving change fix-codeql-small-findings. Update Purpose after archive.

## Requirements

### Requirement: Text parsers fed by repository, agent or request content run in linear time
DOX row parsing (`parseRows`, `replaceRowPurpose`, `dox describe --list`, the
legacy file-index row parser, and the authored-batch parser of the file-index
migration), markdown link extraction in the kb chunker, branch slugification
(`slugifyBranch`) and local-source basename extraction used by `sourcesMatch`
SHALL run in time linear in their input length. On input of 100 000
characters, each SHALL complete within 100 ms, including on the adversarial
shapes reported by CodeQL. For every input, each SHALL return exactly the same
result as the previous regex-based implementation.

#### Scenario: DOX file with a long whitespace run
- **WHEN** `parseRows` receives a file whose only line is `` | `a` | `` followed by 100 000 spaces and `x`
- **THEN** it SHALL return within 100 ms with no rows

#### Scenario: Authored batch with a long whitespace run
- **WHEN** the authored-batch parser receives a line `` | `a` | x `` followed by 100 000 spaces and `y`
- **THEN** it SHALL return within 100 ms with one entry whose path is `a` and whose purpose is `x`, 100 000 spaces and `y`

#### Scenario: DOX row parsing unchanged on real and edge rows
- **WHEN** `parseRows`, `replaceRowPurpose`, `dox describe --list`, the legacy file-index row parser and the authored-batch parser run over the repository's `AGENTS.md` files and over rows whose purpose is empty, contains `\|`, `||` or backticks, has trailing tabs or a trailing `\r`, has `\r` or U+2028 directly before the closing pipe, lacks the closing pipe, or contains `\r` or U+2028 inside the purpose
- **THEN** every parsed path, purpose and rewritten file SHALL equal the previous implementation's output, including returning no row where the previous implementation returned none

#### Scenario: Unclosed link openers in a large document
- **WHEN** the chunker extracts links from 33 000 repetitions of `[[a`, from 33 000 repetitions of `](a`, and from 33 000 repetitions of `](a` followed by one `)`
- **THEN** each extraction SHALL return within 100 ms with no links

#### Scenario: Link extraction unchanged on edge inputs
- **WHEN** the chunker extracts links from text containing `[[target]]`, `[[ spaced ]]`, `[[ ]]`, `[[a]b]]`, `[[[a]]`, `[x](docs/a.md)`, `[y](b.mdx)`, `[z](c.txt)`, `[w](a(b).md)`, `[v](a.md )` and `](.md)`
- **THEN** the wikilinks SHALL be `target`, `spaced`, `` (empty) and `[a` and the md-links SHALL be `docs/a.md` and `b.mdx` — exactly what the previous regexes returned

#### Scenario: Branch name with long dash runs
- **WHEN** `slugifyBranch` receives `a`, 100 000 `-` and `a`; and separately `-feat`, `--x--` and `/foo`
- **THEN** the first SHALL return within 100 ms, and the results SHALL equal the previous implementation's (`feat`, `x`, `foo` for the separate inputs)

#### Scenario: Source string with a long slash run
- **WHEN** `sourcesMatch` compares the raw path 100 000 `/` followed by `x` with `git:github.com/o/x`
- **THEN** it SHALL return `true` within 100 ms

#### Scenario: Local-path basename rules unchanged
- **WHEN** `sourcesMatch` compares `/p/foo.git/` with `git:github.com/o/foo`, `/p/pkg\` with `git:github.com/o/pkg`, and `/p/foo.GIT` with `git:github.com/o/foo`
- **THEN** the results SHALL be `true`, `false` and `false`, as with the previous implementation
