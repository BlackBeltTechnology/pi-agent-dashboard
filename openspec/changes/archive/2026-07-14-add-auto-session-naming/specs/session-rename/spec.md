## ADDED Requirements

### Requirement: Automatic topic naming on terminal turn
When automatic naming is enabled, the bridge extension SHALL attempt to name an eligible session by its topic after each terminal turn (`agent_end`). A session is eligible only when ALL hold: the global `autoNameSessions` preference is true, the session's `nameSource` is not `"user"`, and the session has no auto-generated name yet. The first successful auto-name SHALL end all further attempts for that session.

#### Scenario: Eligible session gets named
- **WHEN** a terminal turn ends for a session that is enabled, not user-named, and not yet auto-named
- **AND** the enough-info gate passes and the model returns a valid title
- **THEN** the bridge SHALL call `pi.setSessionName(title)` and mark `nameSource = "auto"`
- **AND** SHALL NOT attempt naming again for that session

#### Scenario: Feature disabled
- **WHEN** `autoNameSessions` is false
- **THEN** the bridge SHALL NOT attempt naming on any turn

#### Scenario: Already auto-named
- **WHEN** a session already has an auto-generated name
- **THEN** subsequent terminal turns SHALL NOT trigger another naming attempt

### Requirement: Enough-info gate
The bridge SHALL apply a two-layer "enough information" gate before naming. A cheap pre-filter SHALL skip, without any model call, a first user message that is a pure greeting, is shorter than a configured minimum length, or is a bare slash-command. Past the pre-filter, the summarizer prompt SHALL instruct the model to emit the sentinel `NULL` when no topic is inferable; the bridge SHALL treat a `NULL`, empty, or over-long response as "not yet" and retry on a later turn.

#### Scenario: Greeting is skipped without a model call
- **WHEN** the first user message is `"hi"` (or matches the greeting set / is below the minimum length / is a bare slash-command)
- **THEN** the bridge SHALL NOT call the model and SHALL wait for a later turn

#### Scenario: Model returns NULL sentinel
- **WHEN** the model responds with `NULL` (or empty / over-length) for the current window
- **THEN** the bridge SHALL NOT set a name and SHALL retry on a later terminal turn

#### Scenario: Substantive turn after a trivial opener
- **WHEN** a session opens with a greeting, then a later turn carries real work and the model returns a valid title
- **THEN** the bridge SHALL name the session on that later turn

### Requirement: Auto-naming uses the fast role in-process
The bridge SHALL resolve `@fast` to a concrete `provider/modelId` via the role resolver and call the model in-process using pi-ai's stream primitive and the model registry's credential resolution. It SHALL NOT route the naming request through the dashboard server's model-proxy.

#### Scenario: Fast role resolved and called directly
- **WHEN** `@fast` resolves to an authenticatable model
- **THEN** the bridge SHALL generate the title in-process without a request to the dashboard server

### Requirement: Manual rename permanently locks out auto-naming
A name change the bridge did not originate — a dashboard-initiated rename or an in-pi rename — SHALL set `nameSource = "user"` and permanently prevent auto-naming for that session. An auto-generated name SHALL set `nameSource = "auto"` and stop the naming loop but SHALL NOT count as a user lock; a later manual rename SHALL still escalate to `"user"`.

#### Scenario: Dashboard rename locks out auto
- **WHEN** the user renames a session from the dashboard
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: In-pi rename locks out auto
- **WHEN** the session name changes inside pi and the bridge did not originate that change
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: Manual rename after an auto-name
- **WHEN** a session was auto-named (`nameSource = "auto"`) and the user then renames it
- **THEN** `nameSource` SHALL become `"user"`

### Requirement: Auto-naming errors are silent on the name and surfaced as a notification
When auto-naming fails — `@fast` unconfigured, resolved to an OAuth-only provider the bridge cannot authenticate, or a model/parse error — the bridge SHALL leave the session name unchanged and SHALL emit a single notification (`auto_name_error`) carrying a human-readable reason, which the server SHALL forward to subscribers as a client toast. Hard configuration errors SHALL stop further attempts; transient model errors MAY retry on a later turn. The bridge SHALL NOT crash the session on any naming error.

#### Scenario: Fast role not configured
- **WHEN** `@fast` has no assigned model
- **THEN** the bridge SHALL not change the name, SHALL emit one `auto_name_error`, and SHALL stop attempting

#### Scenario: Fast role is OAuth-only and unauthable
- **WHEN** `@fast` resolves to an OAuth-only provider the bridge cannot authenticate
- **THEN** the bridge SHALL take the hard-error branch (one `auto_name_error`, stop) rather than crash or loop

#### Scenario: Transient model error
- **WHEN** the model call throws a transient error
- **THEN** the bridge SHALL leave the name unchanged and MAY retry on a later terminal turn
