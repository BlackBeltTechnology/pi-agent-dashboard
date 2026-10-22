## Purpose

Bundled pi skill that lets any pi session monitor and control the dashboard server via REST API.

## Requirements

### Requirement: Bundled pi-dashboard skill
The dashboard package SHALL include a `.pi/skills/pi-dashboard/` directory discoverable both as a local project skill (via pi's `.pi/skills/` scan) and as a package skill (via `pi.skills` in `package.json`).

#### Scenario: Skill auto-discovery
- **WHEN** the dashboard package is installed and pi scans for skills
- **THEN** the `pi-dashboard` skill SHALL appear in available skills

### Requirement: Dashboard URL auto-discovery
The skill instructions SHALL guide the agent to read `~/.pi/dashboard/config.json` to determine the server port, defaulting to `localhost:8000`.

#### Scenario: Custom port configured
- **WHEN** config.json contains `"port": 9000`
- **THEN** the agent SHALL use `http://localhost:9000` as the base URL

#### Scenario: No config file
- **WHEN** config.json does not exist
- **THEN** the agent SHALL use `http://localhost:8000` as the default base URL

### Requirement: Auth-aware API access
The skill instructions SHALL document how to handle authentication when auth is enabled, including JWT token extraction and header injection.

#### Scenario: Auth enabled
- **WHEN** the dashboard has auth configured
- **THEN** the skill SHALL instruct the agent to include the auth token in requests

#### Scenario: Auth disabled (default)
- **WHEN** no auth is configured
- **THEN** the skill SHALL instruct the agent to make requests without auth headers

### Requirement: Helper script
The skill SHALL include a `scripts/dashboard-api.sh` bash script that wraps curl with auto port detection, optional auth, JSON formatting (with graceful jq fallback), and error handling.

#### Scenario: Helper script usage
- **WHEN** the agent runs `./scripts/dashboard-api.sh GET /api/sessions`
- **THEN** the script SHALL read the port from config, make the curl request, and format the JSON response

#### Scenario: Helper script without jq
- **WHEN** jq is not installed
- **THEN** the script SHALL output raw JSON without formatting

### Requirement: Complete API reference
The skill SHALL include a `references/api-reference.md` file documenting every REST API endpoint with method, path, parameters, request body, and response format.

#### Scenario: Agent reads API reference
- **WHEN** the agent loads `references/api-reference.md`
- **THEN** it SHALL find documentation for all monitoring, session control, git, config, and tunnel endpoints

### Requirement: Orchestration recipes
The skill SHALL include a `references/recipes.md` file with practical multi-step workflows combining multiple API calls.

#### Scenario: Spawn-and-prompt recipe
- **WHEN** the agent reads the spawn-and-prompt recipe
- **THEN** it SHALL find step-by-step instructions to spawn a session, poll for active status, send a prompt, and monitor completion

#### Scenario: Health check recipe
- **WHEN** the agent reads the health-check recipe
- **THEN** it SHALL find instructions to verify server health and list session statuses

#### Scenario: Batch operations recipe
- **WHEN** the agent reads the batch-operations recipe
- **THEN** it SHALL find patterns for iterating over sessions and performing bulk actions

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
