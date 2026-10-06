## RENAMED Requirements

- FROM: `### Requirement: YOLO applies to the filesystem and working-directory planes only`
- TO: `### Requirement: YOLO applies to the filesystem and working-directory planes and the agent path gate only`

## MODIFIED Requirements

### Requirement: YOLO applies to the filesystem and working-directory planes and the agent path gate only

While YOLO is active, a denial on the filesystem plane or the
working-directory plane that would have raised a prompt SHALL instead be
answered automatically with an allow-once verdict. While YOLO is active, an
out-of-root agent tool call that the agent path gate would have prompted for
SHALL likewise be answered automatically with an allow-once verdict, subject to
the carve-outs defined by the agent path confinement capability.

YOLO SHALL answer **the prompt**, and only the prompt. It SHALL therefore be
available only where a held prompt is available: YOLO SHALL be active only while
the Host-admission gate is in enforcing mode and the denial is prompt-eligible
and suspendable. For the agent path gate, "prompt-eligible" means the gate
would have raised a prompt in the session's own interactive channel; a call the
gate would block without asking SHALL NOT be auto-answered.

There SHALL be no degraded-plane YOLO. While Host admission is in reporting
mode, YOLO SHALL be unavailable: its controls SHALL render inert carrying the
same reason the Access surface states, an environment-activated session SHALL
NOT start, and no automatic verdict SHALL be produced on any plane or by the
agent path gate.

An automatic verdict SHALL NOT outlive the request that raised it. A verdict
that applied to a later attempt would be an unbound allow keyed on plane and
subject, which is precisely what the allow-once requirement forbids.

YOLO SHALL NOT resurrect a request the ladder already denied, and SHALL NOT be a
rung that produces an allow where the ladder produced none.

The server SHALL remain the sole authority for whether YOLO answers: session
liveness, expiry, scope, the forbidden rule and recording SHALL be evaluated by
the dashboard server at the moment of the request. A component that cannot
obtain the server's answer SHALL behave as if YOLO were inactive.

Every other plane SHALL be completely unaffected. A network, CORS, auth, or
pairing denial SHALL behave exactly as it does with YOLO inactive, because the
requester on those planes is untrusted by definition and auto-answering for it
would not skip a prompt — it would remove the guard.

This SHALL be structural rather than a matter of configuration: a plane SHALL
declare whether it is YOLO-eligible, and a plane whose settlement mode is
deferred SHALL NOT be capable of declaring itself eligible. The agent path gate
is eligible by this requirement, not by configuration.

The planes YOLO cannot reach are also the planes with no place to scope to: a
network source, an origin, and a paired device have no directory, so their
guards remain global and unscoped in exactly the way they are today. Directory
scope is meaningful only on the surfaces whose subject **is** a path: the two
path planes and the agent path gate.

#### Scenario: A filesystem denial is auto-allowed while suspension is available

- **GIVEN** YOLO is active and the denial would have suspended the request
- **WHEN** a containment miss occurs that would have raised a prompt
- **THEN** it SHALL be allowed without displaying a dialog
- **AND** the original request SHALL proceed

#### Scenario: An agent path-gate prompt is auto-allowed

- **GIVEN** YOLO is active and unscoped
- **WHEN** an agent `write` targets a non-sensitive path outside the session's roots
- **THEN** the call SHALL proceed without a prompt
- **AND** no grant SHALL be persisted

#### Scenario: YOLO is unavailable when Host admission is not enforced

- **GIVEN** Host admission is in its reporting mode
- **WHEN** the operator opens any YOLO control, or an environment-activated session is attempted at startup
- **THEN** no YOLO session SHALL become active
- **AND** the control SHALL state the reason rather than being hidden

#### Scenario: A degraded denial is never auto-answered

- **GIVEN** Host admission is in its reporting mode and YOLO was activated earlier under enforcing mode
- **WHEN** a containment miss occurs, or the agent path gate would prompt
- **THEN** no automatic verdict SHALL be produced
- **AND** the denied request SHALL remain denied, or the prompt SHALL be raised

#### Scenario: YOLO does not resurrect a denied request

- **GIVEN** YOLO is active and the degrade ladder denied a request outright
- **WHEN** the automatic verdict is applied
- **THEN** that request SHALL NOT be resumed or re-run on its behalf

#### Scenario: Server unreachable means no YOLO

- **GIVEN** YOLO is active on the server
- **WHEN** the agent path gate cannot obtain the server's answer within its budget
- **THEN** the gate SHALL behave as if YOLO were inactive and prompt as usual

#### Scenario: A network denial is unaffected

- **GIVEN** YOLO is active
- **WHEN** a network, CORS, auth, or pairing denial occurs
- **THEN** it SHALL be denied exactly as it would be with YOLO inactive

#### Scenario: A deferred plane cannot opt in

- **WHEN** a plane whose settlement mode is deferred declares itself YOLO-eligible
- **THEN** that combination SHALL be rejected rather than honoured

### Requirement: An active YOLO session is unmissable and fully recorded

While YOLO is active, an indicator naming the remaining time SHALL be displayed,
without requiring navigation to a settings surface, on:

- the sidebar header's app-level control row, alongside the other persistent
  app-level indicators, so that it is present on every route where that row is
  visible. It SHALL be compact, SHALL indicate that YOLO is active and the
  remaining time, and SHALL lead to the surface where the session can be ended;
- every session surface whose working directory lies within a root in scope, and
  every session surface when the session is unscoped; and
- the Access settings page, which SHALL additionally name the affected planes,
  the agent path gate, and every root in scope, and SHALL carry the control to
  end the session immediately.

No indicator SHALL be dismissible while YOLO is active.

Indicator copy SHALL describe what YOLO actually covers (agent and dashboard
file access); it SHALL NOT claim coverage of anything YOLO does not answer.

Where the sidebar header is not visible, the session-surface indicator SHALL
remain the operator's signal; the indicator SHALL NOT be rendered only in the
sidebar.

An unscoped session SHALL be visually distinguished from a scoped one, since the
difference between "this folder" and "this disk" is the entire point of the
choice.

Every automatic allow SHALL be recorded with its plane (or the agent path gate)
and subject and SHALL be listed in the Access surface, so the set of paths
reached during a YOLO session is reviewable after it ends. Agent path-gate
auto-allows SHALL count toward the same cumulative auto-allow total reported by
the health endpoint.

#### Scenario: The indicator is always visible

- **GIVEN** YOLO is active
- **WHEN** the dashboard is displayed
- **THEN** the sidebar header SHALL show a compact active-YOLO indicator with the remaining time
- **AND** every session surface within a root in scope SHALL show an indicator with the remaining time
- **AND** the Access page SHALL name the affected planes, the agent path gate, and every root in scope
- **AND** an unscoped session SHALL be distinguishable from a scoped one, and SHALL indicate on every session surface
- **AND** no indicator SHALL be dismissible

#### Scenario: The indicator survives a collapsed sidebar

- **GIVEN** YOLO is active and the sidebar header is not visible
- **WHEN** a session surface within a root in scope is displayed
- **THEN** it SHALL still show that YOLO is active and the remaining time

#### Scenario: Auto-allows are reviewable afterwards

- **GIVEN** a YOLO session auto-allowed several subjects, including agent tool calls
- **WHEN** the session has ended
- **THEN** the Access surface SHALL list what was auto-allowed, distinguished from operator-answered verdicts
- **AND** agent path-gate entries SHALL be labelled as such

#### Scenario: Every auto-allow is logged

- **WHEN** a denial or an agent path-gate prompt is auto-allowed
- **THEN** it SHALL be recorded with the plane (or agent path gate), the subject, and the fact that no human answered
- **AND** the health endpoint's cumulative auto-allow count SHALL increase by one

### Requirement: YOLO answers only requests that could have been prompted

An automatic allow SHALL be issued only for a denial that would have raised a
prompt, and SHALL require **exactly the proof that prompt would have required** —
no more and no less. A denial that could not have raised a dialog SHALL NOT be
auto-allowed.

Since the YOLO-eligible planes declare the held settlement mode, this means the
request itself SHALL carry a valid prompt capability, and Host admission SHALL
be enforcing. Nothing lowers the proof required to answer for a request.

For the agent path gate, the proof its prompt would have required is the
session's own authenticated bridge connection with an interactive prompt channel
attached: the question SHALL arrive on the bridge connection of the session it
names, and the gate SHALL NOT ask when no interactive UI is attached. This proof
is held only by a running pi session's bridge; it is not obtainable by a page, a
drive-by request, or a command-line client, which continue to gain nothing from
YOLO. Host admission SHALL be enforcing for this surface too.

This keeps YOLO from becoming a remote hole: a drive-by request, a request from
an unknown page, and a request carrying no prompt capability are each denied
while YOLO is active exactly as they are while it is inactive. The cost is
stated rather than hidden: a local non-browser client — `curl`, a script, the
CLI — holds no prompt capability and therefore gains nothing from YOLO.

#### Scenario: A drive-by request is still denied under YOLO

- **GIVEN** YOLO is active
- **WHEN** a request with no valid prompt capability is denied by containment
- **THEN** it SHALL remain denied

#### Scenario: A local non-browser client is still denied under YOLO

- **GIVEN** YOLO is active
- **WHEN** a local command-line client's request is denied by containment
- **THEN** it SHALL remain denied

#### Scenario: An agent path-gate question off its session's bridge connection is refused

- **GIVEN** YOLO is active and unscoped
- **WHEN** a YOLO question for session S arrives on a connection that is not S's bridge connection
- **THEN** no automatic verdict SHALL be produced

### Requirement: YOLO never reverses an explicit refusal

A subject the operator has explicitly denied SHALL NOT be auto-allowed by a later
YOLO session while that refusal is still remembered, even when the subject falls
inside a root in scope. This applies equally to a denial given on a
YOLO-eligible plane and to a `Deny` given at the agent path gate; a refusal is
remembered for the surface it was given on. At the agent path gate, declining
the always-allow confirmation is not a refusal, since the operator was choosing
to allow.

A remembered refusal SHALL be **durable**: it SHALL survive a server restart,
and it SHALL be listed and clearable on the Access surface like any other
recorded decision. It is the one piece of persisted state this capability owns;
it grants nothing on its own, so leaving it in place across a rollback is
fail-safe.

Clearing a refusal SHALL be an explicit operator action on that surface. A
refusal SHALL NOT expire on its own, because an expiry the operator did not
choose would silently restore the auto-allow their refusal existed to prevent.

Such a denial SHALL continue to be refused without prompting, and SHALL be
recorded as refused-by-prior-refusal rather than silently auto-allowed.

An automatic verdict is a substitute for asking. It SHALL NOT be a substitute for
an answer the operator already gave.

#### Scenario: A remembered deny survives a later YOLO session

- **GIVEN** the operator explicitly denied a subject
- **AND** a YOLO session is later activated scoped to a root containing it
- **WHEN** that subject is denied again
- **THEN** it SHALL NOT be auto-allowed

#### Scenario: A remembered agent path-gate deny survives a later YOLO session

- **GIVEN** the operator answered `Deny` at the agent path gate for a subject
- **AND** a YOLO session is later activated scoped to a root containing it
- **WHEN** the agent calls a tool on that subject again
- **THEN** it SHALL NOT be auto-allowed

#### Scenario: The refusal is visible

- **WHEN** an auto-allow is withheld because of a prior refusal
- **THEN** it SHALL be recorded and distinguishable from an ordinary auto-allow

#### Scenario: The refusal survives a restart

- **GIVEN** the operator explicitly denied a subject
- **WHEN** the server restarts and a YOLO session is activated scoped to a root containing it
- **THEN** that subject SHALL still be refused rather than auto-allowed

#### Scenario: The refusal is clearable

- **WHEN** the operator clears a remembered refusal on the Access surface
- **THEN** the subject SHALL be prompted for again on its next denial

#### Scenario: Roots are offered, not invented

- **WHEN** the scope control is displayed
- **THEN** the selectable roots SHALL be exactly the offered ancestor ladder
- **AND** no free-text directory entry SHALL be available

#### Scenario: Unscoped is never the default

- **WHEN** the scope control is displayed
- **THEN** the unscoped choice SHALL be available but SHALL NOT be pre-selected

#### Scenario: Many roots never become unscoped

- **GIVEN** an active YOLO session to which many roots have been added
- **WHEN** a denial names a path outside all of them
- **THEN** it SHALL still be prompted or refused

### Requirement: YOLO does not bypass path resolution or the forbidden-subject rule

An automatic allow SHALL be applied at the point a prompt would have been
raised, and SHALL NOT skip any layer that runs before that point. Path
resolution, symlink resolution, and the forbidden-subject rule SHALL all still
apply.

The forbidden subjects — the filesystem root, the user's home directory,
`~/.ssh`, `~/.pi`, and the platform system directories — SHALL remain refused
while YOLO is active. YOLO SHALL NOT be capable of admitting them.

The forbidden-subject rule SHALL be a **real-path subtree relation**, not an
equality test on a directory name, applied exactly as the grant model applies
it. Comparing real paths, a candidate SHALL be refused when it **is** a
forbidden directory, when it **contains** one, or when it lies **inside** a
sensitive directory (`~/.ssh`, `~/.pi`). The filesystem root, the home directory
and the platform system directories are refused as themselves and as anything
containing them, but not for every descendant — every ordinary project lives
under the home directory, so a descendant rule there would make YOLO unable to
admit anything. The agent path gate additionally refuses descendants of the
platform system directories, as its own requirement defines. Comparison SHALL use
the same case-, normalisation- and component-aware rules the grant model
defines; YOLO SHALL NOT carry a second, weaker notion of containment.

#### Scenario: A forbidden subject is refused under YOLO

- **GIVEN** YOLO is active
- **WHEN** a denial names `~/.ssh` or a platform system directory
- **THEN** it SHALL be refused, and no automatic allow SHALL be issued

#### Scenario: A descendant of a forbidden directory is refused

- **GIVEN** YOLO is active
- **WHEN** a denial names a directory **inside** `~/.ssh` or `~/.pi`
- **THEN** it SHALL be refused

#### Scenario: An ancestor containing a forbidden directory is refused

- **WHEN** a candidate subject **contains** a forbidden directory beneath it
- **THEN** it SHALL be refused rather than offered or admitted

#### Scenario: Symlink resolution still runs

- **GIVEN** YOLO is active
- **WHEN** an auto-allowed request resumes
- **THEN** the same symlink resolution the containment check performs today SHALL still be performed

## ADDED Requirements

### Requirement: Scope matching resolves subjects that do not exist yet

When YOLO decides whether a subject lies within a root — on every surface it
covers — a subject that does not
yet exist on disk (for example, the target of a write that creates a new file)
SHALL be resolved through its nearest existing ancestor: the ancestor's real
path joined with the remaining, not-yet-existing segments. Symbolic links in the
existing portion SHALL be resolved before the containment test, so a link that
points outside a root SHALL NOT be in scope. The forbidden rule SHALL be applied
to the resolved subject.

#### Scenario: A new file under a root is in scope

- **GIVEN** YOLO is active with root `/work/proj`
- **WHEN** a request targets `/work/proj/data/new.json`, which does not exist yet
- **THEN** the subject SHALL be in scope and auto-allowed

#### Scenario: A new file anywhere is in scope when unscoped

- **GIVEN** YOLO is active and unscoped
- **WHEN** a request targets a non-existent, non-forbidden file
- **THEN** it SHALL be auto-allowed

#### Scenario: A symlinked ancestor pointing outside the root is not in scope

- **GIVEN** YOLO is active with root `/work/proj` and `/work/proj/link` is a symlink to `/etc`
- **WHEN** a request targets `/work/proj/link/new.conf`
- **THEN** the subject SHALL NOT be in scope

### Requirement: Agent path-gate auto-allow excludes platform system directories

In addition to the forbidden-subject rule, YOLO SHALL NOT auto-allow an agent
path-gate call whose resolved target lies inside a platform system directory
(on POSIX `/etc`, `/usr`, `/var`, `/opt`, `/bin`, `/sbin`, `/Library`, `/System`;
on Windows the system root, program-files and program-data directories),
compared by real path, component-wise. The filesystem root and the user's home
directory SHALL NOT be treated as system directories for this rule. The
operating system's temporary directory (its real path) and everything inside it
SHALL be exempt, even when it lies inside a system directory. Such a call SHALL
receive the ordinary prompt, not a block.

#### Scenario: A write inside /etc is prompted under unscoped YOLO

- **GIVEN** YOLO is active and unscoped
- **WHEN** the agent writes `/etc/cron.d/job`
- **THEN** no automatic allow SHALL be issued and the ordinary prompt SHALL be shown

#### Scenario: The OS temporary directory is exempt from the system-directory rule

- **GIVEN** YOLO is active and unscoped and the OS temporary directory resolves inside `/var`
- **WHEN** the server is asked for a YOLO answer for a new file inside the OS temporary directory
- **THEN** it SHALL answer auto-allow

#### Scenario: A home-directory project is not a system directory

- **GIVEN** YOLO is active and unscoped
- **WHEN** the agent writes a non-sensitive file under the user's home directory outside its roots
- **THEN** it SHALL be auto-allowed
