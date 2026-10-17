## MODIFIED Requirements

### Requirement: Folder MCP page follows pi's project rules

The folder page at `/folder/:encodedCwd/mcp` SHALL list the effective servers for that cwd with provenance **Pi global** or **Pi folder**, marking folder entries that replace a global one and marking global servers carrying a project override with the overridden setting in text (for example "Off in this folder"), never by colour alone. Rows reporting an orphaned or invalid project override SHALL show pi's message with a "Remove" action and SHALL NOT be counted as servers by the folder pill, because pi loads nothing for them. The page SHALL state who trusts the folder, as decided by the `pi-trust-mirror` decision order: pi's trust store (naming the recorded path), the dashboard (naming the source and its folder, and — when `coverInteractive` is false — that this applies to dashboard sessions, not terminal pi), or neither. The page reports the folder's decision and SHALL NOT claim to reflect a particular session's command-line override. When neither trusts the project, the page SHALL state that folder servers are inactive until the project is trusted, except in dashboard-spawned headless sessions started in that folder (which the bridge trusts per run), SHALL link to Settings → Access, and SHALL still allow editing `<cwd>/.pi/mcp.json`.

#### Scenario: Untrusted folder
- **WHEN** the folder has `.pi/mcp.json` and the project is not trusted
- **THEN** the page SHALL show its servers as inactive with the reason "project not trusted"

#### Scenario: Overridden global server is marked
- **WHEN** the trusted folder overrides global `docs` with `{ "enabled": false }`
- **THEN** the page SHALL show one `docs` row, badged Pi global, switched off, with the text "Off in this folder" and a "Reset to global" action

#### Scenario: Orphaned override is not counted
- **WHEN** the trusted folder has `"ghost": { "enabled": false }`, no global `ghost` exists, and 2 other servers are effective
- **THEN** the folder pill SHALL read "2 servers" with no off count contributed by `ghost`
- **AND** the page SHALL show the `ghost` row with pi's message and a "Remove" action, and its switch SHALL be unavailable

#### Scenario: Removing an orphaned override can be undone
- **WHEN** the operator removes the `ghost` override row and then undoes
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain the identical `ghost` override again

#### Scenario: Folder trusted by the dashboard names its source
- **WHEN** `/Users/me/Documents` is pinned, `trust.json` records nothing for it, and the folder page opens
- **THEN** the page SHALL state that the folder is trusted by the dashboard through the pinned folder `/Users/me/Documents`
- **AND** no "not trusted" notice SHALL be shown

#### Scenario: Folder trusted by pi names the recorded path
- **WHEN** `trust.json` records `/Users/me/Project: true` and the folder page for `/Users/me/Project/app` opens
- **THEN** the page SHALL state that pi trusts the folder through `/Users/me/Project`
