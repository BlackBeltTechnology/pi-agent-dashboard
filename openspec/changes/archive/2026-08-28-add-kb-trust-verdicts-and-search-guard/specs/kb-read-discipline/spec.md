## ADDED Requirements

### Requirement: A guard observes search chains that bypass the kb tools
The kb extension SHALL count consecutive search actions taken without any knowledge-access call, and SHALL surface a nudge once that chain reaches 3. Search actions SHALL include raw-search tool calls and bash commands in which any segment split on `|`, `||`, `;`, or a newline leads with a file-search binary. Bash that does not lead with a search binary in any segment SHALL NOT count.

#### Scenario: A source-grep chain fires the guard
- **WHEN** three consecutive search actions occur with no intervening knowledge access
- **THEN** the agent SHALL receive a nudge naming the kb call to run instead

#### Scenario: Non-search bash never counts
- **WHEN** the agent runs a build, test, or echo command
- **THEN** the chain counter SHALL be unaffected

#### Scenario: Piped search counts
- **WHEN** a bash command contains a segment, split on `|`, `||`, `;`, or newline, that leads with a file-search binary
- **THEN** it SHALL count as a search action

#### Scenario: Or-chained and multi-line search counts
- **WHEN** a bash command contains `rg x || true` or a search binary on its own line
- **THEN** it SHALL count as a search action

### Requirement: Only knowledge access resets the chain
The chain SHALL reset when the agent consults knowledge: a kb retrieval tool call (`kb_search`, `kb_neighbors`, `kb_get`), or a bash command invoking the kb CLI — the discipline's own recommended path must reset, or compliant agents receive false nudges. Edits, writes, and other non-retrieval actions SHALL NOT reset it. A reset SHALL be clean-slate, clearing both the chain counter and the accumulated firing count, and SHALL be processed before the action itself is counted.

#### Scenario: A kb call clears the chain
- **WHEN** the agent calls a kb retrieval tool or invokes the kb CLI via bash
- **THEN** the chain counter and the firing count SHALL both return to zero

#### Scenario: An empty-query kb call still resets
- **WHEN** the agent calls `kb_search` with an empty query
- **THEN** the chain SHALL reset — an attempt to consult is a consult

#### Scenario: An interleaved edit does not clear the chain
- **WHEN** the agent edits a file between two search actions
- **THEN** the chain counter SHALL continue accumulating

### Requirement: The nudge ladder escalates, and blocking is opt-in
The guard SHALL escalate across repeat firings within a session: the first firing warns, the second escalates, and the third blocks a search tool call. Blocking SHALL be supported but SHALL NOT be the default mode; the default mode SHALL be advisory. An environment-variable override SHALL be able to select a weaker mode but SHALL NOT be able to enable blocking.

#### Scenario: Second firing escalates
- **WHEN** the guard fires a second time in a session with no intervening knowledge access
- **THEN** the message SHALL escalate beyond the first warning

#### Scenario: Advisory mode never blocks
- **WHEN** the guard is configured in advisory mode and fires repeatedly
- **THEN** no tool call SHALL be blocked

#### Scenario: The shipped default is advisory
- **WHEN** no guard mode is configured
- **THEN** the effective mode SHALL be advisory
- **AND** no tool call SHALL be blocked without explicit configuration

#### Scenario: Blocking mode is reachable only by configuration
- **WHEN** blocking mode is explicitly configured in the config file and the ladder is exhausted
- **THEN** the offending search tool call SHALL be blocked with a reason naming the kb call to run first

#### Scenario: An env override cannot enable blocking
- **WHEN** the environment selects `block` for the guard while the config file does not
- **THEN** the effective mode SHALL NOT be blocking
- **AND** the environment override SHALL remain able to select `off` or `warn`

### Requirement: The agent can suspend the guard itself
The extension SHALL expose a tool letting the agent suspend guard enforcement for a bounded number of model turns without human approval. The suspension SHALL be clamped to the range 1–20 turns, SHALL decrement once per model turn, and SHALL restore enforcement from a clean slate on expiry.

#### Scenario: Suspension silences the guard
- **WHEN** the agent suspends the guard and then takes several search actions
- **THEN** no warning, escalation, or block SHALL be produced

#### Scenario: Out-of-range requests are clamped or rejected
- **WHEN** the agent requests a suspension outside the supported range
- **THEN** the request SHALL be clamped to the range, and a non-positive or non-numeric request SHALL leave the guard unchanged

#### Scenario: Re-suspending never shortens an active pause
- **WHEN** the agent suspends the guard again while a longer suspension is active
- **THEN** the longer remaining suspension SHALL be kept

#### Scenario: Expiry restores a clean slate
- **WHEN** a suspension expires
- **THEN** enforcement SHALL resume with the chain counter and firing count at zero

### Requirement: The guard degrades silently
Any failure inside the guard SHALL leave tool calls and tool results unmodified.

#### Scenario: Guard failure does not corrupt a tool result
- **WHEN** the guard throws while evaluating a tool call
- **THEN** the tool call SHALL proceed and its result SHALL be returned unmodified

### Requirement: Runtime enforcement may replace per-turn pressure, never per-turn routing
Where the guard is active, the compliance-pressure portion of the per-turn READ doctrine MAY be reduced, because the guard delivers it at the moment of violation. The routing portion — which kb call to run, which retrieval lane to select, and which corpus each tool indexes — SHALL be retained in the per-turn doctrine regardless of guard status, because a violation-time nudge cannot carry it.

#### Scenario: Routing survives any trim
- **WHEN** the per-turn READ doctrine is reduced on the strength of runtime enforcement
- **THEN** the tool-substitution rows, the retrieval-lane selection rule, and the corpus boundaries SHALL remain present
- **AND** the fall-through rule SHALL remain present

#### Scenario: A surface the guard cannot observe keeps its doctrine
- **WHEN** an agent surface exists where the guard's hooks do not fire
- **THEN** the per-turn doctrine for that surface SHALL NOT be reduced

#### Scenario: Seeded projects keep the full doctrine
- **WHEN** `project-init` seeds a project
- **THEN** the seeded READ discipline SHALL carry the full table irrespective of whether the guard ships, because a seeded project may never install the kb extension

### Requirement: Reducing per-turn doctrine is gated on a measured result
Any reduction of the per-turn READ doctrine justified by runtime enforcement SHALL be gated on a non-inferiority result from the context-injection A/B harness, not on an unmeasured assumption that the guard substitutes for the prose.

#### Scenario: A trim without a measurement is not permitted
- **WHEN** a reduction of the per-turn READ doctrine is proposed
- **THEN** it SHALL cite an A/B result over a task battery comparing the trimmed and untrimmed doctrine

#### Scenario: An inconclusive result trims nothing
- **WHEN** the A/B result is inferior or inconclusive
- **THEN** the per-turn doctrine SHALL be left unchanged

### Requirement: The substitution table names the trust verdicts
The READ discipline table SHALL state what a returned trust verdict means for the agent's next action, so a labelled hit resolves to a decision rather than to a re-derivation.

#### Scenario: Stale and gone hits route to an action
- **WHEN** an agent reads the READ discipline
- **THEN** it states that a stale or gone verdict means the row must be verified against source before it is acted on
- **AND** it states that a fresh verdict may be acted on without re-reading the source
