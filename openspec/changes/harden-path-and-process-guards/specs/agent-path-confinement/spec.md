## MODIFIED Requirements

### Requirement: The gate fails closed

The call SHALL be blocked, with a reason returned to the agent, when: the operator denies or dismisses the prompt; the operator chooses always-allow and then declines or dismisses the confirmation; the prompts are not settled within the configured timeout (default 120 seconds), which SHALL bound the first prompt and the confirmation together; no interactive UI is available to ask; a live YOLO session reports that the subject carries a remembered refusal; or the gate itself errors. A block reason SHALL be distinguishable by cause (denied, recently denied, timed out, no UI, refused by a remembered refusal under YOLO, error). A failure to obtain a YOLO answer from the dashboard server (error, timeout, disconnect, unsupported server) SHALL NOT count as the gate erroring: the gate SHALL continue with the ordinary prompt.

After a call is blocked because the operator denied or dismissed it or it timed out, further gated calls in the same session whose target lies in the same containing directory (the direct parent of the canonical target, whether or not it exists yet) SHALL be blocked without a prompt for 120 seconds, with the reason `recently denied`. This suppression SHALL never allow a call, and SHALL take precedence over asking, including for targets in sensitive locations. It SHALL also take precedence over asking the server for a YOLO answer, except for a grantable, non-sensitive target when a live YOLO session answers it (see the YOLO requirement); a timed-out prompt is overridable that way, an operator Deny is not (the server holds it as a remembered refusal).

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

#### Scenario: A recent timeout does not block a live YOLO session
- **GIVEN** a prompt for `/w/other/a.txt` in session S timed out 30 seconds ago and an unscoped YOLO session is then activated
- **WHEN** session S writes `/w/other/b.txt`
- **THEN** the call SHALL proceed with a `yolo-allowed` record and no prompt

#### Scenario: A recent Deny stays refused under YOLO
- **GIVEN** the operator answered `Deny` for `/w/other/a.txt` in session S (reported and remembered by the server) and an unscoped YOLO session is then activated
- **WHEN** session S writes `/w/other/b.txt` within 120 seconds
- **THEN** the call SHALL be blocked as `yolo-refused`, not auto-allowed

#### Scenario: A recent denial still blocks a sensitive target under YOLO
- **GIVEN** the operator denied or timed out a prompt for a sensitive target and an unscoped YOLO session is live
- **WHEN** the agent retries under the same directory within 120 seconds
- **THEN** the call SHALL be blocked as recently denied and the server SHALL NOT be asked

### Requirement: A live YOLO session answers the out-of-root prompt

When an out-of-root `read`, `write` or `edit` call would raise a prompt, the gate
SHALL first ask (before the recent-denial suppression, for a grantable, non-sensitive target) the dashboard server whether a live YOLO session answers it. If
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
- access under the same subject was denied or timed out moments ago AND the
  target is a sensitive location or an ungrantable subject — the call SHALL be
  blocked as recently denied;
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

- **GIVEN** an unscoped YOLO session is live and the operator denied access under a sensitive or ungrantable subject moments ago
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
