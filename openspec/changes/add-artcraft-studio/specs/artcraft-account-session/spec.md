## Purpose
Sign a user into their ArtCraft account from the command line and maintain an ArtCraft MCP session — with secret tokens kept in a user-only file, rotated safely across processes, never displayed, and revocable — so agents can later use ArtCraft's hosted services on the user's behalf.

## ADDED Requirements

### Requirement: Login creates an MCP session
`pi-craft artcraft login` SHALL sign the user in through ArtCraft's login challenge (showing the user what to approve and polling with backoff starting at 2 seconds and capped at 10 seconds until approval, denial or a timeout equal to the challenge expiry returned by the server, or 10 minutes when none is returned) and SHALL then create an MCP session identifying the client as `pi-craft` with its version, storing the returned session token and refresh token and deleting any stored credit-use acknowledgement. `pi-craft artcraft whoami` SHALL show the account label and session expiry recorded from the session responses without revealing any token, and SHALL exit `1` naming `pi-craft artcraft login` when no session is stored.

#### Scenario: Login timeout
- **WHEN** the user does not approve the login challenge before the timeout
- **THEN** no session is created, nothing is stored, and the exit code is `1`

#### Scenario: Login denied
- **WHEN** the user denies the login challenge
- **THEN** no session is created, nothing is stored, and the exit code is `1`

#### Scenario: Tokens never shown
- **WHEN** `login`, `whoami`, `status` or `mcp` run with any verbosity, including on error paths
- **THEN** no session or refresh token value appears on stdout, stderr, in log files, or in the argument list of any child process

### Requirement: User-only storage and locked rotation
Session and refresh tokens SHALL be stored in one file under `<pi agent dir>/artcraft/` (pi agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`, independent of `CRAFT_HOME`), with the directory mode `0700` and the file mode `0600`, written by write-to-temp then rename. An existing directory or file with group or other permissions SHALL be tightened when owned by the user and SHALL otherwise be refused with exit `1` naming the path. Writes SHALL be refused with exit `1` naming the path when the directory or any file in it is, or resolves through, a symbolic link. An unparseable session file SHALL be treated as no session. A refresh SHALL hold one exclusive cross-process lock across re-reading the stored session, sending the refresh request (bounded by a timeout) and writing back the newly returned tokens; the lock SHALL be taken over only when it is older than 60 seconds and its holder process is no longer alive; a waiting process SHALL give up with exit `1`, without sending a refresh, after a bounded wait. A refresh that fails by timeout, connection error or server error SHALL leave the stored session unchanged and fail the call. A process that acquires the lock after another process refreshed SHALL use the stored new session without sending a request. When a refresh is rejected as invalid, the stored session SHALL be deleted only if it still holds the rejected refresh token, and the caller SHALL fail naming `pi-craft artcraft login`.

#### Scenario: Concurrent refresh
- **WHEN** two `pi-craft artcraft mcp` processes detect an expired session at the same time
- **THEN** exactly one refresh request is sent with the stored refresh token, and both processes continue with the new session

#### Scenario: File permissions
- **WHEN** `login` stores a session on a machine where `<pi agent dir>/artcraft/` does not exist
- **THEN** the directory is created with mode `0700` and the session file with mode `0600`

#### Scenario: Live slow holder keeps the lock
- **WHEN** a refresh holding the lock is still in flight from a live process and a second process needs a refresh
- **THEN** the second process waits and does not send its own refresh request

#### Scenario: Consumed refresh token
- **WHEN** the refresh endpoint rejects the stored refresh token as invalid
- **THEN** the stored session is deleted, no retry is sent, and the error names `pi-craft artcraft login`

#### Scenario: Rejection does not delete a newer session
- **WHEN** a refresh is rejected but the stored session already holds a different refresh token written by another process
- **THEN** the stored session is kept and used

#### Scenario: Transport failure keeps the session
- **WHEN** the refresh request times out
- **THEN** the stored session file is unchanged and the call fails

#### Scenario: Symlinked store refused
- **WHEN** `<pi agent dir>/artcraft/session.json` is a symbolic link
- **THEN** no token is written through it and the command exits `1` naming the path

#### Scenario: Group-readable directory tightened
- **WHEN** `<pi agent dir>/artcraft/` exists owned by the user with mode `0755`
- **THEN** it is changed to `0700` before any token is written

### Requirement: Logout revokes
`pi-craft artcraft logout` SHALL revoke the MCP session server-side and delete the stored tokens and the credit-use acknowledgement; if the server cannot be reached it SHALL still delete both locally and report that the session could not be revoked remotely and stays valid until it expires.

#### Scenario: Offline logout
- **WHEN** `logout` runs without network
- **THEN** local tokens and the credit-use acknowledgement are deleted and stderr states the session could not be revoked remotely
