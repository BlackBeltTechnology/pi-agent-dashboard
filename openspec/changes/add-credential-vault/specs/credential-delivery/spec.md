## Purpose

Deliver vault values to pi sessions on the hub or on paired devices without code changes in the consumers. Delivery is scoped by grants and checkout confirmation. It supports live rotation and revocation and reconciles after a disconnect. It never overrides local values, and it keeps delivered values out of transcripts and dashboard output.

## ADDED Requirements

### Requirement: Delivery only to granted sessions on trusted devices
The hub SHALL deliver a binding only when both of the following hold:
- the session's project has a grant for that binding and, for repository keys, the checkout is confirmed (see `credential-vault`);
- the bridge connection is authenticated either:
  - for a session on another machine, as a paired device, over TLS; or
  - for a session on the hub, by the hub's local credential proof.

A session that is not trusted SHALL receive nothing, and SHALL behave exactly as it does without the vault.

#### Scenario: Remote session without device authentication
- **WHEN** a session on another machine connects without authenticating as a paired device
- **THEN** no vault value is delivered to it

#### Scenario: Remote session without TLS
- **WHEN** a paired device's session connects over an unencrypted `ws://` connection
- **THEN** no vault value is delivered to it

#### Scenario: Remote trusted session in a granted project
- **WHEN** a session on a paired device, connected over TLS, starts in a confirmed checkout of a project granted `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY`

#### Scenario: Empty vault changes nothing
- **WHEN** the vault has no accounts
- **THEN** sessions behave exactly as they did before the vault existed

### Requirement: Env bindings delivered as environment variables
An env binding SHALL be exposed to the session as an environment variable of the same name. It SHALL be visible to every shell command and skill process that the session starts after delivery, without restarting the session. Processes that were already running keep the environment they started with. Delivery itself SHALL NOT store a delivered value in any file on the session machine. The redaction rewrite of tool output files is not storage.

#### Scenario: Skill reads a delivered key without code change
- **WHEN** env binding `GEMINI_API_KEY` is delivered and the agent runs a skill script that reads `GEMINI_API_KEY` from its environment
- **THEN** the script sees the vault value

#### Scenario: Key granted mid-session reaches the next command
- **WHEN** a binding is granted to a running session and the agent then runs a shell command
- **THEN** that command's environment contains the variable

### Requirement: Nested pi sessions recognise inherited values
A pi process started by a session that holds delivered values SHALL recognise which of its inherited variables came from delivery.
- Those variables SHALL be redacted in the child process.
- They SHALL NOT be reported as `local-override`.
- The child process SHALL NOT update or remove them; they belong to the parent.

Only the variable names SHALL be passed to the child for this purpose, with no values and no derivatives of values. Rotation, revocation, reconciliation and the offline grace period SHALL NOT be required to reach these inherited copies during the child process's lifetime.

#### Scenario: Subagent output is redacted
- **WHEN** a session holding `GEMINI_API_KEY` starts a subagent pi process, and the subagent runs `printenv GEMINI_API_KEY`
- **THEN** the subagent's recorded output contains the redaction marker and not the value

### Requirement: Local values take precedence
Delivery SHALL NOT replace an environment variable that was present before delivery and that delivery did not set or pass down. This includes a variable set by a spawn-env contributor. On platforms whose environment names are case-insensitive, a variable SHALL be treated as present when a name differing only in letter case exists. A binding skipped for this reason SHALL be reported as `local-override`.

#### Scenario: Pre-existing env var wins
- **WHEN** the session was started with `GEMINI_API_KEY` already set, and a grant names env binding `GEMINI_API_KEY`
- **THEN** the session keeps its original value
- **AND** the binding is reported as `local-override`

### Requirement: Rotation, revocation and reconciliation
When an account is rotated or revoked, or a grant or checkout confirmation changes, the hub SHALL notify every connected session holding an affected binding. The session SHALL then do the following:
- On rotation, update the variable.
- On revocation or loss of the grant, remove the variable.

These changes, including those made during reconciliation, SHALL apply only while the variable still holds the value that delivery set. The session and the hub SHALL reconcile the full set of granted bindings in all of these cases:
- the bridge connects or reconnects;
- a session starts in the same process, for any start reason, including extension reload.

A tracked binding that is no longer granted, and whose variable still holds the delivered value, SHALL be removed. If the session's working directory cannot be determined at start, the session SHALL remove every value that delivery set, and SHALL receive nothing. The session SHALL keep track of what delivery set across an extension reload within the same pi process.

If the bridge reconnects to a hub that does not support vault delivery, for example after a downgrade, the session SHALL remove every value that delivery set. If the hub reports its vault unavailable, the session SHALL treat the hub as unreachable. The user SHALL be able to disable delivery even while the vault file is corrupt.

#### Scenario: Revoked key disappears from the next command
- **WHEN** binding `POLY_PIZZA_KEY` is revoked while a session holds it
- **THEN** the session's next shell command does not see `POLY_PIZZA_KEY`

#### Scenario: Rotated key reaches the next command
- **WHEN** the account behind `SONIOX_API_KEY` is rotated while a session holds it
- **THEN** the session's next shell command sees the new value

#### Scenario: User-overwritten variable is left alone
- **WHEN** delivery set `GEMINI_API_KEY`, the user then assigned it a different value in the session, and the binding is revoked
- **THEN** the session keeps the user's value

#### Scenario: Revocation after an extension reload
- **WHEN** delivery set `SONIOX_API_KEY`, the extensions were reloaded, and the binding is then revoked
- **THEN** the session's next shell command does not see `SONIOX_API_KEY`

#### Scenario: Hub without vault support
- **WHEN** a session holding delivered values reconnects to a hub that does not support vault delivery
- **THEN** the session's next shell command sees none of the delivered variables

#### Scenario: Reconciliation leaves a user-overwritten value alone
- **WHEN** delivery set `GEMINI_API_KEY`, the user then assigned it a different value, and the binding is revoked while the bridge is disconnected
- **AND** the bridge reconnects
- **THEN** the session keeps the user's value

#### Scenario: Revocation missed while disconnected is applied on reconnect
- **WHEN** a binding is revoked while a session's bridge is disconnected, and the bridge then reconnects
- **THEN** the session's next shell command does not see the variable

### Requirement: Bounded retention while the hub is unreachable
While the hub is unreachable, a session SHALL keep the values already delivered for at most the configured offline grace period. The period SHALL be measured in elapsed real time from the last successful reconciliation, so time the machine spends asleep counts toward it. The grace period SHALL default to 24 hours and SHALL be limited to between 1 hour and 7 days. After that period the values SHALL be withdrawn. The session SHALL NOT crash. The dashboard SHALL show each session's last vault contact time, and the binding state SHALL show `hub-unreachable` once known.

#### Scenario: Values kept during a short outage
- **WHEN** the hub is unreachable for 10 minutes
- **THEN** the session keeps its delivered values

#### Scenario: Values withdrawn after the grace period
- **WHEN** the hub has been unreachable for longer than the offline grace period
- **THEN** the session's next shell command does not see the delivered variables

### Requirement: Delivered values are redacted from session output
Every exact occurrence of a value delivered to, or inherited by, the session SHALL be replaced by a redaction marker before it is recorded in the transcript, sent to the model, or forwarded to the dashboard. Redaction SHALL cover:
- tool result text, details and structured content;
- assistant message text and tool-call arguments as recorded in the transcript;
- tool completion events;
- streamed tool output, including a value split across successive updates;
- message text, per event;
- extension event payloads forwarded to the dashboard;
- output of shell commands the user runs in the session;
- full-output files written by a tool or user command, once the command completes.

A value SHALL remain subject to redaction for the rest of the process's life, even after rotation or revocation.

Out of scope:
- encoded or transformed forms of a value;
- the session user's own terminal display.

The following are known exceptions:
- **Running commands.** While a command is still running, its full-output file MAY contain the value. The file is written by pi, which in versions before 1.1.0 uses the default file mode.
- **pi crash.** A command interrupted by a pi crash MAY leave its full-output file unredacted.
- **Other extensions.** When another extension handles a user-run command before the vault does, or reads a tool result after the vault's handler, only the copy forwarded to the dashboard is guaranteed to be redacted.

#### Scenario: printenv does not leak a delivered key
- **WHEN** a session holding `GEMINI_API_KEY` runs `printenv GEMINI_API_KEY`
- **THEN** the tool result recorded in the transcript contains a redaction marker and not the key value

#### Scenario: Streaming output reaching the dashboard is redacted
- **WHEN** a long-running command prints a delivered value while it runs
- **THEN** the streamed output shown in the dashboard contains the redaction marker
- **AND** no part of the value is shown

#### Scenario: User-run command output is redacted
- **WHEN** the user runs `!printenv SONIOX_API_KEY` in a session holding that binding
- **THEN** the recorded output contains the redaction marker and not the value

#### Scenario: Truncated output file is redacted after completion
- **WHEN** a shell command prints a delivered value and its output is long enough to be written to a full-output file
- **THEN** after the command completes, that file contains the redaction marker and not the value

#### Scenario: Truncated tool result details are redacted
- **WHEN** a shell command prints a delivered value near the end of output that is long enough to be truncated
- **THEN** neither the recorded tool result's text nor its details contain the value

#### Scenario: Rotated-away value stays redacted
- **WHEN** `GEMINI_API_KEY` was rotated, and a process started before the rotation prints the old value
- **THEN** the recorded output contains the redaction marker

### Requirement: Disabling delivery restores local behaviour
When the user disables delivery, or the pi process ends its last session, the session SHALL remove every environment variable that delivery set and that still holds the delivered value. An extension reload SHALL NOT be treated as an end. A new, resumed or forked session in the same process SHALL be reconciled as described above.

#### Scenario: Disable delivery
- **WHEN** a session holds env binding `SONIOX_API_KEY` and the user disables delivery
- **THEN** the session's next shell command does not see `SONIOX_API_KEY`

#### Scenario: Reload keeps delivered values
- **WHEN** a session holds env binding `SONIOX_API_KEY` and its extensions are reloaded
- **THEN** the session's next shell command still sees `SONIOX_API_KEY`

### Requirement: Delivery is observable without exposing values
The hub SHALL record the following events, each carrying the account id, binding name, session id and outcome, and no value:
- delivery, rotation and revocation;
- reconciliation;
- `local-override` skips;
- confirmation requests.

For each session, the dashboard SHALL show the bindings the session holds and their state, without values. The state SHALL be one of:
- `delivered`;
- `local-override`;
- `pending-confirmation`;
- `hub-unreachable`;
- `revoked`, with a note that processes already running may still hold the old value.

#### Scenario: Session shows its bindings
- **WHEN** a user opens a session's details
- **THEN** the dashboard lists the bindings for that session, with their state and no values
