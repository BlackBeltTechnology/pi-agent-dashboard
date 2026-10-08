## MODIFIED Requirements

### Requirement: Out-of-root path tool calls are gated before execution

When the gate is enabled, the system SHALL evaluate every `read`, `write` and `edit` tool call of a pi session before the tool executes. The target path SHALL be resolved by the same rules the tool itself applies to its path argument (including home-directory expansion, a leading `@` marker, whitespace normalisation, and resolution against the session working directory), and SHALL then be canonicalised through the real path of its nearest existing ancestor before comparison. Containment SHALL be decided component-wise, never by string prefix, with case sensitivity taken from the filesystem. A call whose canonical target lies within the session's roots SHALL proceed without a prompt. A call whose canonical target lies outside them SHALL NOT execute unless the operator allows it, or a live YOLO session the operator activated answers it as defined by the YOLO requirement of this capability. No other tool SHALL be gated by this capability.

#### Scenario: In-root read proceeds silently

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/repo/src/a.ts`
- **THEN** the tool SHALL run and no prompt SHALL be raised

#### Scenario: Out-of-root read asks first

- **GIVEN** a session whose working directory is `/w/repo` and no YOLO session is live
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

### Requirement: The operator is asked in the session's own conversation

An out-of-root call that is not answered by a live YOLO session SHALL raise a prompt in the same session's interactive prompt channel: a card in that session's chat view when a dashboard is attached, and the pi terminal UI otherwise. The prompt SHALL name the operation (read, write or edit), the canonical target path, the tool, and the session working directory. It SHALL NOT be raised as an application-wide modal. It SHALL offer `Allow once` and `Deny`, and SHALL offer `Always allow <directory>` only as defined by the always-allow requirement. No option SHALL be preselected as the default answer.

#### Scenario: Card renders in the session's chat

- **GIVEN** a dashboard attached to the session
- **WHEN** an out-of-root read is gated and no YOLO session answers it
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

### Requirement: In-root calls stay cheap and every outcome is observable

An in-root decision SHALL NOT require a round trip to the dashboard server, and once the session's checkout-root probe has settled its added latency SHALL stay under 1 ms at p95. Every gated call that is not in-root SHALL emit one log record naming the outcome (asked, allowed-once, allowed-always, yolo-allowed, yolo-refused, denied, recently-denied, timeout, no-ui, error) and whether the target was sensitive, the tool, the access kind, the canonical path, and the session. In-root outcomes SHALL be counted rather than logged. YOLO auto-allows SHALL additionally be counted.

#### Scenario: In-root decision makes no server round trip

- **GIVEN** the dashboard server is unreachable
- **WHEN** the agent reads an in-root path
- **THEN** the tool SHALL run without delay

#### Scenario: Denied outcome is logged

- **WHEN** an out-of-root write is denied
- **THEN** one log record SHALL name outcome `denied`, tool `write`, the canonical path and the session

#### Scenario: YOLO-allowed outcome is logged

- **WHEN** an out-of-root write is auto-allowed by a live YOLO session
- **THEN** one log record SHALL name outcome `yolo-allowed`, tool `write`, `sensitive=false`, the canonical path and the session

### Requirement: The gate fails closed

The call SHALL be blocked, with a reason returned to the agent, when: the operator denies or dismisses the prompt; the operator chooses always-allow and then declines or dismisses the confirmation; the prompts are not settled within the configured timeout (default 120 seconds), which SHALL bound the first prompt and the confirmation together; no interactive UI is available to ask; a live YOLO session reports that the subject carries a remembered refusal; or the gate itself errors. A block reason SHALL be distinguishable by cause (denied, recently denied, timed out, no UI, refused by a remembered refusal under YOLO, error). A failure to obtain a YOLO answer from the dashboard server (error, timeout, disconnect, unsupported server) SHALL NOT count as the gate erroring: the gate SHALL continue with the ordinary prompt.

After a call is blocked because the operator denied or dismissed it or it timed out, further gated calls in the same session whose target lies in the same containing directory (the direct parent of the canonical target, whether or not it exists yet) SHALL be blocked without a prompt for 120 seconds, with the reason `recently denied`. This suppression SHALL never allow a call, and SHALL take precedence over asking, including for targets in sensitive locations, and over asking the server for a YOLO answer.

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

#### Scenario: A remembered refusal under YOLO blocks with its own reason

- **GIVEN** a live YOLO session whose scope contains the call's target and a remembered agent-path refusal for the call's subject
- **WHEN** the call is gated
- **THEN** it SHALL be blocked without a prompt with a reason distinguishable as refused by a remembered refusal

#### Scenario: A YOLO answer failure is not a gate error

- **WHEN** obtaining the YOLO answer fails with an error
- **THEN** the call SHALL NOT be blocked as an error and the ordinary prompt SHALL be shown

## ADDED Requirements

### Requirement: A live YOLO session answers the out-of-root prompt

When an out-of-root `read`, `write` or `edit` call would raise a prompt, the gate
SHALL first ask the dashboard server whether a live YOLO session answers it. If
the server answers auto-allow, the call SHALL proceed exactly once, with no
prompt shown and nothing granted. If the server answers that the subject carries
a remembered refusal, the call SHALL be blocked without a prompt and logged as
`yolo-refused`, because an automatic verdict SHALL NOT substitute for an answer
the operator already gave. Any other answer, an error while asking, no
answer within a short fixed budget, a connected server that has not announced
support for this question, a connected server not proven to share the agent's
host, or no connected dashboard SHALL leave the ordinary prompt flow unchanged.
Same-host proof SHALL be the same proof the always-allow requirement uses (the
connected server announces the grant store the gate itself reads), because the
server evaluates paths, the forbidden rule and scope against its own
filesystem. Asking SHALL never by itself cause the call to be blocked.

The gate SHALL NOT ask the server, and SHALL behave exactly as without YOLO,
when:

- the target is a sensitive location (credentials or the agent's own control
  plane) — the prompt with its sensitive warning SHALL still be raised;
- the subject is ungrantable — today's behaviour SHALL apply;
- access under the same subject was denied by the operator moments ago — the
  call SHALL be blocked as recently denied;
- no interactive UI is attached — the call SHALL be blocked as no-ui, since
  YOLO answers only what could have been asked.

The server SHALL independently re-derive the subject from the requested path,
SHALL refuse auto-allow for a forbidden or sensitive subject, a target inside a
platform system directory (as the YOLO capability defines it), or a subject with
a remembered agent-path refusal, SHALL accept the question only from the
authenticated bridge connection of the session it names, and SHALL apply its own
session liveness, expiry and scope rules.

The YOLO question SHALL NOT wait behind another prompt of the same session: an
in-scope call SHALL be answered even while an out-of-scope prompt of that
session is open.

When the YOLO session ends or expires, the very next out-of-root call SHALL be
prompted as usual.

#### Scenario: Unscoped YOLO allows an out-of-root write without a prompt

- **GIVEN** a session with UI and an unscoped YOLO session is live
- **WHEN** the agent writes a non-sensitive file outside the session roots
- **THEN** no prompt SHALL be shown and the call SHALL proceed
- **AND** a `yolo-allowed` record SHALL be logged
- **AND** the YOLO auto-allow total SHALL increase by one

#### Scenario: Scoped YOLO with the path outside every root still prompts

- **GIVEN** a YOLO session scoped to `/work/proj`
- **WHEN** the agent reads `/other/file.txt` outside the session roots
- **THEN** the ordinary prompt SHALL be shown

#### Scenario: A sensitive path still prompts while YOLO is live

- **GIVEN** an unscoped YOLO session is live
- **WHEN** the agent reads a file under a sensitive location
- **THEN** the prompt with the sensitive warning SHALL be shown

#### Scenario: A recent denial is not overridden

- **GIVEN** an unscoped YOLO session is live and the operator denied access under a subject moments ago
- **WHEN** the agent retries a call under that subject
- **THEN** the call SHALL be blocked as recently denied

#### Scenario: No UI keeps blocking

- **GIVEN** an unscoped YOLO session is live and the session has no interactive UI
- **WHEN** the agent makes an out-of-root call
- **THEN** the call SHALL be blocked as no-ui

#### Scenario: Ending YOLO resumes prompting immediately

- **GIVEN** a YOLO session auto-allowed an out-of-root call
- **WHEN** the session is ended or expires and the agent makes another out-of-root call
- **THEN** the ordinary prompt SHALL be shown

#### Scenario: An open prompt does not delay an in-scope call

- **GIVEN** a YOLO session scoped to `/work/proj` and a gate prompt for `/other/x` is open in the session
- **WHEN** the agent writes `/work/proj/out.txt`, outside the session roots but inside the YOLO root
- **THEN** the in-scope call SHALL be allowed without waiting for the open prompt

#### Scenario: Server unreachable or silent falls back to the prompt

- **GIVEN** YOLO is live but the dashboard does not answer within the budget, the connected server never announced support, or the connected server is not proven to share the agent's host
- **WHEN** the agent makes an out-of-root call
- **THEN** the ordinary prompt SHALL be shown
- **AND** when support was never announced or same-host is not proven, the prompt SHALL be shown without waiting for the budget

#### Scenario: An error while asking falls back to the prompt

- **WHEN** asking the server fails with an error
- **THEN** the ordinary prompt SHALL be shown rather than the call being blocked

#### Scenario: A question for another session is refused

- **WHEN** a bridge connection asks for a YOLO answer naming a different session id
- **THEN** the server SHALL refuse it and record no auto-allow

### Requirement: An operator Deny at the gate is remembered durably

When the operator explicitly answers `Deny` on the gate's access prompt, or
dismisses that prompt, the bridge SHALL report the denied subject — the
directory the always-allow requirement would name for that path — together with
the path and the identity of the prompt that was answered, to the dashboard
server — only when the connected server is proven to share the agent's host, as
for the YOLO question. The server SHALL record it as a remembered refusal for the agent path
gate under the YOLO refusal rules: durable across restarts, listed and clearable
on the Access surface, never self-expiring.

A timeout SHALL NOT be recorded, because nobody answered. Declining or
dismissing the always-allow confirmation SHALL NOT be recorded, because the
operator was choosing to allow.

The server SHALL accept a report only from the authenticated bridge connection
of the session it names, and only against an access prompt of that session that
the server itself observed being raised, used at most once. It SHALL re-derive
the subject from the path and refuse the report when the result differs from
the reported subject. A report that cannot be delivered or is refused SHALL NOT
change the outcome of the denied call. A Deny given while the session's bridge is
not connected to the dashboard is not remembered durably (the server never saw
the prompt); the recent-denial suppression still applies.

Every path the bridge sends to the server for a YOLO question or a refusal
report SHALL be the gate's absolute canonical target; the server SHALL refuse a
non-absolute path.

#### Scenario: A gate Deny becomes a remembered refusal

- **GIVEN** the session's bridge is connected to the dashboard
- **WHEN** the operator denies an out-of-root write to `/other/dir/a.txt`
- **THEN** a remembered refusal for the agent path gate naming `/other/dir` SHALL be listed on the Access surface

#### Scenario: A remembered gate refusal blocks a later YOLO auto-allow

- **GIVEN** the session's bridge is connected to the dashboard, the operator denied `/other/dir/a.txt` at the gate, and the recent-denial window has elapsed
- **AND** a YOLO session is later activated whose scope contains `/other/dir`
- **WHEN** the agent writes `/other/dir/b.txt`
- **THEN** the call SHALL NOT be auto-allowed and SHALL be blocked without a prompt
- **AND** the gate SHALL log outcome `yolo-refused`
- **AND** the server SHALL record the YOLO outcome as refused-by-prior-refusal

#### Scenario: A remembered refusal does not change the gate without YOLO

- **GIVEN** a remembered agent-path refusal for `/other/dir`, no live YOLO session, and the recent-denial window has elapsed
- **WHEN** the agent writes `/other/dir/b.txt`
- **THEN** the ordinary prompt SHALL be shown

#### Scenario: A timeout is not remembered

- **WHEN** a gate prompt times out without an answer
- **THEN** no remembered refusal SHALL be recorded

#### Scenario: A declined always-allow confirmation is not remembered

- **WHEN** the operator chooses always-allow and then declines the confirmation
- **THEN** the call SHALL be blocked as denied and no remembered refusal SHALL be recorded

#### Scenario: A report without an observed prompt is refused

- **WHEN** a bridge reports a refusal naming a prompt the server never observed for that session, or reuses one already reported
- **THEN** no remembered refusal SHALL be recorded

#### Scenario: Clearing the refusal restores YOLO

- **GIVEN** a remembered agent-path refusal for `/other/dir` and the recent-denial window has elapsed
- **WHEN** the operator clears it on the Access surface and YOLO is live with scope containing `/other/dir`
- **THEN** the next out-of-root call under `/other/dir` SHALL be auto-allowed
