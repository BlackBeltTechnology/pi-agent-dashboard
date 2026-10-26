# release-notes Specification

## Purpose

Define the conventions, location, and format for human-authored release notes for pi-agent-dashboard. Establish `CHANGELOG.md` (Keep a Changelog 1.1.0) as the canonical record, with GitHub Release bodies derived automatically from matching version sections. Document the full release workflow in `docs/release-process.md` and keep the notes discoverable from `README.md` and `AGENTS.md`.

## Requirements

### Requirement: CHANGELOG file exists at repo root

The repository SHALL contain a `CHANGELOG.md` file at the root, written in [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format, documenting every released version of the project.

#### Scenario: Repository root contains CHANGELOG.md

- **WHEN** a reader opens the repository on GitHub or clones it locally
- **THEN** a file named `CHANGELOG.md` SHALL exist at the repo root
- **AND** it SHALL declare Keep a Changelog as its format (e.g., a link in the header)
- **AND** it SHALL reference [Semantic Versioning](https://semver.org/) as the versioning scheme

#### Scenario: CHANGELOG starts with an Unreleased section

- **WHEN** a reader opens `CHANGELOG.md`
- **THEN** the first versioned heading SHALL be `## [Unreleased]`
- **AND** it SHALL sit directly below the document title and preamble
- **AND** it SHALL always be present even when empty

### Requirement: Each released version has a dedicated section

The CHANGELOG SHALL contain one section per released version (or, for the v0.2.x backfill, one section for the collapsed range), using predictable headings that can be parsed by automation.

#### Scenario: Versioned heading format

- **WHEN** a version is released
- **THEN** its CHANGELOG section heading SHALL match the form `## [<version>] - <YYYY-MM-DD>`
- **AND** `<version>` SHALL be the SemVer string without a leading `v` (e.g., `0.3.0`, not `v0.3.0`)
- **AND** `<YYYY-MM-DD>` SHALL be the release date

#### Scenario: Backfill entry for v0.2.0 through v0.2.9

- **WHEN** a reader inspects the CHANGELOG
- **THEN** exactly one section SHALL cover the v0.2.0–v0.2.9 range
- **AND** its heading SHALL clearly indicate the range (e.g., `## [0.2.0 – 0.2.9] - 2026-04-13 – 2026-04-16`)
- **AND** its body SHALL summarize the releases as "initial public releases — installer and cross-platform CI hardening"
- **AND** its body SHALL NOT attempt per-version breakdowns

#### Scenario: v0.3.0 entry groups work by Keep a Changelog subsections

- **WHEN** a reader opens the v0.3.0 section
- **THEN** it SHALL group changes under the standard subsections `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Deprecated`, and/or `### Security`
- **AND** empty subsections SHALL be omitted
- **AND** bullets SHALL describe user-visible behavior in prose, not commit subjects

### Requirement: CHANGELOG is the primary source for release notes

The `CHANGELOG.md` file SHALL be the canonical, complete record of changes, and the GitHub Release body SHALL be derived from it for each tag.

#### Scenario: GitHub Release body is derived from CHANGELOG

- **WHEN** a `v<version>` tag is pushed and the release workflow runs
- **THEN** the workflow SHALL extract the section whose heading matches `^## \[<version>\]` from `CHANGELOG.md`
- **AND** it SHALL pass the extracted content as the GitHub Release body
- **AND** the release SHALL be created as a draft so the author can review before publishing

#### Scenario: Release body extraction falls back gracefully

- **WHEN** the CHANGELOG extraction step cannot find a matching section, or the extracted content is empty, or the script errors
- **THEN** the release workflow SHALL NOT fail
- **AND** it SHALL fall back to publishing the release with either a short default body pointing to `CHANGELOG.md` or `generate_release_notes: true`
- **AND** the fallback path SHALL log a warning visible in the workflow run

### Requirement: Release process is documented

The repository SHALL contain `docs/release-process.md` describing the end-to-end release workflow so any maintainer can cut a release without tribal knowledge.

#### Scenario: Release process doc exists and covers the full flow

- **WHEN** a maintainer opens `docs/release-process.md`
- **THEN** it SHALL document how to add entries under `## [Unreleased]` during normal development
- **AND** it SHALL document the commit-message conventions in use (Conventional Commits prefixes)
- **AND** it SHALL document the promotion step (rename `Unreleased` to the new versioned heading with today's date, insert a fresh empty `Unreleased` above)
- **AND** it SHALL document the version bump command (`npm version <version> --workspaces --include-workspace-root`)
- **AND** it SHALL document tag + push and what the CI workflow does automatically
- **AND** it SHALL document how to manually edit the GitHub Release if automatic extraction produced incorrect output

### Requirement: Discoverability from README and AGENTS

The CHANGELOG and the release process doc SHALL be discoverable from the repository's primary landing surfaces.

#### Scenario: README links to CHANGELOG and release process

- **WHEN** a reader opens `README.md`
- **THEN** it SHALL include a link to `CHANGELOG.md`
- **AND** it SHALL include a link to `docs/release-process.md` in a contributor-facing section

#### Scenario: AGENTS.md key-files table includes the new files

- **WHEN** an AI agent loads `AGENTS.md`
- **THEN** the key-files table SHALL contain entries for `CHANGELOG.md` and `docs/release-process.md` with one-line purpose descriptions

### Requirement: Unreleased section is the contribution target

Work-in-progress user-visible changes SHALL be recorded under `## [Unreleased]` so that the release author's job at tag time is curation, not authoring from scratch.

#### Scenario: Unreleased section accepts contributions during development

- **WHEN** a PR ships user-visible behavior between releases
- **THEN** its author SHOULD add a bullet under the appropriate subsection of `## [Unreleased]` in `CHANGELOG.md`
- **AND** the bullet SHALL describe the behavior in end-user language
- **AND** absence of a bullet SHALL NOT block the PR (enforcement is convention + review, not CI)

#### Scenario: Unreleased section is promoted at release time

- **WHEN** a new version is being cut
- **THEN** the release author SHALL rename `## [Unreleased]` to `## [<version>] - <today>`
- **AND** insert a fresh empty `## [Unreleased]` section with empty `### Added`, `### Changed`, and `### Fixed` subsections above it
- **AND** review `git log <last-tag>..HEAD` and fill any gaps the contributors missed before tagging

### Requirement: Community Discord announcement carries the full release notes

When a non-prerelease GitHub Release is published, the `discord-announce` job in `.github/workflows/publish.yml` SHALL post the complete GitHub Release body to the `DISCORD_RELEASE_WEBHOOK` webhook, without truncation, as consecutive messages of one embed each, every embed description at most 4000 characters.

#### Scenario: Long release body posts in full across numbered messages

- **WHEN** a release body exceeds 4000 characters
- **THEN** the announcement SHALL be posted as N > 1 messages in order
- **AND** each message's embed description SHALL be at most 4000 characters
- **AND** chunks SHALL break after a newline whenever a line fits, each chunk keeping its trailing newline
- **AND** for a non-empty body, concatenating the descriptions in order with no separator SHALL equal the release body exactly, including CRLF line endings and a trailing newline
- **AND** message 1 SHALL be titled `Released <name>` and messages 2..N `Released <name> (<i>/<N>)`
- **AND** every embed SHALL link to the GitHub Release URL

#### Scenario: Single overlong line is hard-split

- **WHEN** one line of the body is longer than 4000 characters
- **THEN** that line SHALL be split into consecutive pieces of at most 4000 characters
- **AND** concatenating all descriptions with no separator SHALL still equal the body

#### Scenario: Short release body posts as one message

- **WHEN** a release body is non-empty and at most 4000 characters
- **THEN** exactly one message SHALL be posted, titled `Released <name>`, with the body as its description

#### Scenario: Empty release body

- **WHEN** the release body is empty
- **THEN** exactly one message SHALL be posted with description `_No release notes._`

#### Scenario: Unnamed release uses the tag

- **WHEN** the release has an empty name
- **THEN** the tag SHALL be used as `<name>` in every title

#### Scenario: Long release name fits the embed title limit

- **WHEN** `Released <name> (<i>/<N>)` would exceed 256 characters
- **THEN** `<name>` SHALL be shortened with a trailing `…` so every title is at most 256 characters

#### Scenario: Prerelease stays quiet

- **WHEN** the resolved tag is a prerelease
- **THEN** the `discord-announce` job SHALL NOT run

### Requirement: Discord release announcement cannot ping members

Every message the `discord-announce` job posts SHALL set `allowed_mentions` to `{ "parse": [] }`.

#### Scenario: Mention text in release notes

- **WHEN** the release body contains `@everyone`, `@here`, or role/user mentions
- **THEN** every posted message SHALL carry `allowed_mentions: { "parse": [] }`

### Requirement: Discord release announcement is best-effort

The `discord-announce` job SHALL NOT fail the release workflow and SHALL NOT expose the webhook secret. A failure part-way through a multi-message post MAY leave only the earlier messages posted.

#### Scenario: Secret unset skips cleanly

- **WHEN** the `DISCORD_RELEASE_WEBHOOK` secret (exposed to the step as env `DISCORD_WEBHOOK_URL`) is unset (e.g. a fork)
- **THEN** the job SHALL log a skip message and exit 0 without contacting Discord

#### Scenario: Webhook failure does not red the release

- **WHEN** Discord returns a non-2xx, non-429 status
- **THEN** the announce step SHALL stop posting and exit non-zero with Discord's status and response body, never the webhook URL
- **AND** the job's `continue-on-error: true` SHALL keep the release workflow green

#### Scenario: Rate limit is retried with a cap

- **WHEN** Discord returns HTTP 429 with `retry_after`
- **THEN** the same payload SHALL be re-sent after `retry_after` seconds, preserving message order
- **AND** after 5 consecutive 429 responses for one payload, or a `retry_after` above 60 seconds, the step SHALL exit non-zero
