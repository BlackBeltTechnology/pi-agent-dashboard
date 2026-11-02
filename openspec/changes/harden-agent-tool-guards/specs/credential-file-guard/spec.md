## MODIFIED Requirements

### Requirement: Protected credential paths
The protected paths SHALL be:
- `<home>/.pi/agent/plugin-credentials.json`;
- `<PI_CODING_AGENT_DIR>/plugin-credentials.json` when that variable is set;
- in each of those two agent directories, `auth.json`, `mcp-auth.json`, `providers.json` and `system-one/auth.json`;
- `<home>/.pi/dashboard/vault.json`;
- the file named by `PI_DASHBOARD_DATA_KEY_FILE` when that variable is set in the pi process;
- every sibling whose name starts with one of those file names followed by `.`.

The two agent directories come from the home directory and `PI_CODING_AGENT_DIR` as written. An agent directory pi reports that differs from both (for example a `~`-prefixed override that pi expands) is not covered; recorded residual.

#### Scenario: Corrupt backup sibling protected
- **WHEN** the agent reads `~/.pi/dashboard/vault.json.corrupt-20260101T000000Z`
- **THEN** the call is blocked

#### Scenario: Provider credential file of the agent directory blocked
- **WHEN** the agent calls `read` on `~/.pi/agent/auth.json`, `~/.pi/agent/mcp-auth.json`, `~/.pi/agent/providers.json` or `~/.pi/agent/system-one/auth.json`
- **THEN** the call is blocked with reason prefix `credential_guard`

#### Scenario: Agent-directory override is protected too
- **GIVEN** `PI_CODING_AGENT_DIR` is `/srv/pi-agent` in the pi process
- **WHEN** the agent calls `read` on `/srv/pi-agent/auth.json`
- **THEN** the call is blocked

#### Scenario: Backup copy of a provider credential file blocked
- **WHEN** the agent reads `~/.pi/agent/auth.json.bak`
- **THEN** the call is blocked

#### Scenario: Non-secret agent files are not protected here
- **WHEN** the agent reads `~/.pi/agent/settings.json`, `~/.pi/agent/models.json` or `~/.pi/agent/mcp.json`
- **THEN** the credential guard does not block the call

### Requirement: Tool input naming credential files is blocked
The guard SHALL block a tool call when a scanned string value of its input contains, case-insensitively, a path-like reference to a protected path: `.pi/agent/<name>` for `plugin-credentials.json`, `auth.json`, `mcp-auth.json` or `providers.json`, `.pi/agent/system-one/auth.json`, or `.pi/dashboard/vault.json` (either separator, sibling suffixes included), or the full path of another protected path. A bare file name SHALL NOT match.

#### Scenario: cat of the vault blocked
- **WHEN** the agent runs `bash` with `cat ~/.pi/dashboard/vault.json`
- **THEN** the call is blocked

#### Scenario: Ordinary command allowed
- **WHEN** the agent runs `bash` with `ls ~/.pi/agent`
- **THEN** the credential guard does not block the call

#### Scenario: Bare file name in a repository search allowed
- **WHEN** the agent runs `bash` with `rg plugin-credentials.json docs/`
- **THEN** the credential guard does not block the call

#### Scenario: Extension tool path blocked
- **WHEN** the agent calls an MCP tool `ctx_execute_file` with `path` `/home/u/.pi/dashboard/vault.json`
- **THEN** the call is blocked

#### Scenario: cat of the provider credentials blocked
- **WHEN** the agent runs `bash` with `cat ~/.pi/agent/auth.json | head`
- **THEN** the call is blocked

#### Scenario: Bare provider file name in a repository search allowed
- **WHEN** the agent runs `bash` with `rg auth.json packages/`
- **THEN** the credential guard does not block the call

#### Scenario: Glob naming a protected absolute path blocked
- **WHEN** the agent calls `grep` with `path` `/w/repo` and `glob` `/home/u/.pi/agent/plugin-credentials.json`
- **THEN** the call is blocked

