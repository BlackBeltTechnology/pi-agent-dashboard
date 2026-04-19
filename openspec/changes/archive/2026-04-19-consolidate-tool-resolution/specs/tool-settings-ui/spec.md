## ADDED Requirements

### Requirement: REST endpoints for tool registry
The server SHALL expose a `/api/tools` REST surface backed by the `ToolRegistry`. Endpoints SHALL enforce the same auth guard as `/api/config`.

#### Scenario: List all tools
- **WHEN** a client sends `GET /api/tools`
- **THEN** the server SHALL return `{ success: true, data: { tools: Resolution[] } }` containing one entry per registered tool

#### Scenario: Get single tool
- **WHEN** a client sends `GET /api/tools/:name` for a registered tool
- **THEN** the server SHALL return `{ success: true, data: Resolution }` for that tool
- **AND** SHALL return 404 for an unregistered name

#### Scenario: Rescan all tools
- **WHEN** a client sends `POST /api/tools/rescan` with an empty body
- **THEN** the server SHALL call `registry.rescan()` with no argument
- **AND** SHALL return the refreshed `{ tools: Resolution[] }` list

#### Scenario: Rescan a single tool
- **WHEN** a client sends `POST /api/tools/rescan` with body `{ "name": "pi" }`
- **THEN** the server SHALL invalidate only that tool's cached Resolution and return the refreshed list

#### Scenario: Set override
- **WHEN** a client sends `PUT /api/tools/:name` with body `{ "path": "C:\\custom\\pi.cmd" }`
- **THEN** the server SHALL call `registry.setOverride(name, path)`
- **AND** SHALL return the refreshed Resolution for that tool

#### Scenario: Clear override
- **WHEN** a client sends `DELETE /api/tools/:name`
- **THEN** the server SHALL call `registry.clearOverride(name)`
- **AND** SHALL return the refreshed Resolution for that tool

#### Scenario: Export diagnostics
- **WHEN** a client sends `POST /api/tools/diagnostics`
- **THEN** the server SHALL return a plain-text body (`Content-Type: text/plain`) listing every tool, its resolved path, source, and full `tried[]` trail formatted one line per attempt

#### Scenario: Endpoints require auth
- **WHEN** an unauthenticated remote client sends any `/api/tools*` request
- **THEN** the server SHALL respond with 401 under the same policy that protects `/api/config`

### Requirement: Tools section in Settings panel
`SettingsPanel` SHALL include a **Tools** section within the **General** tab. The section SHALL render one row per registered tool showing name, status badge (`ok` / `invalid-override` / `missing`), source, and truncated path. A top-level row SHALL expose **Rescan all**, **Reset overrides**, and **Export diagnostics** buttons.

#### Scenario: Tools section renders on panel open
- **WHEN** the user opens `/settings`
- **THEN** the General tab SHALL include a Tools section populated from `GET /api/tools`

#### Scenario: Row shows status and source
- **WHEN** a tool's Resolution has `ok: true, source: "managed"`
- **THEN** the row SHALL show a ✓ badge and the label "managed"

#### Scenario: Row shows missing state
- **WHEN** a tool's Resolution has `ok: false`
- **THEN** the row SHALL show a ✗ badge and the text "not found"
- **AND** clicking the row SHALL expand to show every entry in `tried[]` with its reason

#### Scenario: Per-row rescan
- **WHEN** the user clicks the **Rescan** control on a single tool row
- **THEN** the client SHALL call `POST /api/tools/rescan` with `{ name }`
- **AND** SHALL refresh that row with the returned Resolution without reloading the page

#### Scenario: Setting an override via UI
- **WHEN** the user enters a path in the row's override input and submits
- **THEN** the client SHALL call `PUT /api/tools/:name` with `{ path }`
- **AND** SHALL refresh the row
- **AND** the new source SHALL be `"override"` when the path validates, or show an "invalid override" warning when it does not

#### Scenario: Reset overrides
- **WHEN** the user clicks **Reset overrides** and confirms
- **THEN** the client SHALL call `DELETE /api/tools/:name` for every tool with an active override
- **AND** SHALL rescan all and refresh the Tools section

#### Scenario: Export diagnostics
- **WHEN** the user clicks **Export diagnostics**
- **THEN** the client SHALL fetch `POST /api/tools/diagnostics` and trigger a browser download of the returned text as `pi-dashboard-tools.txt`
