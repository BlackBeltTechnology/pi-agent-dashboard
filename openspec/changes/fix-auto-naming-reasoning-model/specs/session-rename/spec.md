# session-rename Specification Delta

## MODIFIED Requirements

### Requirement: Automatic topic naming on terminal turn

When automatic naming is enabled, the bridge extension SHALL attempt to name an eligible session by its topic after each terminal turn (`agent_end`), until the first successful name, a permanent lockout, or exhaustion of the session's attempt budget. A session is eligible only when ALL hold: the global `autoNameSessions` preference is true, the session's `nameSource` is not `"user"`, the session has no auto-generated name yet, and the session is not permanently stopped. The first successful auto-name SHALL end all further attempts for that session.

Attempts SHALL NOT continue indefinitely. Each attempt that consumes a model completion SHALL spend one unit of a bounded per-session attempt budget; exhausting it SHALL stop naming permanently for that session.

#### Scenario: Eligible session gets named

- **WHEN** a terminal turn ends for a session that is enabled, not user-named, not yet auto-named, and not stopped
- **AND** the enough-info gate passes and the model returns a valid title
- **THEN** the bridge SHALL call `pi.setSessionName(title)` and mark `nameSource = "auto"`
- **AND** SHALL NOT attempt naming again for that session

#### Scenario: Feature disabled

- **WHEN** `autoNameSessions` is false
- **THEN** the bridge SHALL NOT call the model on any turn

#### Scenario: Already auto-named

- **WHEN** a session already has an auto-generated name
- **THEN** subsequent terminal turns SHALL NOT trigger another naming attempt

#### Scenario: Attempts are bounded

- **WHEN** a session repeatedly fails to produce an applicable title
- **THEN** the number of naming completions for that session SHALL be bounded by the attempt budget
- **AND** SHALL NOT grow with the number of terminal turns

### Requirement: Enough-info gate

The bridge SHALL apply a two-layer "enough information" gate before naming. A cheap pre-filter SHALL skip, without any model call, a candidate user message that is a pure greeting, is shorter than a configured minimum length, or is a bare slash-command. The pre-filter SHALL evaluate the most recent SUBSTANTIVE user message from the advancing transcript window, not permanently the first user message.

Past the pre-filter, the summarizer prompt SHALL instruct the model to emit the sentinel `NULL` when no topic is inferable. The bridge SHALL treat a `NULL` or over-long response as "not yet" and retry on a later turn while attempt budget remains.

An EMPTY response SHALL NOT be treated the same as `NULL`: an empty or truncated completion indicates the model could not emit a title under the requested output cap, and SHALL be classified as starvation rather than as "no topic yet".

#### Scenario: Greeting is skipped without a model call

- **WHEN** the candidate user message is `"hi"` (or matches the greeting set / is below the minimum length / is a bare slash-command)
- **THEN** the bridge SHALL NOT call the model and SHALL wait for a later turn

#### Scenario: Model returns NULL sentinel

- **WHEN** the model responds with `NULL` (or an over-length reply) for the current window
- **THEN** the bridge SHALL NOT set a name and SHALL retry on a later terminal turn while budget remains

#### Scenario: Empty response is not a NULL

- **WHEN** the model returns an empty response, or the stream is truncated by the output cap
- **THEN** the bridge SHALL classify the attempt as starvation
- **AND** SHALL NOT treat it as "no topic yet"

#### Scenario: Substantive turn after a trivial opener

- **WHEN** a session opens with a greeting, then a later turn carries real work and the model returns a valid title
- **THEN** the bridge SHALL name the session on that later turn

### Requirement: Auto-naming uses the naming role in-process

The bridge SHALL resolve the naming model to a concrete `provider/modelId` via the role resolver — consulting the `naming` role first and falling back to `@fast` when `naming` is unassigned — and call the model in-process using pi-ai's stream primitive and the model registry's credential resolution. It SHALL NOT route the naming request through the dashboard server's model-proxy.

#### Scenario: Naming role resolved and called directly

- **WHEN** the naming model resolves to an authenticatable model
- **THEN** the bridge SHALL generate the title in-process without a request to the dashboard server

#### Scenario: Fallback to the fast role

- **WHEN** the `naming` role is unassigned
- **THEN** the bridge SHALL resolve `@fast`
- **AND** the resolved reference SHALL equal the pre-change resolution
