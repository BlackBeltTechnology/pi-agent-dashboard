## ADDED Requirements

### Requirement: API reference documents UI routes
`references/api-reference.md` SHALL include a "UI routes (browser)" section, outside the "WebSocket bus verbs" section, listing the session and folder/OpenSpec client routes, the full-id and prefix rules, the `embed` parameter, the `uiUrl` / `diffUrl` fields, and that credentials never go in a UI URL.

#### Scenario: Route table complete
- **WHEN** the agent reads the "UI routes (browser)" section
- **THEN** it SHALL find `/session/:id`, `/session/:id/diff`, `/session/:id/editor`, `/folder/:encodedCwd`, `/folder/:encodedCwd/openspec`, `/folder/:encodedCwd/openspec/specs`, `/folder/:encodedCwd/openspec/:changeName/:artifactId` and `/folder/:encodedCwd/openspec/archive[/:entry[/:artifact]]`

#### Scenario: Archived sessions need the full id
- **WHEN** the agent reads how to open an archived session
- **THEN** it SHALL find `/session/<full id>?archived=1` and that a prefix is not resolved for archived sessions

#### Scenario: Session fields list UI links
- **WHEN** the agent reads the `GET /api/sessions` field table
- **THEN** it SHALL find `uiUrl` and `diffUrl` with their meaning

### Requirement: API reference documents the encodedCwd encoding
The reference SHALL state that `:encodedCwd` is base64url of the UTF-8 absolute path without `=` padding, give a POSIX shell one-liner producing it, and state that `:changeName` / `:artifactId` are `encodeURIComponent`-encoded.

#### Scenario: Agent builds a folder URL
- **WHEN** the agent needs the OpenSpec board for `/Users/me/proj`
- **THEN** the reference SHALL give it enough to produce `<BASE>/folder/<base64url("/Users/me/proj")>/openspec` without reading client source
