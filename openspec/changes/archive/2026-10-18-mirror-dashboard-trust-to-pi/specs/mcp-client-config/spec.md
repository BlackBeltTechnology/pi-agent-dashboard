## MODIFIED Requirements

### Requirement: Effective configuration follows pi's built-in MCP rules

The plugin SHALL compute the effective MCP configuration for a directory from exactly two layers: the Pi-global `~/.pi/agent/mcp.json` (honouring `PI_CODING_AGENT_DIR`) and, only when pi trusts the project, `<cwd>/.pi/mcp.json`. Project trust SHALL come from an injected boolean trust predicate that applies the `pi-trust-mirror` folder decision, resolving pi's agent directory as pi does (honouring `PI_CODING_AGENT_DIR`); an optional injected accessor SHALL report the source of the decision, and the effective view SHALL expose that source additively (absent accessor → source omitted). Without a predicate, every project SHALL count as untrusted, and a predicate that cannot be built at boot SHALL be logged rather than silently degrade to untrusted. A project entry for which `command`, `url` or `type` is not `undefined` SHALL replace the global entry of the same name as a whole. A project entry for which all three are `undefined` is a **project override**, as in pi ≥ 1.0.1. Its base SHALL be the global entry of the same name only when pi keeps that entry — valid and not dropped as a name collision; with no such base the override SHALL be reported as a folder row with pi's message `needs "command" or "url", or a global server to override`. An override with a key other than `enabled`, `exposure` and `toolExposure` SHALL be reported as a folder row with pi's message `an override can only set enabled, exposure, toolExposure`. Otherwise its effect SHALL be the base with those keys replaced (`{ ...base, ...override }`), validated with pi's entry rules (a failure reported as a folder row with pi's message), and it SHALL be exempt from the namespace-collision and project-`auth` checks, because the merged entry inherits the global one. A valid override SHALL be reported as the global server's single row carrying the merged entry (redacted like any global row in a project view) and the override's path and keys. Whenever an override is reported as a folder row, the global entry SHALL stay in effect unchanged. Connection state and tool counts SHALL come from pi (`pi mcp list --json`) rather than being re-implemented; it SHALL run with a 30-second timeout and its result SHALL be cached per cwd for 30 seconds; its stdout SHALL be parsed whatever its exit code, and state SHALL be reported unknown only when the command cannot run, times out, or prints unparseable output; for a project trusted only through dashboard trust, project-layer servers SHALL instead be reported with live state "not checked by pi", because that command reads only pi's own trust store and accepts no approve flag. Each layer SHALL be parsed as strict JSON, as pi parses it; a layer that fails to parse SHALL be reported per layer, as skipped by pi, without hiding the other layer. Entry keys pi ignores (adapter-only keys such as `disabled`, `directTools`, `lifecycle`) SHALL be reported as ignored by pi.

#### Scenario: Non-zero exit still yields state
- **WHEN** `pi mcp list --json` exits `1` because one server is not connected and prints valid JSON
- **THEN** every server SHALL show pi's reported state, the disconnected one included

#### Scenario: Adapter disabled key is flagged
- **WHEN** a global entry carries `disabled: true` and no `enabled` key
- **THEN** the view SHALL report the entry as enabled under pi with `disabled` ignored, and offer converting it to `enabled: false`

#### Scenario: Project entry replaces global
- **WHEN** both layers define `docs` with a `url` or `command` and the project is trusted
- **THEN** the effective `docs` entry SHALL be exactly the project entry, with no fields inherited from the global entry

#### Scenario: Untrusted project layer is inactive
- **WHEN** `<cwd>/.pi/mcp.json` exists but pi does not trust the project
- **THEN** its servers SHALL be reported as inactive with the reason "project not trusted"

#### Scenario: Project override merges onto the global entry
- **WHEN** the global `docs` entry has a URL and an `Authorization` header and the trusted project has `"docs": { "enabled": false }`
- **THEN** the effective view SHALL show one `docs` row with provenance Pi global, `enabled: false`, the global URL and the header redacted, and a project-override marker naming `enabled`

#### Scenario: Override without a global server
- **WHEN** the trusted project has `"ghost": { "enabled": false }` and no global `ghost` exists
- **THEN** a folder row `ghost` SHALL be reported inactive with pi's message `needs "command" or "url", or a global server to override`

#### Scenario: Override of an invalid global entry
- **WHEN** the global `docs` entry is invalid under pi's rules (for example `exposure: "bogus"`) and the trusted project has `"docs": { "exposure": "direct" }`
- **THEN** the folder row `docs` SHALL be reported inactive with pi's message `needs "command" or "url", or a global server to override`
- **AND** no `docs` row SHALL be reported active

#### Scenario: Override with a non-override key
- **WHEN** the trusted project has `"docs": { "enabled": false, "timeout": 5 }` and no `command`, `url` or `type`
- **THEN** a folder row `docs` SHALL be reported inactive with pi's message `an override can only set enabled, exposure, toolExposure`
- **AND** the global `docs` row SHALL stay in effect unchanged

#### Scenario: A null transport key is not an override
- **WHEN** the trusted project has `"docs": { "url": null, "enabled": false }`
- **THEN** the entry SHALL be treated as a whole-entry replace and reported with pi's validation message

#### Scenario: Override in an untrusted project
- **WHEN** `<cwd>/.pi/mcp.json` has `"docs": { "enabled": false }` and pi does not trust the project
- **THEN** the global `docs` row SHALL stay enabled and the override SHALL be reported as an inactive folder row with the reason "project not trusted"

#### Scenario: Dashboard-trusted project layer is active
- **WHEN** `<cwd>/.pi/mcp.json` exists, `trust.json` records nothing for `<cwd>`, and dashboard trust covers `<cwd>`
- **THEN** its servers SHALL be reported active and the view SHALL carry the dashboard source as the trust source

#### Scenario: Unbuildable predicate is logged
- **WHEN** pi's trust classes cannot be resolved at server boot
- **THEN** the server SHALL log that every project reads untrusted, once

#### Scenario: Live state for a dashboard-trusted folder
- **WHEN** the project is trusted only through dashboard trust and its view is requested
- **THEN** the project servers SHALL be reported active with live state "not checked by pi", not as disconnected
- **AND** running `pi mcp list` in that folder outside the dashboard still reports them as not loaded, which the view SHALL state
