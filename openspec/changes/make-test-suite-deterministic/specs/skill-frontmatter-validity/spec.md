## MODIFIED Requirements

### Requirement: Skill frontmatter parses as valid YAML

Every `SKILL.md` in the repo SHALL have a leading `---`-fenced frontmatter block that parses as valid YAML (excluding `node_modules`, build output, and worktree checkouts).

Exclusion SHALL be enforced by two layers. The directory-basename prune SHALL continue to prune the walk. In addition, collected candidates SHALL be filtered by git-ignore status, so that generated or vendored trees are excluded regardless of what their directory is named. The git-ignore layer SHALL be additive: removing it SHALL NOT weaken the basename exclusion.

#### Scenario: All skill manifests parse

- **WHEN** the guard collects every `SKILL.md` under the repo, excluding pruned directories and gitignored paths
- **THEN** each file's `---`-fenced frontmatter SHALL parse without a YAML error.

#### Scenario: Description-with-colon values are quoted

- **WHEN** a skill `description` value contains a `colon-space` sequence (e.g. `Triggers: "…"`)
- **THEN** the value SHALL be a quoted or block scalar so the parser does not read it as a nested mapping.

#### Scenario: Gitignored residue is never collected

- **GIVEN** a working tree where `packages/electron/resources/bundled-extensions/` still exists as residue from a build step that has since been removed
- **AND** that path is matched by `.gitignore`
- **WHEN** the guard runs
- **THEN** no `SKILL.md` beneath it SHALL be collected
- **AND** the guard SHALL report the same findings as on a fresh checkout where the directory is absent

#### Scenario: A gitignored directory with an unlisted name needs no guard change

- **GIVEN** a `SKILL.md` inside a gitignored directory whose basename is absent from the prune list
- **WHEN** the guard runs
- **THEN** it SHALL NOT be collected
- **AND** no edit to the prune list SHALL be required

#### Scenario: Untracked-but-not-ignored skills are still checked

- **GIVEN** a newly authored `SKILL.md` that is untracked and not matched by any `.gitignore` rule
- **WHEN** the guard runs
- **THEN** it SHALL be collected and validated

#### Scenario: Git-ignore filtering costs one subprocess

- **WHEN** the guard filters its candidate list by git-ignore status
- **THEN** it SHALL issue a single batched `git check-ignore` invocation for the whole candidate set
- **AND** SHALL NOT invoke git once per directory or per file

#### Scenario: Candidate paths are normalized before git sees them

- **GIVEN** a candidate path containing a non-posix (`\`) separator, as produced by `path.join` on Windows
- **WHEN** it is prepared for `git check-ignore`
- **THEN** the normalization step SHALL convert it to posix separators
- **AND** this SHALL be verified by a unit test on the normalization function directly, so the behaviour is covered on a posix-only CI runner

#### Scenario: Degraded mode retains the basename exclusion

- **WHEN** the guard runs where `git check-ignore` cannot be executed or returns an error
- **THEN** it SHALL treat every candidate as not-ignored
- **AND** the directory-basename prune SHALL still exclude `node_modules`, `dist`, `build`, `out`, `coverage`, `.next`, and worktree checkouts
- **AND** the guard SHALL NOT crash or collect zero files
