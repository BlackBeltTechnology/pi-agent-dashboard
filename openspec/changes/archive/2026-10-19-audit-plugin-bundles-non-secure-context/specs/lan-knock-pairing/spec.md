## MODIFIED Requirements

### Requirement: Dashboard works from a non-secure LAN origin
After a knock pairs a browser on a plain-http LAN origin, the dashboard client SHALL work in that non-secure browser context: no code in the dashboard client (`packages/client`), its shared client utilities (`packages/client-utils`), the plugin runtime's browser surface (`packages/dashboard-plugin-runtime`, excluding its Node-only `server`, `bridge` and `vite-plugin` entries and its `test-support` helpers), or any plugin client bundle loaded into the dashboard SPA (the directory of every plugin manifest's client entry, excluding that plugin's server and bridge entries, and every `packages/*/src/client` tree) SHALL call a secure-context-only API (`crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `navigator.mediaDevices`) without a capability check, plus a fallback where one exists (a UUIDv4 built from `crypto.getRandomValues`, which works in non-secure contexts, so request ids stay UUIDv4 as `spawn-correlation` requires; a manual-copy fallback for clipboard that still uses `navigator.clipboard.writeText` when it exists). A plugin Copy action SHALL report the real outcome: it SHALL NOT show a "Copied" confirmation when neither copy path succeeded. Features that inherently require a secure context (DPoP proof keys on the identity plane; camera, microphone, or screen capture via `navigator.mediaDevices`) SHALL check for the API and report themselves unavailable instead of throwing. Bundles that never load into the dashboard SPA (the standalone pairing shell, headless bus clients, standalone deck runtimes) are out of scope for this requirement.

#### Scenario: Resume from Settings on an http LAN origin
- **GIVEN** a browser paired by knock on `http://192.168.16.204:8000`, where `crypto.randomUUID` is undefined
- **WHEN** the user resumes a session from Settings
- **THEN** the request SHALL be sent with a UUIDv4 `requestId` and no error SHALL be thrown

#### Scenario: Copy without the clipboard API
- **GIVEN** `navigator.clipboard` is undefined
- **WHEN** the user activates a Copy action
- **THEN** the client SHALL fall back without throwing and SHALL tell the user the text could not be copied automatically

#### Scenario: Plugin Copy action without the clipboard API
- **GIVEN** `navigator.clipboard` is undefined and the manual-copy fallback fails
- **WHEN** the user activates a Copy action inside a plugin client surface (for example the kb test-search result list or the Gmail settings setup steps)
- **THEN** the plugin SHALL NOT throw and SHALL NOT show a "Copied" confirmation

#### Scenario: Plugin Copy action falls back in a non-secure context
- **GIVEN** `navigator.clipboard` is undefined and the manual-copy fallback succeeds
- **WHEN** the user activates a Copy action inside a plugin client surface
- **THEN** the text SHALL be copied via the fallback and the plugin SHALL report success

#### Scenario: Rapid plugin copies resolve out of order
- **GIVEN** the user activates Copy on item A and then on item B, and A's copy settles after B's
- **WHEN** both copies settle
- **THEN** the plugin's copy indicator SHALL reflect only B's outcome, and A's late result SHALL NOT change it

#### Scenario: Media capture on an http LAN origin
- **GIVEN** a browser on a plain-http LAN origin where `navigator.mediaDevices` is undefined
- **WHEN** the user activates a feature in the dashboard or a plugin client that needs camera, microphone, or screen capture
- **THEN** the feature SHALL report itself unavailable in this context and SHALL NOT throw

#### Scenario: New plugin code calls a secure-context API bare
- **WHEN** a source file in any client root named above (test files excluded) calls `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, or `navigator.mediaDevices` outside the allowlisted guarded helpers, whether by member access, optional chaining, or quoted bracket access on `navigator` / `crypto` (also when reached through `window`, `globalThis` or `self`), or by destructuring from them
- **THEN** the repository's secure-context source-scan test SHALL fail naming that file
