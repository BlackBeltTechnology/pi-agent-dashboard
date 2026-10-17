## ADDED Requirements

### Requirement: This-computer block in the browser settings section

When the dashboard runs in an Electron main window that exposes `window.piDashboard.browserHost`, the browser settings section SHALL show a "This computer" block listing that machine's Chrome profiles with `installed`, a write-only pairing-token input per profile that calls `setToken` and never renders a stored token, and the stored operator consents with a Revoke action each. Outside Electron, or when `browserHost` is absent, the block SHALL NOT render. The block SHALL send no token to the server. Tokens set here apply only to that machine's profiles; the dashboard-host profile rows and their server-side token, `Zero-dialog` toggle, `allowedDomains` editor and `canOpenChrome:false` notice SHALL be unchanged and SHALL NOT list operator profiles.

#### Scenario: Plain browser
- **WHEN** the settings section renders in a browser without `window.piDashboard.browserHost`
- **THEN** no "This computer" block SHALL be rendered

#### Scenario: Token saved locally
- **WHEN** the user pastes a token for profile P in the block and saves
- **THEN** `setToken(P, token)` SHALL be called, the input SHALL clear, and no HTTP request or WS message SHALL carry the token

#### Scenario: Revoke a consent
- **WHEN** the user activates Revoke on a stored consent
- **THEN** `revokeConsent(key)` SHALL be called and the consent SHALL disappear from the list
