# oauth-callback-server Specification

## Purpose

Handles OAuth redirects for the dashboard by running a temporary local callback server. Requires auth-code handlers to declare their registered redirect URI, opens the system browser from the authorize endpoint, and lets the browser client detect completion — replacing the removed popup relay mechanism.

## Requirements

### Requirement: Temporary callback server for OAuth redirects
The system SHALL start a temporary HTTP server on the provider's registered callback port when an auth-code OAuth flow is initiated. The server SHALL receive the authorization code, exchange it for tokens, save credentials, and shut down.

#### Scenario: Successful OAuth callback and token exchange
- **WHEN** an auth-code flow is started for a provider with `callbackPort` and `callbackPath`
- **THEN** a temporary HTTP server starts on `callbackPort`
- **AND** when the OAuth provider redirects to `callbackPath` with a `code` parameter
- **AND** the server exchanges the code for tokens, saves the credential
- **AND** the server responds with a success HTML page
- **AND** the server shuts down

#### Scenario: OAuth callback with error
- **WHEN** the OAuth provider redirects to `callbackPath` with an `error` parameter
- **THEN** the server responds with an error HTML page showing the error description
- **AND** the server shuts down

#### Scenario: Timeout without callback
- **WHEN** the temporary callback server is started
- **AND** no callback is received within 5 minutes
- **THEN** the server shuts down and releases the port

#### Scenario: Port already in use
- **WHEN** the temporary callback server attempts to start
- **AND** the registered port is already in use
- **THEN** the system SHALL return an error indicating the port is occupied

#### Scenario: Concurrent flow for same provider
- **WHEN** a new auth flow is started for a provider
- **AND** a temporary callback server is already running for that provider
- **THEN** the existing server SHALL be closed before starting a new one

### Requirement: Auth-code handlers declare registered redirect URI
Each auth-code handler SHALL declare `callbackPort` (number) and `callbackPath` (string) matching the redirect URI registered with the OAuth provider.

#### Scenario: Handler provides callback metadata
- **WHEN** an `AuthCodeHandler` is defined
- **THEN** it SHALL include `callbackPort` and `callbackPath` fields
- **AND** the constructed URI `http://localhost:{callbackPort}{callbackPath}` SHALL match the provider's registered redirect URI

### Requirement: Authorize endpoint opens system browser
The `/api/provider-auth/authorize` endpoint SHALL open the authorization URL in the system's default browser and start the temp callback server.

#### Scenario: System browser opened for Anthropic
- **WHEN** a user initiates OAuth login for Anthropic
- **THEN** the auth URL SHALL contain `redirect_uri=http://localhost:53692/callback`
- **AND** the system's default browser SHALL open with the auth URL

#### Scenario: System browser opened for OpenAI Codex
- **WHEN** a user initiates OAuth login for OpenAI Codex
- **THEN** the auth URL SHALL contain `redirect_uri=http://localhost:1455/auth/callback`

#### Scenario: System browser opened for Gemini CLI
- **WHEN** a user initiates OAuth login for Gemini CLI
- **THEN** the auth URL SHALL contain `redirect_uri=http://localhost:8085/oauth2callback`

#### Scenario: System browser opened for Antigravity
- **WHEN** a user initiates OAuth login for Antigravity
- **THEN** the auth URL SHALL contain `redirect_uri=http://localhost:51121/oauth-callback`

### Requirement: Browser client detects auth completion
The dashboard client SHALL detect when an OAuth flow completes so the UI can refresh auth status.

#### Scenario: Browser detects auth completion via polling
- **WHEN** the user initiates an OAuth login
- **THEN** the client SHALL poll `GET /api/provider-auth/status` every 2 seconds
- **AND** when the provider shows as authenticated, the client SHALL stop polling and refresh the display

### Requirement: Popup relay mechanism removed
The `callbackHtml` popup relay using `postMessage`/`BroadcastChannel`/`localStorage` SHALL be replaced with simple success/error HTML served by the temp callback server.

#### Scenario: Success page shown in system browser
- **WHEN** the OAuth callback succeeds
- **THEN** the system browser tab shows a success message indicating the user can close the tab
