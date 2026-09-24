## Purpose

A time-boxed mode that answers filesystem and working-directory access prompts
automatically, for an operator who is deliberately trading containment for flow
during a focused session. It exists so that the alternative — clicking
`Allow always` repeatedly until the prompt loses meaning — is not the only way to
stop being interrupted.

## ADDED Requirements

### Requirement: YOLO applies to the filesystem and working-directory planes only

While YOLO is active, a denial on the filesystem plane or the
working-directory plane that would have raised a prompt SHALL instead be
answered automatically with an allow-once verdict.

YOLO SHALL answer **the prompt**, and only the prompt. It SHALL therefore be
available only where a held prompt is available: YOLO SHALL be active only while
the Host-admission gate is in enforcing mode and the denial is prompt-eligible
and suspendable.

There SHALL be no degraded-plane YOLO. While Host admission is in reporting
mode, YOLO SHALL be unavailable: its controls SHALL render inert carrying the
same reason the Access surface states, an environment-activated session SHALL
NOT start, and no automatic verdict SHALL be produced on any plane.

An automatic verdict SHALL NOT outlive the request that raised it. A verdict
that applied to a later attempt would be an unbound allow keyed on plane and
subject, which is precisely what the allow-once requirement forbids.

YOLO SHALL NOT resurrect a request the ladder already denied, and SHALL NOT be a
rung that produces an allow where the ladder produced none.

Every other plane SHALL be completely unaffected. A network, CORS, auth, or
pairing denial SHALL behave exactly as it does with YOLO inactive, because the
requester on those planes is untrusted by definition and auto-answering for it
would not skip a prompt — it would remove the guard.

This SHALL be structural rather than a matter of configuration: a plane SHALL
declare whether it is YOLO-eligible, and a plane whose settlement mode is
deferred SHALL NOT be capable of declaring itself eligible.

The planes YOLO cannot reach are also the planes with no place to scope to: a
network source, an origin, and a paired device have no directory, so their
guards remain global and unscoped in exactly the way they are today. Directory
scope is meaningful only on the two planes whose subject **is** a path.

#### Scenario: A filesystem denial is auto-allowed while suspension is available

- **GIVEN** YOLO is active and the denial would have suspended the request
- **WHEN** a containment miss occurs that would have raised a prompt
- **THEN** it SHALL be allowed without displaying a dialog
- **AND** the original request SHALL proceed

#### Scenario: YOLO is unavailable when Host admission is not enforced

- **GIVEN** Host admission is in its reporting mode
- **WHEN** the operator opens any YOLO control, or an environment-activated session is attempted at startup
- **THEN** no YOLO session SHALL become active
- **AND** the control SHALL state the reason rather than being hidden

#### Scenario: A degraded denial is never auto-answered

- **GIVEN** Host admission is in its reporting mode and YOLO was activated earlier under enforcing mode
- **WHEN** a containment miss occurs
- **THEN** no automatic verdict SHALL be produced
- **AND** the denied request SHALL remain denied

#### Scenario: YOLO does not resurrect a denied request

- **GIVEN** YOLO is active and the degrade ladder denied a request outright
- **WHEN** the automatic verdict is applied
- **THEN** that request SHALL NOT be resumed or re-run on its behalf

#### Scenario: A network denial is unaffected

- **GIVEN** YOLO is active
- **WHEN** a network, CORS, auth, or pairing denial occurs
- **THEN** it SHALL be denied exactly as it would be with YOLO inactive

#### Scenario: A deferred plane cannot opt in

- **WHEN** a plane whose settlement mode is deferred declares itself YOLO-eligible
- **THEN** that combination SHALL be rejected rather than honoured

### Requirement: YOLO answers only requests that could have been prompted

An automatic allow SHALL be issued only for a denial that would have raised a
prompt, and SHALL require **exactly the proof that prompt would have required** —
no more and no less. A denial that could not have raised a dialog SHALL NOT be
auto-allowed.

Since the YOLO-eligible planes declare the held settlement mode, this means the
request itself SHALL carry a valid prompt capability, and Host admission SHALL
be enforcing. Nothing lowers the proof required to answer for a request.

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

### Requirement: YOLO does not bypass path resolution or the forbidden-subject rule

An automatic allow SHALL be applied at the point a prompt would have been
raised, and SHALL NOT skip any layer that runs before that point. Path
resolution, symlink resolution, and the forbidden-subject rule SHALL all still
apply.

The forbidden subjects — the filesystem root, the user's home directory,
`~/.ssh`, `~/.pi`, and the platform system directories — SHALL remain refused
while YOLO is active. YOLO SHALL NOT be capable of admitting them.

The forbidden-subject rule SHALL be a **real-path subtree relation in both
directions**, not an equality test on a directory name. A candidate SHALL be
refused when, comparing real paths, it **is** a forbidden directory, lies
**inside** one, or **contains** one. Comparison SHALL use the same
case-, normalisation- and component-aware rules the grant model defines; YOLO
SHALL NOT carry a second, weaker notion of containment. Equality alone is insufficient: a subject
naming a descendant of a forbidden directory admits that directory's contents,
and a subject naming an ancestor of one admits the forbidden directory itself.

#### Scenario: A forbidden subject is refused under YOLO

- **GIVEN** YOLO is active
- **WHEN** a denial names `~/.ssh` or a platform system directory
- **THEN** it SHALL be refused, and no automatic allow SHALL be issued

#### Scenario: A descendant of a forbidden directory is refused

- **GIVEN** YOLO is active
- **WHEN** a denial names a directory **inside** a forbidden directory
- **THEN** it SHALL be refused

#### Scenario: An ancestor containing a forbidden directory is refused

- **WHEN** a candidate subject **contains** a forbidden directory beneath it
- **THEN** it SHALL be refused rather than offered or admitted

#### Scenario: Symlink resolution still runs

- **GIVEN** YOLO is active
- **WHEN** an auto-allowed request resumes
- **THEN** the same symlink resolution the containment check performs today SHALL still be performed

### Requirement: YOLO is time-boxed and creates no persisted grant

An automatic allow SHALL be an allow-once verdict: it SHALL permit the request
that triggered it and SHALL NOT create a persisted grant. When YOLO ends, the
admitted set SHALL be exactly what it was before YOLO began, with nothing left
to revoke.

A UI-activated session SHALL carry an explicit expiry chosen at activation and
SHALL end automatically when it elapses. Activity SHALL NOT extend it; a longer
window SHALL require a fresh, explicit activation.

#### Scenario: Nothing is persisted

- **GIVEN** YOLO auto-allowed several paths
- **WHEN** YOLO ends
- **THEN** no grant SHALL exist for any of them
- **AND** the next request for each SHALL be denied again

#### Scenario: Expiry is not extended by use

- **GIVEN** a YOLO session with a chosen expiry
- **WHEN** requests are auto-allowed throughout the window
- **THEN** the session SHALL still end at the originally chosen time

#### Scenario: Ending YOLO takes effect immediately

- **WHEN** an operator ends an active YOLO session
- **THEN** the next denial SHALL be prompted or refused as though YOLO had never been active

### Requirement: A YOLO session is bounded by a set of directory roots

A YOLO session SHALL hold either a set of one or more root directories, or the
distinct unscoped state.

An automatic allow SHALL be issued only when the real path of the denied subject
lies within **at least one** root in the set. A denial outside every root SHALL
be prompted, or refused, exactly as though YOLO were inactive.

The default SHALL be the requesting session's working directory, **subject to the
same forbidden-subject rule as any other root**. Where that directory is refused
by the rule — a session started from the home directory, for example — the
default SHALL fall back to the narrowest offered root that is not refused, and
where no such root exists YOLO SHALL NOT be activatable from that surface. The
default SHALL NOT be exempt from a filter every other root must pass.

An activation that expresses no preference SHALL produce a session scoped to that
default — not an unscoped one. The unscoped state SHALL be reachable only by explicitly
choosing it, SHALL NOT be pre-selected, and SHALL be presented as distinct from
any root.

Accumulating roots SHALL NOT widen a session to unscoped. A session holding many
roots SHALL remain the union of exactly those roots, however many there are.
There SHALL be no threshold, count, or breadth at which a scoped session becomes
unscoped.

The selectable roots SHALL be the same bounded ancestor ladder a denial offers —
derived from a real path, truncated at the nearest boundary, with the
forbidden-subject filter applied to every rung. The ladder SHALL be computed by
the existing ladder rule and consumed, never recomputed with different bounds. A
root SHALL NOT be enterable as free text. When the choice follows a denial, the
ladder SHALL be that denial's; otherwise it SHALL be computed from the session's
working directory by the same rule.

A session SHALL display its roots, or that it is unscoped, wherever it displays
that it is active.

#### Scenario: A denial inside any root is auto-allowed

- **GIVEN** an active YOLO session holding several roots
- **WHEN** a YOLO-eligible denial names a path within any one of them
- **THEN** it SHALL be auto-allowed

#### Scenario: A denial outside every root is not

- **GIVEN** an active YOLO session holding several roots
- **WHEN** a YOLO-eligible denial names a path outside all of them
- **THEN** it SHALL be prompted or refused exactly as though YOLO were inactive

#### Scenario: Containment is judged on the real path

- **GIVEN** an active scoped YOLO session
- **WHEN** a denied path lies inside a root only before symlink resolution
- **THEN** it SHALL NOT be auto-allowed

#### Scenario: The default is the working directory

- **WHEN** YOLO is activated without an explicit scope choice
- **THEN** the session SHALL be scoped to the requesting session's working directory
- **AND** it SHALL NOT be unscoped

#### Scenario: A forbidden working directory is not silently accepted as the default

- **GIVEN** a session whose working directory is the home directory
- **WHEN** YOLO activation is offered
- **THEN** the home directory SHALL NOT be offered or selected as the default root

### Requirement: YOLO never reverses an explicit refusal

A subject the operator has explicitly denied SHALL NOT be auto-allowed by a later
YOLO session while that refusal is still remembered, even when the subject falls
inside a root in scope.

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

### Requirement: A root may be added to a live session without extending it

An operator SHALL be able to add a root to an already-active YOLO session, so
that encountering a second working area does not require tearing the session down
and re-activating it.

Adding a root SHALL NOT extend the session's expiry. The session SHALL still end
at the time fixed by its original activation.

An added root SHALL be drawn from the same offered ladder and SHALL be subject to
the same forbidden-subject rule as a root chosen at activation. Adding a root
SHALL NOT be a path to the unscoped state.

Each added root SHALL be recorded with the time it was added, and SHALL appear in
the session's displayed roots.

#### Scenario: Adding a root does not extend the timer

- **GIVEN** an active YOLO session with a remaining duration
- **WHEN** a root is added
- **THEN** the session SHALL still end at the originally fixed time

#### Scenario: An added root takes effect immediately

- **GIVEN** an active YOLO session
- **WHEN** a root is added
- **THEN** a subsequent denial within that root SHALL be auto-allowed

#### Scenario: Adding cannot reach the unscoped state

- **GIVEN** an active scoped YOLO session
- **WHEN** roots are added
- **THEN** the session SHALL remain scoped
- **AND** becoming unscoped SHALL require a fresh, explicit activation

### Requirement: YOLO is activated explicitly, by environment or by the operator

YOLO SHALL be inactive unless explicitly activated. Two activation paths SHALL
exist:

1. An environment variable, for deployments where an operator's browser connects
   but no one should be interrupted — a kiosk or an all-in-one container image —
   active for the life of the process and **without** an expiry, because such a
   deployment has no operator to re-activate it.

   The variable's name and the syntax for supplying one root, several roots, and
   the explicit unscoped value SHALL be specified, including how a value is
   separated on platforms where a path may itself contain the separator. An
   unparseable value SHALL leave YOLO inactive rather than partially applied.
   Resolved: the variable is `PI_DASHBOARD_GRANT_YOLO`. One root is a plain
   absolute path; several roots are a JSON array of absolute paths
   (`["/a","/b"]`), because a path may itself contain any single separator; the
   literal `unscoped` is the explicit opt-out. Every root SHALL be absolute.
   Any other value, including `1`, `true`, a relative path, an empty array, or
   malformed JSON, SHALL be treated as unparseable.

   This SHALL NOT be read as granting access to headless automation. Automation
   holds no prompt capability, so it raises no prompt and therefore has no prompt
   for YOLO to answer. The environment variable removes interruption; it does not
   widen what a non-browser client may reach. It SHALL accept a root
   directory to scope the session, and SHALL treat an explicit unscoped value as
   the deliberate opt-out of scoping.
2. An operator control in the dashboard, which SHALL require choosing a duration
   from **15 minutes, 30 minutes, or 1 hour**. No unbounded or
   "until I stop it" option SHALL be offered to an operator: a session an
   operator can forget indefinitely is the failure mode the fixed timer exists
   to prevent. (Environment activation remains the deliberate exception and
   lasts the process lifetime, because a container has no operator to re-arm
   it.) The control SHALL require choosing a duration,
   SHALL default its scope to the session's working directory, and SHALL
   auto-expire.

The environment variable SHALL accept more than one root.

A root supplied by environment SHALL be subjected to the same forbidden-subject
rule as any other subject. If any supplied root is refused, or does not resolve,
YOLO SHALL remain **inactive** — it SHALL NOT silently fall back to unscoped, and
SHALL NOT silently activate with the surviving subset.

YOLO SHALL be independent of the prompt-suppression switch: suppressing prompts
means no dialog is raised, while YOLO means the answer is automatic. When both
are in effect, denials on YOLO-eligible planes SHALL be auto-allowed and no
dialog SHALL be raised.

#### Scenario: Default state

- **WHEN** neither activation path has been used
- **THEN** YOLO SHALL be inactive and every guard SHALL behave as today

#### Scenario: Environment activation has no expiry

- **GIVEN** the environment variable is set
- **WHEN** the process runs for an extended period
- **THEN** YOLO SHALL remain active until the process ends

#### Scenario: Environment activation does not help headless automation

- **GIVEN** the environment variable is set and no browser is connected
- **WHEN** a non-browser client's request is denied by containment
- **THEN** it SHALL remain denied

#### Scenario: Operator activation requires a duration

- **WHEN** an operator activates YOLO from the dashboard
- **THEN** a duration SHALL be required
- **AND** the scope SHALL default to the session's working directory
- **AND** the session SHALL end when the duration elapses

#### Scenario: An unusable environment root fails closed

- **GIVEN** the environment variable names several roots and one is forbidden or does not resolve
- **WHEN** the server starts
- **THEN** YOLO SHALL be inactive
- **AND** it SHALL NOT fall back to an unscoped session
- **AND** it SHALL NOT activate with the roots that did resolve

### Requirement: YOLO is activatable from each surface where it is wanted

YOLO SHALL be activatable from three surfaces, each pre-supplying what it already
knows, so that reaching for it never requires navigating away from the situation
that prompted it:

1. **The Access settings page** — the full control: duration, scope ladder, and
   the explicit unscoped choice.
2. **The grant dialog itself** — an inline action offering to stop asking for a
   bounded period. Its scope ladder SHALL be the ladder that denial already
   carries, and the narrowest rung SHALL be pre-selected. This SHALL NOT be
   presented as a fourth verdict alongside allow-once, allow-always and deny; the
   denial in hand SHALL still be answered explicitly.
3. **The directory settings page** — an action scoped to that directory, with the
   directory pre-selected as the root.

Every surface SHALL write to the same single YOLO session state. Activating from
one surface SHALL be visible from the others. There SHALL NOT be per-directory
YOLO state stored separately from the global session.

Where a surface offers activation while a session is already active, it SHALL
offer adding its root to that session rather than starting a second one, and
SHALL state that doing so does not extend the timer.

#### Scenario: Activating from a prompt uses that denial's ladder

- **GIVEN** a grant dialog for a filesystem denial
- **WHEN** the operator activates YOLO from it
- **THEN** the offered roots SHALL be that denial's ancestor ladder
- **AND** the denial in hand SHALL still require an explicit verdict

#### Scenario: Activating from a directory page pre-selects that directory

- **WHEN** the operator activates YOLO from a directory settings page
- **THEN** that directory SHALL be the pre-selected root

#### Scenario: All surfaces share one session

- **GIVEN** YOLO was activated from a directory settings page
- **WHEN** the Access settings page is opened
- **THEN** it SHALL show that same active session, not a separate one

#### Scenario: A second surface adds rather than restarts

- **GIVEN** an active YOLO session
- **WHEN** the operator activates YOLO from another directory
- **THEN** that directory SHALL be added to the existing session
- **AND** the expiry SHALL NOT be extended

### Requirement: An active YOLO session is unmissable and fully recorded

While YOLO is active, an indicator naming the remaining time SHALL be displayed,
without requiring navigation to a settings surface, on:

- the sidebar header's app-level control row, alongside the other persistent
  app-level indicators, so that it is present on every route where that row is
  visible. It SHALL be compact, SHALL indicate that YOLO is active and the
  remaining time, and SHALL lead to the surface where the session can be ended;
- every session surface whose working directory lies within a root in scope, and
  every session surface when the session is unscoped; and
- the Access settings page, which SHALL additionally name the affected planes and
  every root in scope, and SHALL carry the control to end the session
  immediately.

No indicator SHALL be dismissible while YOLO is active.

Where the sidebar header is not visible, the session-surface indicator SHALL
remain the operator's signal; the indicator SHALL NOT be rendered only in the
sidebar.

An unscoped session SHALL be visually distinguished from a scoped one, since the
difference between "this folder" and "this disk" is the entire point of the
choice.

Every automatic allow SHALL be recorded with its plane and subject and SHALL be
listed in the Access surface, so the set of paths reached during a YOLO session
is reviewable after it ends.

#### Scenario: The indicator is always visible

- **GIVEN** YOLO is active
- **WHEN** the dashboard is displayed
- **THEN** the sidebar header SHALL show a compact active-YOLO indicator with the remaining time
- **AND** every session surface within a root in scope SHALL show an indicator with the remaining time
- **AND** the Access page SHALL name the affected planes and every root in scope
- **AND** an unscoped session SHALL be distinguishable from a scoped one, and SHALL indicate on every session surface
- **AND** no indicator SHALL be dismissible

#### Scenario: The indicator survives a collapsed sidebar

- **GIVEN** YOLO is active and the sidebar header is not visible
- **WHEN** a session surface within a root in scope is displayed
- **THEN** it SHALL still show that YOLO is active and the remaining time

#### Scenario: Auto-allows are reviewable afterwards

- **GIVEN** a YOLO session auto-allowed several subjects
- **WHEN** the session has ended
- **THEN** the Access surface SHALL list what was auto-allowed, distinguished from operator-answered verdicts

#### Scenario: Every auto-allow is logged

- **WHEN** a denial is auto-allowed
- **THEN** it SHALL be recorded with the plane, the subject, and the fact that no human answered
