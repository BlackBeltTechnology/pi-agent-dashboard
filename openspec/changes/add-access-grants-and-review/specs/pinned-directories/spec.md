## ADDED Requirements

### Requirement: A cwd-allowlist denial offers pinning as its remedy

HTTP routes that refuse an unknown `cwd` SHALL carry the refusal reason and the remedy alongside their existing error string. Because the known-cwd set already includes the user's pinned directories, pinning the refused directory SHALL be the offered `allow-always` remedy.

The covered HTTP routes are the goal routes, the OpenSpec group routes, the KB plugin HTTP routes, and `GET /api/file/exists` (whose refusal string is `"unknown cwd"`, distinct from the others' `"cwd not allowed"`). Each route's existing `error` string SHALL be preserved unchanged; the reason and hint SHALL be additional fields.

The additional fields SHALL be additive: each route's pre-existing `error` string is unchanged, so a client reading only `error` observes no difference.

Denial sites that are NOT HTTP routes are excluded: the two `plugin_action` browser-message handlers and the internal visitor-session-registry rejection have no HTTP request to suspend and no response body to enrich. They SHALL retain their current behaviour.

#### Scenario: Denial body is self-describing

- **WHEN** a route refuses a request because its `cwd` is not in the known set
- **THEN** the 403 body SHALL carry a reason and a hint describing how access can be granted
- **AND** the pre-existing `error` string SHALL be unchanged

#### Scenario: Every cwd-refusing HTTP route is covered

- **WHEN** each of the goal, OpenSpec group, KB plugin HTTP, and `/api/file/exists` routes refuses an unknown `cwd`
- **THEN** each SHALL carry the additional fields

#### Scenario: Non-HTTP denial sites are unchanged

- **WHEN** a `plugin_action` message handler or the visitor-session registry refuses an unknown `cwd`
- **THEN** its behaviour SHALL be unchanged

#### Scenario: Pinning from the remedy surface

- **GIVEN** a `cwd` denial surfaced its remedy to the user
- **WHEN** the user accepts the offered remedy
- **THEN** the refused directory SHALL be added to the pinned directories

#### Scenario: Pinned directory is accepted on retry

- **GIVEN** a directory was pinned in response to a denial
- **WHEN** a request for that `cwd` is retried
- **THEN** it SHALL be admitted by the existing known-cwd check

#### Scenario: Denial without user action is unchanged

- **WHEN** a `cwd` denial occurs and the user takes no action
- **THEN** the request SHALL be refused with 403 immediately and no directory SHALL be pinned

#### Scenario: A path grant never pins a directory

- **GIVEN** directory `/a/b` is granted as a filesystem path anchor
- **WHEN** a `cwd` request for `/a/b` is made
- **THEN** it SHALL still be refused unless `/a/b` is separately pinned — the two remedies are distinct
