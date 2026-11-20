## ADDED Requirements

### Requirement: Askpass helper is installed only when enabled
When `sudoCredentialPrompt.enabled` is true (the default) on macOS or Linux, the bridge SHALL set `process.env.SUDO_ASKPASS` to a private wrapper (0700, in a 0700 directory) at `session_start` and remove it (only if still ours) at `session_shutdown`. When disabled or on Windows it SHALL set nothing.

#### Scenario: Default config installs the helper
- **WHEN** the setting is unset (default true) and a session starts on Linux
- **THEN** `SUDO_ASKPASS` is set with no operator configuration

#### Scenario: Enabled session installs the helper
- **WHEN** the setting is true and a session starts on Linux
- **THEN** `SUDO_ASKPASS` points at a file with mode 0700 in a directory with mode 0700

#### Scenario: Disabled or Windows leaves env untouched
- **WHEN** the setting is explicitly false, or the platform is `win32`
- **THEN** `SUDO_ASKPASS` is not set by the bridge

#### Scenario: Shutdown cleans up
- **WHEN** the session shuts down
- **THEN** the socket and wrapper are deleted and `SUDO_ASKPASS` is unset only if it still equals the bridge's path

### Requirement: Operator is prompted per askpass invocation
Each askpass invocation without a fresh cached password SHALL show one masked-password modal in the dashboard stating the session, the in-flight bash command, and sudo's prompt text (control characters stripped, length capped). A submitted password SHALL be returned to sudo on stdout only; Cancel, Esc, or timeout (default 120 s) SHALL make the helper exit non-zero.

#### Scenario: Password continues the command
- **WHEN** `sudo true` runs in a bash tool call and the operator submits the correct password
- **THEN** the command completes and the tool output does not contain the password

#### Scenario: Cancel fails the attempt cleanly
- **WHEN** the operator clicks Cancel
- **THEN** the helper exits 1, sudo reports no password provided, and further askpass requests from the same tool call are denied without a modal

#### Scenario: Timeout fails closed
- **WHEN** no answer arrives within the timeout
- **THEN** the helper exits 1 and the modal is dismissed on all browsers

### Requirement: Only a verified sudo child in a live bash call is served
The bridge SHALL answer a helper request only if the reported parent pid resolves to a root-owned system `sudo` executable, a `bash` tool call or `user_bash` command is in flight, and no other sudo prompt is pending for the session. Otherwise it SHALL refuse without prompting.

#### Scenario: Direct invocation is refused
- **WHEN** a command runs `"$SUDO_ASKPASS" "Enter PIN"` directly
- **THEN** the parent is not system sudo, no modal appears, and the helper exits 1

#### Scenario: No tool call in flight is refused
- **WHEN** the socket receives a request while no bash call is running
- **THEN** it is refused without a modal

### Requirement: Password never reaches model, transcript, logs or state
The password SHALL travel only browser → server → bridge → helper stdout (cache reuse: bridge memory → helper stdout). It SHALL NOT enter `prompt_*` messages, `QuestionStore`, the event store, replay buffers, session JSONL, persisted JSON, the LLM context, logs, telemetry, URLs or `localStorage`. Server and bridge logs SHALL name the message type and `callId` only.

#### Scenario: Canary password leaves no trace
- **WHEN** a canary password is submitted for a sudo prompt
- **THEN** a scan of event store, persisted dashboard JSON, session JSONL, captured server/bridge logs and the replay snapshot finds no occurrence

#### Scenario: Cached reuse leaves no trace either
- **WHEN** a later sudo is answered from the cache
- **THEN** the same scan finds no occurrence and no model-visible message mentions the cache hit

#### Scenario: Reconnecting browser sees metadata only
- **WHEN** a browser subscribes while a sudo prompt is pending
- **THEN** it receives the request metadata and no credential field

### Requirement: Any authenticated session-owner client may answer
`sudo_credential_response`, `_cancel` and `_forget` SHALL be accepted from any authenticated browser owning the session (session-owner scope), including over plain non-loopback HTTP. A remote bridge SHALL be served only when the vault trust predicate (`decideVaultTrust`) passes. The first answer wins; other browsers get `sudo_credential_dismiss`.

#### Scenario: Plain-HTTP LAN browser can answer
- **WHEN** the only subscribed browser is authenticated over non-loopback `http`
- **THEN** the modal is shown and its answer is accepted

#### Scenario: Non-owner cannot answer
- **WHEN** a browser not owning the session sends `sudo_credential_response`
- **THEN** the server drops it and the prompt stays pending

#### Scenario: First answer wins
- **WHEN** two browsers show the modal and one submits
- **THEN** the other receives `sudo_credential_dismiss`

#### Scenario: Remote bridge still needs trust
- **WHEN** the bridge is remote and `decideVaultTrust` refuses it
- **THEN** no modal is shown and the sudo attempt fails

### Requirement: In-memory per-session password cache
The bridge SHALL cache the operator-entered password in memory only, per session, for `sudoCredentialPrompt.cacheMinutes` (default 5, configurable, 0 disables) from entry, and SHALL answer a verified helper request from a fresh entry without a modal. It SHALL clear the cache on session end or restart, server-connection loss, explicit forget, expiry, disable, or a rejected password.

#### Scenario: Reuse within the window skips the modal
- **WHEN** a second sudo in the same session runs 2 minutes after a successful entry with the default window
- **THEN** the helper is answered from the cache and no modal appears

#### Scenario: Expiry prompts again
- **WHEN** a sudo runs after `cacheMinutes` have elapsed
- **THEN** a modal is shown and the expired password is zeroed

#### Scenario: Clearing events drop the cache
- **WHEN** the session shuts down, the server connection is lost, or the operator sends `sudo_credential_forget`
- **THEN** the cache is zeroed and the next sudo prompts

#### Scenario: Rejected password is dropped
- **WHEN** sudo re-invokes the helper for the same sudo pid after receiving a cached password
- **THEN** the cache is cleared and the operator is prompted

#### Scenario: Cache is never persisted
- **WHEN** the cache holds a canary password
- **THEN** no disk file, log line, transcript, JSONL or message to the LLM contains it, and `cacheMinutes=0` stores nothing

#### Scenario: Verification precedes the cache
- **WHEN** a helper request fails parent-is-sudo or in-flight checks while the cache is fresh
- **THEN** it is refused and the cached password is not returned
