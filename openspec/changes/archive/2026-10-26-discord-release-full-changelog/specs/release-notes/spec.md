## ADDED Requirements

### Requirement: Community Discord announcement carries the full release notes

When a non-prerelease GitHub Release is published, the `discord-announce` job in `.github/workflows/publish.yml` SHALL post the complete GitHub Release body to the `DISCORD_RELEASE_WEBHOOK` webhook, without truncation, as consecutive messages of one embed each, every embed description at most 4000 characters.

#### Scenario: Long release body posts in full across numbered messages

- **WHEN** a release body exceeds 4000 characters
- **THEN** the announcement SHALL be posted as N > 1 messages in order
- **AND** each message's embed description SHALL be at most 4000 characters
- **AND** chunks SHALL break after a newline whenever a line fits, each chunk keeping its trailing newline
- **AND** for a non-empty body, concatenating the payload descriptions as sent, in order with no separator, SHALL equal the release body exactly, including CRLF line endings and a trailing newline (Discord may trim leading/trailing whitespace of each description when it stores the message; that trimming is outside this guarantee)
- **AND** no chunk boundary SHALL separate a UTF-16 surrogate pair
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
