# agent-path-confinement Specification

## Purpose
Gates a pi agent's `read`, `write` and `edit` tool calls whose target lies outside the session's workspace roots behind an operator answer given in that session's own conversation, failing closed.

## Requirements

### Requirement: Out-of-root path tool calls are gated before execution

When the gate is enabled, the system SHALL evaluate every `read`, `write` and `edit` tool call of a pi session before the tool executes. The target path SHALL be resolved by the same rules the tool itself applies to its path argument (including home-directory expansion, a leading `@` marker, whitespace normalisation, and resolution against the session working directory), and SHALL then be canonicalised through the real path of its nearest existing ancestor before comparison. Containment SHALL be decided component-wise, never by string prefix, with case sensitivity taken from the filesystem. A call whose canonical target lies within the session's roots SHALL proceed without a prompt. A call whose canonical target lies outside them SHALL NOT execute unless the operator allows it. No other tool SHALL be gated by this capability.

#### Scenario: In-root read proceeds silently

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/repo/src/a.ts`
- **THEN** the tool SHALL run and no prompt SHALL be raised

#### Scenario: Out-of-root read asks first

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/other/secret.txt`
- **THEN** the tool SHALL NOT run until the operator answers

#### Scenario: Relative traversal is resolved before comparison

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `../other/x.txt`
- **THEN** the call SHALL be treated as a read of `/w/other/x.txt` and asked about

#### Scenario: Home-directory shorthand is resolved as the tool resolves it

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `~/.ssh/id_rsa`
- **THEN** the call SHALL be treated as a read of the file in the user's home directory and asked about, not as a path inside `/w/repo`

#### Scenario: A leading @ marker is resolved as the tool resolves it

- **WHEN** the agent writes `@/etc/hosts`
- **THEN** the call SHALL be treated as a write of `/etc/hosts` and asked about

#### Scenario: A string-prefix sibling is not inside the root

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/repo-old/a.txt`
- **THEN** the call SHALL be asked about

#### Scenario: A symlink inside the root pointing outside is asked about

- **GIVEN** `/w/repo/link` is a symlink to `/w/other`
- **WHEN** the agent writes `/w/repo/link/f.txt`
- **THEN** the call SHALL be treated as a write of `/w/other/f.txt` and asked about

#### Scenario: Other tools are not gated

- **WHEN** the agent runs `bash` with `cat /w/other/secret.txt`
- **THEN** this capability SHALL NOT raise a prompt or block the call

### Requirement: Session roots

A session's roots SHALL be: its working directory and that directory's checkout root, resolved by the same rules file-read containment uses (the working directory alone when the checkout root cannot be determined within the bounded probe); the operating system temporary directory, for reads and writes; the pi agent directory, the directories of skills loaded into the session, and context files pi loaded for the session, for reads only; and every persisted directory grant in the path-grant store. A write whose target lies only within a read-only root SHALL be treated as outside the roots.

#### Scenario: Git checkout root is a root

- **GIVEN** a session whose working directory is `/w/repo/packages/a` inside a checkout rooted at `/w/repo`
- **WHEN** the agent reads `/w/repo/README.md`
- **THEN** the tool SHALL run without a prompt

#### Scenario: Temporary directory is writable without a prompt

- **WHEN** the agent writes a file under the operating system temporary directory
- **THEN** the tool SHALL run without a prompt

#### Scenario: Loaded skill files are readable but not writable

- **GIVEN** a skill loaded into the session from `/h/.pi/agent/skills/x/`
- **WHEN** the agent reads `/h/.pi/agent/skills/x/SKILL.md`
- **THEN** the tool SHALL run without a prompt
- **WHEN** the agent edits that same file
- **THEN** the operator SHALL be asked first

#### Scenario: A persisted grant admits its subtree

- **GIVEN** the path-grant store holds `/w/other`
- **WHEN** the agent reads `/w/other/docs/a.md`
- **THEN** the tool SHALL run without a prompt

#### Scenario: A revoked grant stops admitting on the next call

- **GIVEN** the operator revokes the grant `/w/other` in Settings ▸ Access
- **WHEN** the agent next reads `/w/other/docs/a.md`
- **THEN** the operator SHALL be asked first

### Requirement: The operator is asked in the session's own conversation

An out-of-root call SHALL raise a prompt in the same session's interactive prompt channel: a card in that session's chat view when a dashboard is attached, and the pi terminal UI otherwise. The prompt SHALL name the operation (read, write or edit), the canonical target path, the tool, and the session working directory. It SHALL NOT be raised as an application-wide modal. It SHALL offer `Allow once` and `Deny`, and SHALL offer `Always allow <directory>` only as defined by the always-allow requirement. No option SHALL be preselected as the default answer.

#### Scenario: Card renders in the session's chat

- **GIVEN** a dashboard attached to the session
- **WHEN** an out-of-root read is gated
- **THEN** a prompt card SHALL appear in that session's chat view naming the path and the operation

#### Scenario: Terminal fallback

- **GIVEN** a session with no dashboard attached and an interactive terminal UI
- **WHEN** an out-of-root read is gated
- **THEN** the prompt SHALL be shown in the terminal UI

#### Scenario: Allow once admits only this call

- **WHEN** the operator answers `Allow once` and the agent later reads the same path again
- **THEN** the first call SHALL run and the second call SHALL be asked about again

#### Scenario: First answer wins across surfaces

- **GIVEN** the prompt is shown in two dashboard tabs
- **WHEN** one tab answers
- **THEN** the other tab's card SHALL be dismissed and its later answer ignored

### Requirement: Always allow requires a second deliberate step

`Always allow <directory>` SHALL be offered only when the gated path's containing directory is grantable under the path-grant store's forbidden-subject rules and the attached dashboard has proven that it writes the same grant store the gate reads. That proof SHALL NOT be inferred from the dashboard URL's hostname; when it is absent (an older dashboard, no dashboard, or a different store), the prompt SHALL say the answer cannot be remembered. Choosing it SHALL raise a second confirmation naming the exact directory to be persisted and stating that it can be revoked in Settings ▸ Access. Only an explicit confirmation SHALL persist the grant. The directory SHALL be the gated file's containing directory (or the gated path itself when it is a directory); an ancestor of it SHALL NOT be offered. Cancelling the confirmation SHALL be treated as `Deny`.

#### Scenario: Confirmed always-allow persists and runs

- **WHEN** the operator chooses `Always allow /w/other/docs` and confirms
- **THEN** `/w/other/docs` SHALL be recorded in the path-grant store and the call SHALL run

#### Scenario: Cancelled confirmation denies

- **WHEN** the operator chooses `Always allow /w/other/docs` and cancels the confirmation
- **THEN** the call SHALL be blocked and no grant SHALL be recorded

#### Scenario: No ancestor is offered

- **WHEN** a read of `/w/other/docs/a.md` is gated
- **THEN** no option SHALL name `/w/other` or any other ancestor of `/w/other/docs`

#### Scenario: Not offered through a forwarded remote dashboard

- **GIVEN** the session reaches a dashboard on another machine through a loopback port forward
- **WHEN** an out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`

#### Scenario: Offered for a same-machine dashboard reached by a public URL

- **GIVEN** the session and the dashboard share one machine and the session reaches it through a public tunnel URL
- **WHEN** a grantable out-of-root read is gated
- **THEN** the prompt SHALL offer `Always allow <directory>`

#### Scenario: Not offered by a dashboard that cannot prove its store

- **GIVEN** the attached dashboard does not announce which grant store it writes
- **WHEN** a grantable out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny` and say the answer cannot be remembered

#### Scenario: Not offered without a local dashboard

- **GIVEN** the session is attached to a dashboard on a different machine, or to none
- **WHEN** an out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`

#### Scenario: Grant write failure still honours the approval once

- **GIVEN** the operator confirms `Always allow` and the grant cannot be recorded
- **WHEN** the gate settles
- **THEN** the call SHALL run once and the operator SHALL be told the grant was not saved

### Requirement: The gate fails closed

The call SHALL be blocked, with a reason returned to the agent, when: the operator denies or dismisses the prompt; the operator chooses always-allow and then declines or dismisses the confirmation; the prompts are not settled within the configured timeout (default 120 seconds), which SHALL bound the first prompt and the confirmation together; no interactive UI is available to ask; or the gate itself errors. A block reason SHALL be distinguishable by cause (denied, recently denied, timed out, no UI, error).

After a call is blocked because the operator denied or dismissed it or it timed out, further gated calls in the same session whose target lies in the same containing directory (the direct parent of the canonical target, whether or not it exists yet) SHALL be blocked without a prompt for 120 seconds, with the reason `recently denied`. This suppression SHALL never allow a call, and SHALL take precedence over asking, including for targets in sensitive locations.

A target inside a sensitive location (a subject the path-grant store refuses together with its descendants, such as `~/.ssh`) SHALL still be asked about, SHALL be marked as sensitive in the prompt, and SHALL offer only `Allow once` and `Deny`.

#### Scenario: Deny blocks with a reason

- **WHEN** the operator denies an out-of-root write
- **THEN** the write SHALL NOT happen and the agent SHALL receive a reason stating the operator denied it

#### Scenario: Dismissing the prompt blocks

- **WHEN** the operator dismisses an out-of-root read prompt without choosing
- **THEN** the read SHALL be blocked as denied

#### Scenario: A denied directory is not re-asked immediately

- **GIVEN** the operator denied a read of `/w/other/a.txt` in session S
- **WHEN** session S reads `/w/other/b.txt` 30 seconds later
- **THEN** the read SHALL be blocked without a prompt with the reason `recently denied`

#### Scenario: Suppression does not spread to a shared ancestor

- **GIVEN** the operator denied a write of `/w/newproj1/a.txt` in session S, where `/w/newproj1` does not exist
- **WHEN** session S writes `/w/newproj2/b.txt`
- **THEN** session S SHALL be asked

#### Scenario: Suppression is per session

- **GIVEN** the operator denied a read of `/w/other/a.txt` in session S
- **WHEN** session T reads `/w/other/a.txt`
- **THEN** session T SHALL be asked

#### Scenario: One budget covers both prompts

- **GIVEN** a timeout of 120 seconds
- **WHEN** the operator chooses always-allow after 100 seconds and leaves the confirmation open
- **THEN** the call SHALL be blocked as timed out 20 seconds later and the confirmation withdrawn

#### Scenario: Timeout blocks

- **WHEN** an out-of-root read is not answered within the timeout
- **THEN** the read SHALL be blocked, the prompt withdrawn, and the reason SHALL state it timed out

#### Scenario: Headless session blocks without asking

- **GIVEN** a session with no interactive UI
- **WHEN** an out-of-root read is gated
- **THEN** it SHALL be blocked without a prompt

#### Scenario: Sensitive location is asked about without always-allow

- **WHEN** the agent reads a file under `~/.ssh`
- **THEN** the prompt SHALL mark the location as sensitive and offer only `Allow once` and `Deny`

#### Scenario: File directly in the home directory offers no always-allow

- **WHEN** the agent reads `~/notes.txt`
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`, because the home directory is not grantable

#### Scenario: Internal error blocks

- **WHEN** the gate throws while evaluating a call
- **THEN** the call SHALL be blocked

### Requirement: The gate is on by default and can be turned off

The gate SHALL be enabled by default. A machine-level setting SHALL disable it, editable in Settings ▸ Security, and an environment variable SHALL override the setting for a process. When disabled, gated tools SHALL run exactly as without this capability. A setting change SHALL apply to running sessions from their next tool call.

#### Scenario: Disabled gate never prompts

- **GIVEN** the gate is disabled in settings
- **WHEN** the agent reads an out-of-root path
- **THEN** the tool SHALL run without a prompt

#### Scenario: Environment override

- **GIVEN** the setting enables the gate and the environment variable disables it for the process
- **WHEN** the agent reads an out-of-root path
- **THEN** the tool SHALL run without a prompt

### Requirement: In-root calls stay cheap and every outcome is observable

An in-root decision SHALL NOT require a round trip to the dashboard server, and once the session's checkout-root probe has settled its added latency SHALL stay under 1 ms at p95. Every gated call that is not in-root SHALL emit one log record naming the outcome (asked, allowed-once, allowed-always, denied, recently-denied, timeout, no-ui, error) and whether the target was sensitive, the tool, the access kind, the canonical path, and the session. In-root outcomes SHALL be counted rather than logged.

#### Scenario: In-root decision makes no server round trip

- **GIVEN** the dashboard server is unreachable
- **WHEN** the agent reads an in-root path
- **THEN** the tool SHALL run without delay

#### Scenario: Denied outcome is logged

- **WHEN** an out-of-root write is denied
- **THEN** one log record SHALL name outcome `denied`, tool `write`, the canonical path and the session
