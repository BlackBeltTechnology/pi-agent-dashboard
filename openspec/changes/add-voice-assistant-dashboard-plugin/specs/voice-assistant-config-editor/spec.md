## ADDED Requirements

### Requirement: Project config editor lives in folder settings
The system SHALL provide a `folder-settings-section` claim (label "Voice assistant") that reads and writes the folder's `set-copilot.config.json` via a dedicated server REST route, distinct from the dashboard's own plugin-config store. The folder is the route's `cwd`; the editor SHALL NOT offer a folder selector and SHALL NOT infer a folder from any active session.

#### Scenario: User views existing config
- **WHEN** the user opens Folder settings › Plugins › Voice assistant for a folder with an existing `set-copilot.config.json`
- **THEN** the editor shows its current fields (language, sttBackend, knowledge sources, copilot alerts) populated from the file on disk

#### Scenario: User saves an edit
- **WHEN** the user changes a field and saves
- **THEN** the server writes the updated JSON to `set-copilot.config.json` at the folder root, migrated to the current upstream schema version via vendored `config-migrate`, preserving fields the editor does not expose

#### Scenario: No config file present
- **WHEN** the user opens the folder section for a folder with no `set-copilot.config.json`
- **THEN** the editor offers to create one with defaults rather than erroring

#### Scenario: No session is required
- **WHEN** the user opens the folder section with no pi session running anywhere
- **THEN** the editor still functions for that folder

### Requirement: Global settings section holds host-wide settings only
The plugin's `settings-section` claim (`/settings/plugins/voice-assistant`) SHALL show only host-wide settings: the global model defaults, STT key source/status, and voiceprint library status. It SHALL NOT edit any project's `set-copilot.config.json`, and SHALL link to folder settings for per-project configuration.

#### Scenario: Global section has no project fields
- **WHEN** the user opens Settings › Plugins › Voice assistant
- **THEN** no project config fields or folder selector are shown, and a note points to Folder settings › Plugins › Voice assistant

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
- **THEN** it is rejected by the same request-authentication guard the dashboard's other plugin REST routes use, because these routes write project files and manage a speech-to-text credential

### Requirement: The STT credential lives in the plugin credential store
The system SHALL store the Soniox API key in the plugin's own credential store (`ctx.credentials`, key `soniox`), SHALL NOT write it into `set-copilot.config.json`, and SHALL NOT return it in readable form to the browser. When the host provides no credential store, the editor SHALL say that the key is read from the user's `.env` as upstream does.

#### Scenario: Key is not written to the project
- **WHEN** the user saves a Soniox key in the editor
- **THEN** it is stored in the plugin credential store and `set-copilot.config.json` contains no key

#### Scenario: Secret is masked on read
- **WHEN** a `GET` is made for a folder while a Soniox key is stored
- **THEN** the response reports only that a key is set, never its value, and the editor shows it as set-but-hidden

#### Scenario: Unchanged secret round-trips without exposure
- **WHEN** the user saves the form without altering the masked credential field
- **THEN** the stored credential is left unchanged rather than overwritten with the mask

### Requirement: Model selection — global default with per-folder override
The system SHALL let the user pick the **copilot model** and the **transcriber model** with the `ui:model-selector` primitive (fed by `GET /api/models`), never free-text fields. The global defaults (`transcriberModel`, `copilotModel` in the plugin's `configSchema.json`) SHALL be edited in the global `settings-section`. The per-folder override (`folderModels[<cwd>].{copilotModel,transcriberModel}`) SHALL be edited in the folder's `folder-settings-section`. Both are stored in the dashboard plugin-config store and NOT in `set-copilot.config.json`, because model refs name providers local to this dashboard host. At spawn the system SHALL resolve each role's model as folder override → global default → pi's default model (no `model` passed).

#### Scenario: Global defaults in global settings
- **WHEN** the user opens Settings › Plugins › Voice assistant
- **THEN** two model pickers labelled copilot and transcriber show the current global defaults, and an unset default reads "pi default"

#### Scenario: Folder override inherits by default
- **WHEN** the user opens Folder settings › Plugins › Voice assistant for a folder with no override for a role
- **THEN** that role's picker shows "inherit global (<resolved ref>)" and saving leaves no override entry for it

#### Scenario: Override wins at spawn
- **WHEN** a meeting starts in a folder whose `folderModels` sets `copilotModel`
- **THEN** the copilot is spawned with the override, and the transcriber, without an override, is spawned with the global `transcriberModel`

#### Scenario: Clearing an override falls back
- **WHEN** the user resets a folder's override to "inherit global" and saves
- **THEN** the role's `folderModels` entry is removed and the next spawn uses the global default

#### Scenario: Override write is folder-gated
- **WHEN** an override is saved for a folder not in the known-folder allow-list
- **THEN** the write is rejected, as for the config routes

#### Scenario: Unavailable model is caught at preflight
- **WHEN** the resolved model ref for either role is not in the dashboard's model registry
- **THEN** preflight blocks the start (or dictation) and names the role, the ref, and whether it came from the folder override or the global default
