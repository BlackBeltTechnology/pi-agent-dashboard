## REMOVED Requirements

### Requirement: API key detection and persistence
**Reason**: The settings.json writer (`writeApiKey`) has no callers, and pi reads credentials from `~/.pi/agent/auth.json`, so persisting keys into settings.json is dead behaviour that leaves plain-text secrets behind. Detection is kept under "API key detection".
**Migration**: Store credentials through Settings → Providers (`auth.json`). Existing settings.json keys can be moved or removed from Settings → pi settings (capability `pi-settings-legacy-credentials`).

## ADDED Requirements

### Requirement: API key detection

The system SHALL detect whether any pi provider credential is configured. It SHALL NOT write provider API keys into pi's settings file at `~/.pi/agent/settings.json`.

#### Scenario: Detect a configured provider credential

- **WHEN** API-key configuration is checked
- **THEN** detection is delegated to the shared provider-credential detector, which inspects both `~/.pi/agent/settings.json` and `~/.pi/agent/auth.json`
- **AND** the result is true when any provider credential is present

#### Scenario: No settings.json credential writer exists

- **WHEN** the Electron main process is searched for code that writes `anthropicApiKey`, `openaiApiKey`, or `providers.<name>.apiKey` into `~/.pi/agent/settings.json`
- **THEN** no such writer exists
