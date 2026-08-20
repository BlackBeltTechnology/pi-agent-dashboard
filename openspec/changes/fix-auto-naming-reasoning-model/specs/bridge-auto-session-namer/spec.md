# bridge-auto-session-namer Specification Delta

## RENAMED Requirements

- FROM: `### Requirement: In-process `@fast` title generation`
- TO: `### Requirement: In-process title generation via the naming model role`

## MODIFIED Requirements

### Requirement: Terminal-turn naming trigger

The bridge SHALL attempt to auto-name the session on each terminal agent turn while the global auto-name toggle is enabled, until the first successful name, a permanent lockout, or exhaustion of the session's attempt budget.

#### Scenario: Attempt on terminal turn

- **WHEN** the bridge observes an `agent_end` event and the auto-name toggle is enabled
- **THEN** the bridge observes the current `pi.getSessionName()` for external-rename classification
- **AND** the bridge runs one naming attempt (`maybeName`)

#### Scenario: Toggle disabled

- **WHEN** an `agent_end` event fires and the auto-name toggle is disabled
- **THEN** the bridge performs no model call
- **AND** the attempt SHALL report the `disabled` outcome

#### Scenario: Concurrency and stop guards

- **WHEN** a naming attempt is already in flight, or the session is hard-stopped and re-resolution does not clear the stop
- **THEN** the bridge returns without starting another attempt

#### Scenario: Budget exhausted

- **WHEN** the session's attempt budget is exhausted and the stop has not been cleared
- **THEN** the bridge returns without starting another attempt

### Requirement: Eligibility and pre-filter gating

The bridge SHALL attempt naming only for an eligible, un-named session, and SHALL skip trivial openers without any model call. The pre-filter SHALL evaluate the advancing transcript window rather than permanently the first user message.

#### Scenario: Eligibility gate

- **WHEN** a naming attempt runs and any of these hold: the toggle is off, the name source is `user`, or an auto-name was already applied
- **THEN** the bridge does not call the model

#### Scenario: Trivial-opener pre-filter

- **WHEN** the most recent substantive user message is a pure greeting (e.g. `hi`, `test`, `thanks`), shorter than 15 characters after trimming, or a bare slash-command
- **THEN** the bridge skips the attempt with no model call

#### Scenario: A trivial latest message does not mask a substantive session

- **GIVEN** a session whose conversation contains a substantive user message
- **WHEN** the most recent user message is a bare confirmation such as `ok` or `thanks`
- **THEN** the pre-filter SHALL select the most recent SUBSTANTIVE user message
- **AND** SHALL NOT skip the attempt merely because the latest message is trivial

### Requirement: Failure tolerance

The bridge SHALL never crash or tight-loop on naming failures: hard errors stop the session permanently and emit a one-shot error; soft errors retry on the next terminal turn without emitting an error. Soft errors SHALL report the `retrying` outcome rather than staying silent.

#### Scenario: Hard error stops permanently

- **WHEN** the naming role is unconfigured, the model reference is malformed or not found in the registry, or credentials cannot be resolved (e.g. OAuth-only provider)
- **THEN** the bridge permanently stops naming and emits a single `auto_name_error` with the reason

#### Scenario: Soft error retries

- **WHEN** the model call fails transiently (network or provider error)
- **THEN** the bridge applies no name, emits no `auto_name_error`, spends no attempt budget, and retries on the next terminal turn
- **AND** the failure reason SHALL be read from the error event's message payload rather than from a non-existent top-level field

#### Scenario: Dependencies not ready

- **WHEN** the model registry is not yet captured or pi-ai's `streamSimple` is not yet loadable
- **THEN** the bridge defers the attempt without treating it as an error, spends no budget, and retries later

#### Scenario: One-shot guard set before application

- **WHEN** a valid title is applied
- **THEN** the session is marked auto-named (`hasAutoName`, source `auto`) before `applyName` runs, so if `applyName` throws the error propagates out of `maybeName` and the one-shot guard still holds — no further attempt re-applies a name (only the `inFlight` flag resets in `finally`)

### Requirement: In-process title generation via the naming model role

The bridge SHALL generate the title by calling the **naming model** in-process using pi-ai's `streamSimple` and the model registry's credential resolution, with a bounded transcript window and an output cap that leaves headroom for reasoning tokens.

The naming model SHALL be resolved from the `naming` role, falling back to the `fast` role when `naming` is unassigned or absent. Only when BOTH roles are unconfigured SHALL the bridge hard-stop with a role-not-configured error, and that error SHALL name the role slots consulted.

The output cap SHALL be ADAPTIVE: **1024** tokens on a session's first attempt, and **2048** tokens on any attempt made after that session has recorded a `starved` verdict. A non-normative "large enough" is insufficient — measurements show 512 tokens fully consumed by reasoning, while a successful run consumed 724 reasoning tokens.

The cap is a CEILING, not a charge: a non-reasoning model SHALL continue to bill only the few tokens a title costs, so the escalation costs nothing on the common path. The bridge SHALL NOT attempt to disable reasoning at the request level, because the `streamSimple` options surface does not accept an "off" thinking level.

Credential resolution SHALL treat `ModelRegistry.getApiKeyAndHeaders()` as returning `ProviderHeaders` whose values are `string | null`, where a `null` value is a header-DELETION marker rather than an absent header. The bridge SHALL forward those markers to pi-ai unchanged and SHALL NOT coerce them to strings, drop them, or stringify them as `"null"`.

#### Scenario: Resolve the naming model role

- **WHEN** a naming attempt proceeds past the pre-filter
- **AND** the `naming` role has an assigned model
- **THEN** the bridge resolves the model reference via `lookupRole("@naming")`

#### Scenario: Fall back to the fast role

- **WHEN** a naming attempt proceeds past the pre-filter
- **AND** the `naming` role is unassigned or absent
- **THEN** the bridge SHALL resolve the model reference via `lookupRole("@fast")`
- **AND** the resulting model reference SHALL equal the pre-change resolution

#### Scenario: Neither naming nor fast configured

- **WHEN** a naming attempt proceeds past the pre-filter
- **AND** neither the `naming` role nor the `fast` role has an assigned model
- **THEN** the bridge SHALL stop naming permanently for the session
- **AND** SHALL emit a one-shot `auto_name_error` whose reason names both role slots

#### Scenario: First attempt uses the base cap

- **WHEN** the bridge makes a session's first naming attempt
- **THEN** the requested output cap SHALL be 1024 tokens
- **AND** the request SHALL NOT carry any attempt to set an "off" thinking level

#### Scenario: A starved verdict escalates the cap

- **GIVEN** a session whose previous attempt yielded a `starved` verdict
- **WHEN** the bridge makes a further naming attempt
- **THEN** the requested output cap SHALL be 2048 tokens

#### Scenario: A non-starved verdict does not escalate the cap

- **GIVEN** a session whose previous attempt yielded a `waiting` verdict on an untruncated stream
- **WHEN** the bridge makes a further naming attempt
- **THEN** the requested output cap SHALL remain 1024 tokens

#### Scenario: Bounded transcript window

- **WHEN** the bridge builds the model input
- **THEN** it sends at most one user message slice plus at most one assistant reply slice, and never the full history
- **AND** the user slice SHALL be truncated to 200 characters and the assistant slice to 2000 characters, exactly as before this change

#### Scenario: The window selects the latest substantive turn

- **WHEN** the bridge builds the transcript window
- **THEN** it SHALL select the most recent user entry carrying non-empty text, skipping tool-result-only entries
- **AND** it SHALL pair that entry with the assistant reply of the same turn

#### Scenario: The transcript window advances with the conversation

- **GIVEN** a session whose first naming attempt did not produce a title
- **WHEN** a later terminal turn triggers another attempt
- **THEN** the transcript window SHALL be built from the latest turn rather than permanently from the first
- **AND** the request SHALL NOT be byte-identical to the previous attempt's request merely because the session started the same way

#### Scenario: The pre-filter reads the same advancing window

- **GIVEN** a session whose first user message is a trivial greeting
- **WHEN** a later terminal turn carries a substantive message
- **THEN** the pre-filter SHALL evaluate the advancing window
- **AND** the session SHALL NOT be skipped forever on the strength of its opening message

#### Scenario: Advancing the window does not widen what leaves the process

- **WHEN** the window advances to a later turn
- **THEN** the number of slices sent SHALL remain at most two
- **AND** the per-slice character bounds SHALL remain 200 for the user slice and 2000 for the assistant slice

#### Scenario: Null header markers are forwarded unchanged

- **WHEN** `getApiKeyAndHeaders()` returns a headers map containing an entry whose value is `null`
- **THEN** the bridge SHALL pass that entry through to the pi-ai request unchanged
- **AND** it SHALL NOT emit the literal string `"null"` as a header value

#### Scenario: A null-only header map counts as empty

- **WHEN** `getApiKeyAndHeaders()` returns a headers map whose every value is `null`
- **THEN** the bridge's non-empty-headers check SHALL treat that map as carrying no usable headers
- **AND** it SHALL NOT be satisfied merely because the map has a non-zero key count

#### Scenario: Done-event text fallback

- **WHEN** the stream reaches the `done` event with stop reason `stop` and no `text_delta` text has accumulated
- **THEN** the bridge collects the title from the final message's text content parts (`collectText(ev.message)`)

#### Scenario: Model invocation

- **WHEN** credentials resolve for the naming model reference
- **THEN** the bridge calls `streamSimple` with the summarizer system prompt and the transcript as a single user message
- **AND** it accumulates the raw title from streamed `text_delta` events

#### Scenario: The stop reason is carried out of the model call

- **WHEN** the model call completes
- **THEN** the generation result SHALL carry the stream's normalized stop reason alongside any text
- **AND** the reason SHALL be read from the `done` event's `reason` field

### Requirement: Title parsing and one-shot application

The bridge SHALL accept only a well-formed title from an untruncated stream, apply it once via `pi.setSessionName`, mirror it to the dashboard with provenance `auto`, and then stop naming for the session.

Parsing SHALL key on the stream's stop reason BEFORE inspecting the text:

- a stream ending with stop reason `length` or `toolUse` SHALL yield a `starved` verdict and its text SHALL NOT be applied as a title under any circumstance,
- an untruncated stream carrying empty or whitespace-only text SHALL also yield a `starved` verdict,
- the `NULL` sentinel, an over-long title, or an over-wordy title SHALL yield a `waiting` verdict and retry on a later terminal turn,
- otherwise the parse SHALL yield the title.

Stop reasons `aborted` and `error` arrive on the stream's `error` event, not the `done` event, and SHALL be treated as soft errors — never as starvation. A user-initiated abort SHALL NOT contribute to any stop.

#### Scenario: Apply a valid title

- **WHEN** the stream ends with stop reason `stop` and returns a non-empty title that is not the `NULL` sentinel, is at most 40 characters, and is at most 6 words
- **THEN** the bridge records the applied title, marks the session auto-named with source `auto`, and then calls `applyName(title)` which runs `pi.setSessionName(title)` and sends a `session_name_update` with `nameSource: "auto"`

#### Scenario: Truncated text is never applied

- **GIVEN** a stream that ends with stop reason `length`
- **AND** whose accumulated text would otherwise satisfy the length and word-count guards
- **THEN** the bridge SHALL NOT apply that text as a session name
- **AND** SHALL classify the attempt as `starved`

#### Scenario: A tool-use stop is never applied

- **GIVEN** a stream that ends with stop reason `toolUse`
- **THEN** the bridge SHALL NOT apply its text as a session name

#### Scenario: An aborted call is not starvation

- **WHEN** the naming call ends with an `error` event carrying reason `aborted`
- **THEN** the bridge SHALL treat it as a soft error
- **AND** SHALL NOT count it toward the attempt budget

#### Scenario: Wait for a nameable topic

- **WHEN** the stream ends with stop reason `stop` and returns the `NULL` sentinel, a title over 40 characters, or a title over 6 words
- **THEN** the bridge applies no name and retries on a later terminal turn
- **AND** SHALL report the rejection rather than returning silently

#### Scenario: An uncooperative model reply is rejected

- **WHEN** the model ignores the summarizer prompt and returns prose longer than 40 characters
- **THEN** the bridge SHALL NOT apply it as a session name
- **AND** SHALL report a `waiting` outcome carrying the rejection reason

#### Scenario: First success is permanent

- **WHEN** an auto-name has already been applied for the session
- **THEN** the bridge attempts no further naming

## ADDED Requirements

### Requirement: A single bounded attempt budget per session

Token starvation is nondeterministic: the same input MAY starve on one attempt and succeed on the next, so a single starved attempt SHALL NOT stop a session. Equally, a `waiting` verdict SHALL NOT retry without limit, because each attempt spends a completion against a raised output ceiling.

The bridge SHALL therefore maintain ONE total attempt budget per session, shared by the `starved` and `waiting` verdicts. Any attempt that consumed a model completion SHALL spend exactly one unit of that budget. On exhaustion the bridge SHALL stop naming permanently for the session and emit exactly one `auto_name_error`.

The attempt budget SHALL be exactly **3** attempts per session.

The error reason SHALL name the role slot used, the resolved model reference, and the DOMINANT cause, and the remedy SHALL match that cause: exhaustion dominated by `starved` verdicts SHALL direct the operator to change the naming model, while exhaustion dominated by `waiting` verdicts SHALL report that no nameable topic emerged and SHALL NOT instruct the operator to change a model that was working correctly. On a TIE the `starved` cause SHALL win, because a model problem carries the more actionable remedy.

Transient stream, network, and provider errors — including an aborted call — SHALL NOT spend budget; they remain soft errors that retry.

A successful application is terminal, so no reset rule is required.

#### Scenario: The remedy matches the dominant cause

- **GIVEN** a budget exhausted predominantly by `waiting` verdicts on an untruncated, well-behaved model
- **WHEN** the bridge emits `auto_name_error`
- **THEN** the reason SHALL report that no nameable topic emerged
- **AND** SHALL NOT instruct the operator to change the naming model

#### Scenario: One starved attempt does not stop the session

- **WHEN** a single attempt yields a `starved` verdict and budget remains
- **THEN** the bridge SHALL NOT stop naming
- **AND** SHALL retry on a later terminal turn

#### Scenario: Waiting verdicts spend the same budget

- **WHEN** an attempt yields a `waiting` verdict
- **THEN** it SHALL spend one unit of the same total budget as a `starved` verdict
- **AND** a session that never produces a nameable topic SHALL NOT retry without limit

#### Scenario: Exhausting the budget stops permanently

- **WHEN** the total attempt budget is exhausted
- **THEN** the bridge SHALL stop naming permanently for the session
- **AND** SHALL emit exactly one `auto_name_error` naming the role slot, the resolved model reference, and the cause

#### Scenario: Per-session naming cost is bounded

- **WHEN** a session never yields an applicable title
- **THEN** the total number of naming completions for that session SHALL be bounded by the attempt budget
- **AND** SHALL NOT grow with the number of terminal turns

#### Scenario: Transient errors do not spend budget

- **WHEN** the model call fails with a transient stream, network, or provider error
- **THEN** the bridge SHALL treat it as a soft error, SHALL NOT spend budget, SHALL emit no `auto_name_error`, and SHALL retry on a later terminal turn

#### Scenario: The NULL sentinel does not stop the session on its own

- **GIVEN** an early turn with no nameable topic and remaining budget
- **WHEN** the model returns exactly the `NULL` sentinel on an untruncated stream
- **THEN** the bridge SHALL NOT stop naming
- **AND** SHALL retry on a later terminal turn

### Requirement: The stop is durable and clears by re-resolution

A permanent stop SHALL survive a bridge reload: the bridge SHALL NOT re-attempt naming, and SHALL NOT re-emit `auto_name_error`, for a session already stopped before the reload. The attempt budget already spent SHALL likewise survive reload, so the bound cannot be defeated by reloading.

Carried state SHALL be an explicitly enumerated set of values — the stop flag, the error-emitted flag, the attempts spent, the model reference the session stopped on, the provenance, the auto-named flag, and the last self-applied title — and SHALL NOT be carried by retaining the namer object itself, whose closures would reference a stale connection, session id, and context.

The stop SHALL clear when the RESOLVED naming model reference changes, evaluated at the next attempt and BEFORE the stop short-circuits the attempt. Clearing SHALL NOT depend on receiving a roles-change event, because a role write is routed to a single session's bridge and would never reach the other stopped sessions.

Assigning a model that resolves to the SAME reference the session stopped on SHALL NOT clear the stop, because the failing configuration is unchanged.

Clearing the stop SHALL also reset the spent attempt budget AND re-arm error emission. Without both resets the operator's remedy is vacuous: the session would retry once, immediately re-exhaust the budget, and re-stop with NO error, because the one-shot error flag was still latched.

A stop whose cause was NOT the model reference — unresolvable credentials, a model absent from the registry, or no configured role at all — SHALL also clear when that cause is resolved, even though the resolved reference is unchanged or was previously absent.

Durability SHALL span a process restart, not only an extension reload. The stop state SHALL be persisted in the session's `.meta.json` record, alongside `nameSource` — the same lifecycle, already owned by the server. This is an explicit, narrowly-scoped exception to the change's "no new persisted field" constraint: without it a restart silently re-spends a full budget, re-emits the error, and the stop is not in fact permanent.

#### Scenario: Stop survives reload

- **GIVEN** a session whose naming has been permanently stopped
- **WHEN** the bridge extension reloads
- **THEN** the bridge SHALL make no further naming attempt for that session
- **AND** SHALL NOT emit a second `auto_name_error` for the same stop

#### Scenario: Spent budget survives reload

- **GIVEN** a session that has spent part of its attempt budget
- **WHEN** the bridge extension reloads
- **THEN** the spent count SHALL be preserved
- **AND** the budget SHALL NOT reset to zero

#### Scenario: Reassigning the naming model clears the stop on every session

- **GIVEN** two stopped sessions on separate bridges
- **WHEN** the operator assigns a different model to the naming role via one of them
- **THEN** BOTH sessions SHALL clear the stop at their next attempt
- **AND** clearing SHALL NOT require the session to have handled the role write

#### Scenario: Reassigning the same effective model does not clear the stop

- **GIVEN** a session stopped on a resolved model reference
- **WHEN** the operator assigns a model that resolves to that same reference
- **THEN** the stop SHALL remain in force

#### Scenario: Clearing restores a full budget and re-arms the error

- **GIVEN** a session stopped with its attempt budget exhausted and its error already emitted
- **WHEN** the stop clears because the resolved naming reference changed
- **THEN** the spent budget SHALL reset to zero
- **AND** a subsequent exhaustion SHALL emit a new `auto_name_error`
- **AND** the session SHALL NOT re-stop after a single attempt

#### Scenario: A credential fix clears a credential-caused stop

- **GIVEN** a session stopped because credentials for the naming model could not be resolved
- **WHEN** the operator configures those credentials
- **THEN** the stop SHALL clear at the next attempt
- **AND** clearing SHALL NOT require the resolved model reference to change

#### Scenario: The stop survives a process restart

- **GIVEN** a session whose naming has been permanently stopped
- **WHEN** the pi process restarts
- **THEN** the bridge SHALL make no further naming attempt for that session
- **AND** SHALL NOT emit a further `auto_name_error` for the same stop
- **AND** SHALL NOT re-spend the attempt budget

#### Scenario: Clearing the stop does not override a user rename

- **GIVEN** a session locked out with provenance `user`
- **WHEN** the naming model is reassigned
- **THEN** the lockout SHALL remain in force

### Requirement: An in-flight naming call SHALL NOT clobber a rename or a lockout

A naming attempt awaits a model call. State observed BEFORE that await MAY be stale when it resolves: an external rename can land mid-stream and latch provenance `user`.

The bridge SHALL re-check eligibility AFTER the model call returns and BEFORE applying a title. A title SHALL NOT be applied when the session became locked out, was stopped, or was already named while the call was in flight.

The re-entrancy guard SHALL be latched BEFORE any await in the attempt path, so that two terminal turns arriving in quick succession cannot both start a model call and both spend budget.

#### Scenario: A rename during the model call wins

- **GIVEN** a naming attempt whose model call is in flight
- **WHEN** an external rename is observed before the call returns
- **THEN** the bridge SHALL NOT apply the returned title
- **AND** the provenance SHALL remain `user`
- **AND** the externally supplied name SHALL NOT be overwritten

#### Scenario: Two adjacent turns start only one call

- **WHEN** two terminal turns fire before the first attempt's model call resolves
- **THEN** only one model call SHALL be started
- **AND** only one unit of attempt budget SHALL be spent

### Requirement: Every attempt exit path reports exactly one outcome

Every naming attempt SHALL produce exactly one reported outcome, including the paths that return silently today. The outcome SHALL be one of `applied`, `waiting`, `starved`, `skipped-prefilter`, `locked-out`, `disabled`, `already-named`, `not-ready`, `retrying`, or `stopped`, carried with a human-readable reason, the resolved model reference where one exists, and the session id.

Soft errors SHALL report `retrying` and SHALL NOT be reported as `waiting`, because conflating a transient failure with "no topic yet" destroys the diagnostic value of both.

The in-flight re-entrancy guard is NOT an attempt and is exempt from this requirement.

The `disabled` outcome SHALL be reachable: the auto-naming toggle SHALL be evaluated where an outcome can be reported, not at a call site that returns before the namer is consulted.

Outcome reporting SHALL be DEDUPLICATED on the wire: an outcome SHALL be sent only when the reported outcome or its reason differs from the last one sent for that session. Terminal, non-attempting states — `already-named`, `locked-out`, `disabled` — recur on every terminal turn for the lifetime of a session, so unconditional reporting would trade a bounded model cost for an unbounded wire and retention cost.

#### Scenario: Unchanged outcomes are not resent

- **GIVEN** a session whose last reported outcome was `already-named`
- **WHEN** further terminal turns produce the same outcome and reason
- **THEN** the bridge SHALL NOT send a further outcome message for those turns

#### Scenario: A changed outcome is sent

- **GIVEN** a session whose last reported outcome was `waiting`
- **WHEN** an attempt produces `starved`
- **THEN** the bridge SHALL send the new outcome

#### Scenario: Pre-filter skip is reported

- **WHEN** an attempt is skipped by the trivial-opener pre-filter
- **THEN** the bridge SHALL report outcome `skipped-prefilter`

#### Scenario: Dependencies not ready is reported

- **WHEN** an attempt returns early because the model registry or `streamSimple` is not yet available
- **THEN** the bridge SHALL report outcome `not-ready`

#### Scenario: Soft error is reported distinctly

- **WHEN** an attempt ends in a transient model or network error
- **THEN** the bridge SHALL report outcome `retrying`
- **AND** SHALL NOT report `waiting` for that attempt

#### Scenario: Disabled and already-named paths are reported

- **WHEN** an attempt returns early because the auto-naming toggle is off, or because the session is already auto-named
- **THEN** the bridge SHALL report outcome `disabled` or `already-named` respectively

#### Scenario: Hard stop is reported

- **WHEN** an attempt hard-stops for any reason
- **THEN** the bridge SHALL report outcome `stopped` with the same reason carried by `auto_name_error`
