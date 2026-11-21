## ADDED Requirements

### Requirement: Askpass helper is installed only when enabled
When `sudoCredentialPrompt.enabled` is true (the default) on macOS or Linux and the operator has not set `SUDO_ASKPASS`, the bridge SHALL set `process.env.SUDO_ASKPASS` to a private wrapper on observing a `dashboard_identity` that advertises `sudo-credential` (sent after registration, so after `session_start`). It SHALL remove it (only if still ours) at `session_shutdown`, on server-connection loss, or when a later identity lacks the feature. Otherwise it SHALL change nothing.

#### Scenario: Default config installs the helper
- **WHEN** the setting is unset (default true), a session starts on Linux and the server's `dashboard_identity` advertises `sudo-credential`
- **THEN** `SUDO_ASKPASS` is set with no operator configuration

#### Scenario: Enabled session installs the helper
- **WHEN** the setting is true and the identity advertising `sudo-credential` is observed on Linux
- **THEN** `SUDO_ASKPASS` points at a file with mode 0700 in a directory with mode 0700

#### Scenario: Disabled or Windows leaves env untouched
- **WHEN** the setting is explicitly false, or the platform is `win32`
- **THEN** `SUDO_ASKPASS` is not set by the bridge

#### Scenario: Disabling at runtime takes effect immediately
- **WHEN** the operator sets `sudoCredentialPrompt.enabled` to false while a session is running
- **THEN** the cache is zeroed, a pending prompt is dismissed (helper exit 1), and the wrapper and socket are removed and `SUDO_ASKPASS` unset only if still ours, without waiting for the next session start

#### Scenario: Pre-existing operator SUDO_ASKPASS is never overwritten
- **WHEN** `SUDO_ASKPASS` is already set when the identity is observed
- **THEN** the bridge leaves it untouched and installs no helper

#### Scenario: Old server leaves env untouched
- **WHEN** the server never sends an identity, or sends one without `sudo-credential`
- **THEN** `SUDO_ASKPASS` is not set and sudo fails as before, never hanging on an unanswerable prompt

#### Scenario: Late identity installs the helper
- **WHEN** the session has started and the identity advertising `sudo-credential` arrives afterwards
- **THEN** the helper is installed at that point and not before

#### Scenario: Reconnect to a downgraded server withdraws the helper
- **WHEN** a later `dashboard_identity` (or a reconnect to an old server) lacks `sudo-credential`, or the server connection is lost
- **THEN** the bridge removes `SUDO_ASKPASS` only if it is still ours, clears the cache, and dismisses a pending prompt (helper exits 1)

#### Scenario: Wrapper is private
- **WHEN** the wrapper is installed
- **THEN** it is mode 0700 in a unique `mkdtemp` directory of mode 0700, with a socket path within `sun_path` limits, and no pre-existing socket is accepted

#### Scenario: Concurrent sessions do not collide
- **WHEN** two sessions of the same user are active
- **THEN** each has its own `mkdtemp` directory and socket, and a prompt or password of one is never delivered to the other

#### Scenario: Interpreter is not agent-selectable
- **WHEN** the agent sets `PATH` or `NODE_OPTIONS` in the bash call
- **THEN** the wrapper still executes the absolute interpreter path chosen at install

#### Scenario: Shutdown cleans up
- **WHEN** the session shuts down
- **THEN** the socket and wrapper are deleted and `SUDO_ASKPASS` is unset only if it still equals the bridge's path

### Requirement: Operator is prompted per askpass invocation
Each askpass invocation without a fresh cached password SHALL show one masked-password modal in the dashboard stating the session, every bash/`user_bash` command in flight (shown in full, scrollable), and sudo's prompt text (escaped, labelled as text supplied by the command, bounded: see the prompt-text requirement). A submitted password SHALL be returned to sudo on stdout only; Cancel, Esc, or timeout (default 120 s) SHALL make the helper exit non-zero.

#### Scenario: Password continues the command
- **WHEN** `sudo true` runs in a bash tool call and the operator submits the correct password
- **THEN** the command completes and the tool output does not contain the password

#### Scenario: Cancel fails the attempt cleanly
- **WHEN** the operator clicks Cancel
- **THEN** the helper exits 1, sudo reports no password provided, and further askpass requests from the tool calls in flight at that moment are denied without a modal

#### Scenario: Timeout fails closed
- **WHEN** no answer arrives within the timeout
- **THEN** the helper exits 1 and the modal is dismissed on all browsers

#### Scenario: Timeout is not sticky
- **WHEN** a prompt timed out and the same still-running call runs `sudo` again
- **THEN** a new modal is raised (not refused); sudo's own three-attempt budget bounds repeats

#### Scenario: Password manager does not capture
- **WHEN** the modal renders its password field
- **THEN** the field sets `autocomplete="new-password"`

#### Scenario: Concurrent bash calls are all shown
- **WHEN** two bash calls are in flight and one runs sudo
- **THEN** the modal lists both commands and a Cancel is sticky for both

#### Scenario: Late or stale answer is discarded
- **WHEN** a password arrives after the timeout, after the helper's socket closed, after the tool call ended or was aborted, or with a callId that is not the single pending prompt
- **THEN** it is dropped and never cached

#### Scenario: Prompt ends when the call ends
- **WHEN** the helper socket closes, the tool call ends or is aborted, the bridge disconnects, or the server restarts while a modal is open
- **THEN** the modal is dismissed on all browsers and the pending slot is freed

### Requirement: Helper requests pass an anti-accident gate
The bridge SHALL serve a helper request only while a `bash` or `user_bash` call is in flight, no other prompt is pending for the session, and no sticky Cancel applies. These are anti-accident checks, not a security boundary: the socket peer and the self-reported `ppid` are not verified.

#### Scenario: Direct invocation is served like any request
- **WHEN** a command runs `"$SUDO_ASKPASS" "Enter PIN"` directly while a bash call is in flight
- **THEN** the modal appears showing the command and the prompt text labelled as supplied by the command; no refusal is asserted

### Requirement: The `!` path is tracked and masked independent of vault state
While the askpass feature is installed, the single `user_bash` handler SHALL always return operations wrapped by the in-flight tracker and the masker, even when `masker.active()` is false at command start. If operations cannot be created it SHALL return no tracker and the command SHALL NOT run unwrapped with the gate open.

#### Scenario: First-ever `!sudo` on a fresh process opens the gate
- **WHEN** a `user_bash` command runs `sudo` on a fresh process with an empty vault registry and no sudo password registered yet
- **THEN** the command is tracked as in flight, the helper request is served, and the gate closes at command end

#### Scenario: Echo inside the same `!` command is masked
- **WHEN** the operator's password is registered mid-command and the same command then prints it, including across stream chunks
- **THEN** the streamed output, transcript and JSONL contain `[REDACTED:SUDO_PASSWORD]` and not the password

#### Scenario: Vault masking still applies to `!` commands
- **WHEN** a `user_bash` command runs with the sudo prompt enabled and vault values exist
- **THEN** vault masking of its output is unchanged and the in-flight gate closes at command end

#### Scenario: Local operations unavailable fails closed
- **WHEN** the feature is installed but local bash operations cannot be created for a `user_bash` command
- **THEN** that command is not tracked, sudo is refused for it, and it is never run unwrapped with the gate open

#### Scenario: Feature not installed leaves the handler unchanged
- **WHEN** the askpass feature is not installed and the vault masker is inactive
- **THEN** the `user_bash` handler returns no operations, as before

#### Scenario: No tool call in flight is refused
- **WHEN** the socket receives a request while no bash call is running
- **THEN** it is refused without a modal

#### Scenario: Unanswerable prompt fails immediately
- **WHEN** no server is connected, no browser owning the session is subscribed, or the remote bridge is refused by `decideVaultTrust`
- **THEN** the helper exits 1 at once without waiting for the timeout

#### Scenario: Stale client that cannot show the modal is refused fast
- **WHEN** the only subscribed browser runs an old client that ignores `sudo_credential_request` and sends no `sudo_credential_shown {callId}` within 2 000 ms
- **THEN** the server relays `sudo_credential_cancel {callId, reason:"unanswerable"}`, the helper exits 1, and the refusal is not sticky for later prompts

#### Scenario: Any one ack keeps the prompt open
- **WHEN** at least one subscribed browser acks with the pending `callId` within 2 000 ms
- **THEN** the prompt stays pending until answered, cancelled, dismissed or timed out

#### Scenario: Same-user residual is documented
- **WHEN** a same-user process opens the helper socket or runs attacker code under a sudo it started
- **THEN** the behaviour is the accepted D7 residual (owner accepted): it can obtain the plaintext password; mitigation is masking of verbatim echoes into the LLM/transcript/JSONL; the artifact does not claim otherwise and no scenario asserts refusal

### Requirement: Entered password is registered with the vault masker
On receiving an operator answer for the current `callId`, and before delivering or caching it, the bridge SHALL register the password with the vault masker's value set under the name `SUDO_PASSWORD`, so exact occurrences are replaced by `[REDACTED:SUDO_PASSWORD]` in tool results, messages, `!` command output and forwarded events. The value SHALL stay registered for the process lifetime; encoded or transformed forms are not masked.

#### Scenario: Echoed password is masked in tool output
- **WHEN** a command later prints the entered password verbatim
- **THEN** the tool result, transcript, session JSONL and model context contain `[REDACTED:SUDO_PASSWORD]` and not the password

#### Scenario: Registration precedes delivery and survives cache expiry
- **WHEN** the operator answers and later the cache expires or is forgotten
- **THEN** the password was registered before the helper received it and stays masked after the cache is cleared

#### Scenario: Dropped answers are not registered
- **WHEN** an answer is late or carries a wrong `callId`
- **THEN** it is discarded and not registered

#### Scenario: Registration works without a cache and with vault values
- **WHEN** `cacheMinutes=0` or vault values are also delivered
- **THEN** the sudo password is still masked and vault values are masked unchanged, with `vault-masker.ts` unmodified

#### Scenario: Transformed echo is a documented limit
- **WHEN** a process prints a base64 or otherwise transformed copy of the password
- **THEN** it is not masked and the artifact does not claim otherwise

### Requirement: Password never reaches model, transcript, logs or state
The password SHALL travel only browser → server → bridge → helper stdout (cache reuse: bridge memory → helper stdout). On every bridge-, server- and helper-controlled path it SHALL NOT enter `prompt_*` messages, `QuestionStore`, the event store, replay buffers, session JSONL, persisted JSON, the LLM context, tool results, logs, telemetry, URLs or `localStorage`. Server and bridge logs SHALL name the message type and `callId` only.

#### Scenario: Canary password leaves no trace
- **WHEN** a canary password is submitted for a sudo prompt
- **THEN** a scan of event store, persisted dashboard JSON, session JSONL, tool results (including bash spilled full-output files), captured server/bridge logs and the replay snapshot finds no occurrence

#### Scenario: Cached reuse leaves no trace either
- **WHEN** a later sudo is answered from the cache
- **THEN** the same scan finds no occurrence and no model-visible message mentions the cache hit

### Requirement: Helper delivery and clearing limits
The helper SHALL receive the password only over the accepted socket connection and SHALL NOT pass it via argv or env or write it to stderr. Clearing is best-effort: the bridge `Buffer` is zeroed, but transient string copies in WS parsing/relay and the masker's registered string cannot be, and a same-user process that obtains the password and transforms it before printing it is outside the guarantee (design D7).

#### Scenario: Helper crash leaks nothing
- **WHEN** the helper fails or crashes while a canary password is in flight
- **THEN** its stderr carries only a fixed message and the helper process env and argv contain no secret

#### Scenario: Bridge request frames are not events
- **WHEN** the bridge emits `sudo_credential_request` or `sudo_credential_cache`
- **THEN** the server handles them on the dedicated road and they are never stored or replayed as `event_forward` events

#### Scenario: Bridge frames are dispatched, owner-scoped and cleaned up
- **WHEN** the bridge sends `sudo_credential_request` or `sudo_credential_cache`, or its socket closes with a prompt pending
- **THEN** the server relays them only to browsers owning the session (never through `extractSessionUpdates` or the event store), refuses immediately when none is subscribed, and on socket close clears the pending slot and broadcasts `sudo_credential_dismiss`

#### Scenario: Reconnecting browser sees metadata only
- **WHEN** a browser subscribes while a sudo prompt is pending
- **THEN** it receives the request metadata and no credential field

#### Scenario: Pending request is replayed to a reloaded owner
- **WHEN** an owner browser at tier `control` reloads or newly subscribes while a prompt is pending
- **THEN** it receives the pending request again (commands and prompt text only, never a password), may ack it with `sudo_credential_shown`, and its answer is delivered once

### Requirement: Any authenticated session-owner client may answer
`sudo_credential_response`, `_cancel`, `_forget` and the `_shown` ack SHALL be accepted from any authenticated browser owning the session (session-owner scope; WS tier `control`, listed in `WS_MESSAGE_TIERS`), including over plain non-loopback HTTP. A remote bridge SHALL be served only when the vault trust predicate (`decideVaultTrust`) passes. The first answer wins; other browsers get `sudo_credential_dismiss`.

#### Scenario: Plain-HTTP LAN browser can answer
- **WHEN** the only subscribed browser is authenticated over non-loopback `http`
- **THEN** the modal is shown and its answer is accepted

#### Scenario: Observe-tier sockets neither receive nor ack
- **WHEN** an owning browser socket is at tier `observe` while a prompt is pending
- **THEN** it receives no `sudo_credential_request` or replay and its `sudo_credential_shown` or response is dropped; with only observe sockets subscribed the request is refused at once

#### Scenario: Non-owner cannot answer
- **WHEN** the owner resolver is active and a browser not owning the session sends `sudo_credential_response`
- **THEN** the server drops it and the prompt stays pending

#### Scenario: Paired control-tier user can answer
- **WHEN** a paired device/passkey user at tier `control` owning the session answers
- **THEN** the answer is accepted

#### Scenario: First answer wins
- **WHEN** two browsers show the modal and one submits
- **THEN** the other receives `sudo_credential_dismiss`

#### Scenario: Remote bridge still needs trust
- **WHEN** the bridge is remote and `decideVaultTrust` refuses it
- **THEN** no modal is shown and the sudo attempt fails immediately

### Requirement: Answers are bound to the pending prompt and never queued
A response SHALL be accepted only if bound to the `(sessionId, callId)` of the single pending prompt, where `callId` is an unguessable per-prompt random value. The three browser-to-bridge messages SHALL be delivered on the bridge's immediate inbound lane and SHALL NOT be queued by the client reconnect outbox.

#### Scenario: Wrong callId or sessionId is dropped
- **WHEN** a response carries a callId or sessionId that is not the pending prompt's
- **THEN** it is dropped and the prompt stays pending

#### Scenario: Answer is not queued across reconnect
- **WHEN** the client socket is not OPEN when the operator submits
- **THEN** the dialog shows "connection lost, retry", the password is not held in an outbox, and nothing is delivered later

#### Scenario: Answer is not delayed by a slow inbound handler
- **WHEN** the bridge inbound pump is busy or full
- **THEN** `sudo_credential_response`/`_cancel`/`_forget` are still delivered promptly

### Requirement: In-memory per-session password cache
The bridge SHALL cache the operator-entered password in memory only, per session, for `sudoCredentialPrompt.cacheMinutes` (default 5, configurable, 0 disables) from entry, and SHALL answer a gated helper request from a fresh entry without a modal. It SHALL clear the cache on session end or restart, server-connection loss, explicit forget, expiry, disable, or a rejected password.

#### Scenario: Reuse within the window skips the modal
- **WHEN** a second sudo in the same session runs 2 minutes after a successful entry with the default window
- **THEN** the helper is answered from the cache and no modal appears

#### Scenario: Expiry prompts again
- **WHEN** a sudo runs after `cacheMinutes` have elapsed
- **THEN** a modal is shown and the expired password is zeroed

#### Scenario: Clearing events drop the cache
- **WHEN** the session shuts down, the server connection is lost, or the operator sends `sudo_credential_forget`
- **THEN** the cache is zeroed and the next sudo prompts

#### Scenario: Entry on the final allowed invocation is not cached
- **WHEN** the operator enters a password on the third helper invocation for the same sudo pid, counting cache hits (e.g. stale cached password rejected = invocation 1, entry A = 2, entry B = 3)
- **THEN** that entry is not cached, so a wrong final entry cannot trigger an extra failed authentication on the next sudo

#### Scenario: Rejected password is dropped
- **WHEN** sudo re-invokes the helper for the same sudo pid after receiving a cached password
- **THEN** the cache is cleared and the operator is prompted

#### Scenario: Cache is never persisted
- **WHEN** the cache holds a canary password
- **THEN** no disk file, log line, transcript, JSONL or message to the LLM contains it, and `cacheMinutes=0` stores nothing

#### Scenario: Gate precedes the cache
- **WHEN** a helper request fails the in-flight or single-pending gate while the cache is fresh
- **THEN** it is refused and the cached password is not returned

### Requirement: Configuration values are clamped and defaulted
`sudoCredentialPrompt.cacheMinutes` SHALL be floored to an integer and clamped to 0–60, non-numeric values defaulting to 5. `sudoCredentialPrompt.timeoutMs` SHALL be clamped to 5 000–600 000, non-numeric values defaulting to 120 000. A missing `sudoCredentialPrompt` key SHALL resolve to `{enabled:true, timeoutMs:120000, cacheMinutes:5}`. Invalid values never reject the config write.

#### Scenario: Out-of-range and non-numeric values are clamped
- **WHEN** config holds `cacheMinutes` of -1, 1.5, 61 or `"abc"`, or `timeoutMs` of 0, 1e9 or `"abc"`
- **THEN** they resolve to 0, 1, 60, 5 and to 5 000, 600 000, 120 000 respectively

### Requirement: Latency and memory bounds
Refusing a helper request, and answering one from a fresh cache, SHALL complete with p95 at most 250 ms and 100 ms respectively on the unix socket, with no 120 s wait. Per-sudo-pid invocation state SHALL be evicted no later than the cache window after the last invocation. The masker overhead for a registered password SHALL stay within 2x of baseline on 10 MiB of output (regression guard).

#### Scenario: Refusal and cache hit are prompt
- **WHEN** 200 gate-refused requests and 1 000 cache-hit requests are issued
- **THEN** p95 latency is at most 250 ms and 100 ms respectively

#### Scenario: Per-pid state does not leak
- **WHEN** 1 000 distinct sudo pids have invoked the helper and the cache window has elapsed
- **THEN** no per-pid counter entries remain

### Requirement: Prompt text is bounded and the answer is validated
The prompt text SHALL be capped at 500 displayed characters; beyond the cap the first 250 and last 250 characters are kept with an `N more chars` marker between them. An empty password, or one longer than 1 024 characters, SHALL be rejected by the dialog and by the relay and SHALL never reach the bridge masker, the cache or the helper. Only one prompt is pending per session: a second helper request while one is pending SHALL be refused at once (helper exit 1) and never queued.

#### Scenario: Second request while a prompt is pending is refused
- **WHEN** a prompt is pending and a second helper request arrives (for example from a parallel bash call)
- **THEN** the second helper exits 1 at once, no second modal or queue entry exists, and the first modal is unaffected

#### Scenario: Prompt text with hostile characters is shown as escapes
- **WHEN** `sudo -p` text contains ESC, CR, BEL, NUL, newline, U+202E or U+200B
- **THEN** each is displayed as a visible escape (`\x1b`, `\r`, `\x07`, `\x00`, `\n`, `\u202E`, `\u200B`) and the text is rendered inert

#### Scenario: Long prompt text is truncated from the middle
- **WHEN** the displayed prompt text exceeds 500 characters
- **THEN** the first 250 and last 250 characters are shown with an `N more chars` marker between them; a text of 500 characters or fewer is shown whole

#### Scenario: Empty or over-long password is rejected
- **WHEN** the operator submits an empty password, or a password longer than 1 024 characters, or such a response reaches the relay or bridge
- **THEN** the dialog sends nothing, the relay drops it, the bridge never registers, caches or delivers it, and the prompt stays pending
