## Purpose
Sign a user into their ArtCraft account from the command line and maintain an ArtCraft MCP session — with secret tokens kept in OS-protected storage, rotated safely, never displayed, and revocable — so agents can later use ArtCraft's hosted services on the user's behalf.

## ADDED Requirements

### Requirement: Login creates an MCP session
`pi-craft artcraft login` SHALL sign the user in through ArtCraft's login challenge (showing the user what to approve and polling with backoff until approval, denial or a timeout) and SHALL then create an MCP session identifying the client as `pi-craft` with its version, storing the returned session token and refresh token. `pi-craft artcraft whoami` SHALL show the account identity and session expiry without revealing any token.

#### Scenario: Login timeout
- **WHEN** the user does not approve the login challenge before the timeout
- **THEN** no session is created, nothing is stored, and the exit code is `1`

#### Scenario: Tokens never shown
- **WHEN** `login`, `whoami` or `status` run with any verbosity
- **THEN** no session or refresh token value appears on stdout, stderr or in log files

### Requirement: Secure storage and atomic rotation
Session and refresh tokens SHALL be stored in the OS credential store (macOS Keychain, Windows Credential Manager, Secret Service on Linux) or, when none is available, in a file readable only by the user (mode `0600`) under the pi agent directory. Each refresh SHALL replace the stored refresh token with the newly returned one atomically, and concurrent refreshes from multiple processes SHALL NOT both consume the same refresh token.

#### Scenario: Concurrent refresh
- **WHEN** two `pi-craft artcraft mcp` processes detect an expired session at the same time
- **THEN** exactly one refresh request is sent with the stored refresh token, and both processes continue with the new session

#### Scenario: File fallback permissions
- **WHEN** no OS credential store is available
- **THEN** the session file is created with mode `0600` and its parent directory is not world-readable

### Requirement: Logout revokes
`pi-craft artcraft logout` SHALL revoke the MCP session server-side and delete the stored tokens; if the server cannot be reached it SHALL still delete local tokens and report that server-side revocation is pending.

#### Scenario: Offline logout
- **WHEN** `logout` runs without network
- **THEN** local tokens are deleted and stderr states the session could not be revoked remotely
