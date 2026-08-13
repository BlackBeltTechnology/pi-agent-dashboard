## ADDED Requirements

### Requirement: Config editor settings section
The system SHALL provide a `settings-section` claim that reads and writes a project's `set-copilot.config.json` via a dedicated server REST route, distinct from the dashboard's own plugin-config store.

#### Scenario: User views existing config
- **WHEN** the user opens the voice-assistant settings section for a folder with an existing `set-copilot.config.json`
- **THEN** the editor shows its current fields (language, sttBackend, knowledge sources, copilot alerts) populated from the file on disk

#### Scenario: User saves an edit
- **WHEN** the user changes a field and saves
- **THEN** the server writes the updated JSON to `set-copilot.config.json` at the folder root, preserving fields the editor does not expose, so that the vendored library modules (`loadConfig` and its consumers) continue to read the same file unmodified

#### Scenario: No config file present
- **WHEN** the user opens the settings section for a folder with no `set-copilot.config.json`
- **THEN** the editor offers to create one with defaults rather than erroring

### Requirement: Folder is chosen explicitly, never inferred from an active session
The `settings-section` slot receives only `{ pluginContext }` — it is given no session and no folder. The system SHALL therefore require the folder to be selected explicitly in the editor (from the dashboard's known folders), and SHALL NOT resolve the target folder from "the active session" or any ambient session state.

#### Scenario: Folder selection is explicit
- **WHEN** the user opens the voice-assistant settings section
- **THEN** the editor presents a folder selector and edits nothing until a folder is chosen

#### Scenario: No session is required
- **WHEN** the user opens the settings section with no pi session running anywhere
- **THEN** the editor still functions for any known folder

### Requirement: Server REST route for config
The system SHALL expose `GET /api/plugins/voice-assistant/config` and `PUT /api/plugins/voice-assistant/config`, each taking an explicit folder parameter, and SHALL reject any folder that is not in the dashboard's known-folder allow-list (the same admission rule `kb-plugin` applies via `isAllowedCwd`).

#### Scenario: Read returns current file contents
- **WHEN** a `GET` request is made for an allowed folder with a config file
- **THEN** the response body is the parsed JSON contents of that folder's `set-copilot.config.json`

#### Scenario: Write is contained to the target folder
- **WHEN** a `PUT` request is made for an allowed folder
- **THEN** the server writes only to `set-copilot.config.json` at that folder's root, and a path that resolves outside it (via traversal, symlink, or absolute override) is rejected rather than followed

#### Scenario: Unknown folder is rejected
- **WHEN** a request names a folder that is not in the known-folder allow-list
- **THEN** the request is rejected without reading or writing any file

#### Scenario: Routes are authenticated
- **WHEN** an unauthenticated request reaches either route
- **THEN** it is rejected by the same request-authentication guard the dashboard's other plugin REST routes use, because the config contains a speech-to-text API credential

### Requirement: The STT credential is never returned to the client in full
The config may contain a Soniox API key. The system SHALL NOT return that secret in readable form to the browser.

#### Scenario: Secret is masked on read
- **WHEN** a `GET` returns a config whose `sttApiKey` (or equivalent) is set
- **THEN** the value is masked in the response, and the editor shows it as set-but-hidden

#### Scenario: Unchanged secret round-trips without exposure
- **WHEN** the user saves the form without altering the masked credential field
- **THEN** the server preserves the existing on-disk secret rather than writing back the mask
