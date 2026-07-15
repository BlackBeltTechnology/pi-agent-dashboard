## ADDED Requirements

### Requirement: In-place enable/disable flip for a named automation

The system SHALL expose `POST /api/plugins/invoicebot/automation` accepting a
body `{ cwd, name, enabled }`. It SHALL read the existing on-disk
`<cwd>/.pi/automation/<name>/automation.yaml`, change ONLY the `disabled` field
to the negation of `enabled`, re-validate, and write the file back in place. The
client SHALL NOT supply any automation config; no field other than `disabled`
SHALL change.

#### Scenario: Enable a disabled automation

- **WHEN** an authenticated client posts `{ cwd, name: "invoicebot-intake", enabled: true }` and that automation exists on disk with `disabled: true`
- **THEN** the server rewrites `automation.yaml` with the `disabled` field cleared (or set false) and returns `{ ok: true, name: "invoicebot-intake", enabled: true }`

#### Scenario: Disable an enabled automation

- **WHEN** the client posts `{ cwd, name, enabled: false }` for an automation currently enabled
- **THEN** the server writes `disabled: true` in place and returns `{ ok: true, name, enabled: false }`

#### Scenario: Only the disabled field changes

- **WHEN** a flip is applied to an `automation.yaml` that carries a cron expression, model, action config, and an inline explanatory comment
- **THEN** every field other than `disabled` is byte-identical after the write and the inline comment is preserved

### Requirement: Reject unknown or missing automation

The flip route SHALL reject a request whose named automation does not exist in
the given scope, and SHALL NOT create an automation on enable.

#### Scenario: Named automation absent

- **WHEN** the client posts a flip for a `name` that has no `automation.yaml` under `<cwd>/.pi/automation/`
- **THEN** the server responds with a client error and creates no file

#### Scenario: Name escaping the automation directory

- **WHEN** the client posts a `name` containing path separators or `..`
- **THEN** the server rejects the request without touching the filesystem

### Requirement: Validate cwd

The flip and discovery routes SHALL validate `cwd` as a non-empty absolute path
that is an existing directory before any filesystem access.

#### Scenario: Missing or non-directory cwd

- **WHEN** a request arrives with `cwd` absent, empty, containing a NUL byte, or pointing at a non-existent path
- **THEN** the server responds with a client error and performs no read or write

### Requirement: Discovery list with per-automation state

The system SHALL expose `GET /api/plugins/invoicebot/automation?cwd=<repo>`
returning `{ automations: [{ name, enabled }] }` enumerating the invoicebot
schedule automations found under the workspace, each with its current enabled
state derived from the `disabled` field. The consuming client SHALL rely on this
list to render one operator switch and to enumerate flip targets rather than
hard-coding automation names.

#### Scenario: Two automations present

- **WHEN** both `invoicebot-intake` (disabled) and `invoicebot-pull` (enabled) exist under `<cwd>/.pi/automation/`
- **THEN** the response lists both with `enabled: false` and `enabled: true` respectively

#### Scenario: Drop-folder-only install

- **WHEN** only `invoicebot-intake` exists (no connector, so no `invoicebot-pull`)
- **THEN** the response lists exactly the one automation and its state

### Requirement: Flip takes effect live without reload

A `disabled` flip written by this route SHALL be honored by the running
scheduler without a server restart or reload, via the existing filesystem
watcher that re-scans and re-arms on `automation.yaml` changes.

#### Scenario: Scheduler re-arms after enable

- **WHEN** a previously disabled automation is enabled through the flip route
- **THEN** within the watcher debounce window the scheduler arms that automation's trigger, and disabling it again disarms the trigger — with no reload
