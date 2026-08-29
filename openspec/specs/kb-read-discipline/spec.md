# kb-read-discipline Specification

## Purpose

Steer agents to the `kb_*` tools before raw source search. The docs-first READ
discipline is expressed as a mechanical tool-substitution table (reflex → exact
`kb_*` command) in the root `AGENTS.md` and in the `project-init` seeded
doctrine, so agents reflex-run the cheap kb call instead of grepping source.
Established by change `steer-agents-to-kb-tools` after measured under-use of the
kb surface (grep/rg dominating `kb_search` ~10:1, mostly symbol lookups).
## Requirements
### Requirement: The READ discipline is a mechanical tool-substitution table

The docs-first READ discipline SHALL be expressed as a tool-substitution table
that maps a raw-search reflex (`grep`/`rg`/`cat`/`Read`) to the exact `kb_*`
invocation to run first, rather than as prose. The table SHALL name the
symbol-lookup case explicitly and SHALL present `kb_neighbors` and `kb_get` as
the follow-through after `kb_search`.

#### Scenario: Symbol-lookup row exists with an exact command
- **WHEN** an agent reads the root `AGENTS.md` READ discipline
- **THEN** a table row maps "find where a function / type / const lives" to `kb_search --doc-type agents "<Symbol>"`
- **AND** the row states the tree indexes key exported symbols per file

#### Scenario: Chain-through tools are named
- **WHEN** the READ discipline table is present
- **THEN** it includes a row routing "chase imports / callers" to `kb_neighbors`
- **AND** a row routing "read one doc section in full" to `kb_get`

#### Scenario: Framing leads with cost, not compliance
- **WHEN** the READ discipline is rendered
- **THEN** it presents the kb-first rule as faster/cheaper with the exact command
- **AND** it does not rely on "STOP" / "you violated the protocol" scare framing to carry the rule

### Requirement: Fall-through to raw search stays explicit and loops back

The substitution table SHALL preserve an explicit fall-through: raw `rg` / source
read is permitted when the tree misses, and the agent SHALL then add the missing
row per the WRITE discipline. The table SHALL NOT read as "kb replaces grep."

#### Scenario: Tree miss permits grep then requires a row
- **WHEN** `kb_search` returns nothing relevant for a lookup
- **THEN** the discipline permits `rg` / source read as the fall-through
- **AND** it directs the agent to add the missing `AGENTS.md` row afterward

### Requirement: New projects inherit the substitution table

The `project-init` seeded READ discipline SHALL carry the substitution table. The
kb-wired variant (`dox:read:kb`) SHALL use `kb agents` / `kb_search`; the manual
variant (`dox:read:manual`) SHALL carry a degraded same-shape table that walks
the directory `AGENTS.md` chain instead of calling `kb_search`.

#### Scenario: kb-wired seed carries the table
- **WHEN** `project-init` seeds a project whose kb toolset is wired
- **THEN** the root `AGENTS.md` READ block contains the substitution table using `kb agents` / `kb_search`

#### Scenario: Manual seed carries a degraded table
- **WHEN** `project-init` seeds a project without the kb toolset
- **THEN** the root `AGENTS.md` READ block contains a same-shape table whose lookup rows walk the directory `AGENTS.md` chain

### Requirement: The coding template does not steer to blind source reads

The `project-init` `coding` profile `AGENTS.md` template SHALL NOT instruct
"read the file first" without a kb-first qualifier. It SHALL direct the agent to
consult the doc tree (`kb agents <path>` / `kb_search`) before opening the
specific file.

#### Scenario: Template routes through the tree first
- **WHEN** the `coding` profile template renders its "Think Before Coding" guidance
- **THEN** the never-speculate rule reads "consult the doc tree (`kb agents <path>` / `kb_search`) first, then read the specific file"
- **AND** no line instructs reading a source file as the first investigation step

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
The guard SHALL escalate across repeat firings within a session: the first firing warns, the second escalates, and the third blocks a search tool call — but only in `block` mode; `warn` mode escalates without ever blocking, and `off` remains inert. Blocking SHALL be supported but SHALL NOT be the default mode; the default mode SHALL be advisory. An environment-variable override SHALL be able to select a weaker mode but SHALL NOT be able to enable blocking.

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
- **THEN** it states that a stale, gone, or unverified verdict means the row must be verified against source before it is acted on
- **AND** it states that a moved verdict must be verified at its reported successor path
- **AND** it states that a fresh verdict may be acted on without re-reading the source

