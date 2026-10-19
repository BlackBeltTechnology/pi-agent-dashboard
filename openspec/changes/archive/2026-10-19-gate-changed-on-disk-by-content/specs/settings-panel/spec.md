## ADDED Requirements

### Requirement: Settings panel exposes the editor large-file limit

The settings panel SHALL expose an **Editor large-file limit (MB)** numeric field on the
General page, bound to the dashboard config field `editor.largeFileLimitMb`. The field
SHALL show `10` when the config omits it. The field SHALL accept only an integer in
`1`–`256`; an out-of-range or non-integer entry SHALL be flagged inline and SHALL block
Save until corrected. As a backstop, the config parser SHALL round a finite number in
the config file to the nearest integer and clamp it to `1`–`256`, and SHALL fall back
to `10` for any other value (string, `null`, `NaN`, missing). The field SHALL save through the existing config write endpoint and
Save Bar, with its dirty state attributed to the General page. `GET /api/config` SHALL
return the resolved value. A successful write SHALL broadcast a config update for the
`editor` section, SHALL NOT require a restart, and connected clients SHALL use the new
value for editor tabs opened or refreshed afterwards without a page reload. The setting
governs only the editor pane's rich-viewer too-large gate; it SHALL NOT change the
server's office conversion size caps or the digest ceiling.

#### Scenario: Default is shown when the field is absent
- **GIVEN** the dashboard config has no `editor` block
- **WHEN** the user opens the settings panel
- **THEN** the Editor large-file limit field shows `10`

#### Scenario: Out-of-range entry is refused at entry
- **WHEN** the user types `5000` into the Editor large-file limit field
- **THEN** the field is flagged invalid and Save is blocked

#### Scenario: Out-of-range config value is clamped
- **GIVEN** the config file sets `editor.largeFileLimitMb` to `5000`
- **WHEN** the server loads the config
- **THEN** `GET /api/config` reports `editor.largeFileLimitMb` as `256`

#### Scenario: Non-numeric config value falls back to the default
- **GIVEN** the config file sets `editor.largeFileLimitMb` to `"64"`
- **WHEN** the server loads the config
- **THEN** `GET /api/config` reports `editor.largeFileLimitMb` as `10`

#### Scenario: Edit marks the General page dirty
- **WHEN** the user changes the Editor large-file limit field
- **THEN** the Save Bar shows unsaved changes attributed to the General page

#### Scenario: Saved value applies live
- **GIVEN** the Editor large-file limit is `10`
- **WHEN** the user sets it to `64` and saves
- **THEN** the config file stores `editor.largeFileLimitMb: 64`
- **AND** the save reports no restart required
- **AND** a connected client opening a 30 MiB markdown file afterwards renders it richly without a page reload or server restart

#### Scenario: Office caps are unaffected
- **GIVEN** the Editor large-file limit is `256`
- **WHEN** a 60 MiB `.docx` is opened in the pane
- **THEN** the server still refuses the conversion with its office size cap (413)
- **AND** the pane shows the too-large fallback naming the office cap
