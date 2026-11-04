# Spec Delta

## MODIFIED Requirements

### Requirement: A guard observes search chains that bypass the kb tools
The kb extension SHALL count consecutive search actions taken without any knowledge-access call, and SHALL surface a nudge once that chain reaches 3. Search actions SHALL include raw-search tool calls and bash commands in which any segment split on `|`, `||`, `;`, or a newline leads with a file-search binary. Search actions SHALL also include bash segments that lead with a file-read binary (`cat`, `head`, `tail`, `sed`, `less`, `more`, `bat`) and name, as an argument, a file the kb has indexed. Bash that does neither in any segment SHALL NOT count.

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

#### Scenario: Reading an indexed markdown file counts
- **WHEN** `AGENTS.md` is indexed and the agent runs `cat AGENTS.md`, `head -50 AGENTS.md`, or `sed -n 1,40p docs/guide.md` for an indexed `docs/guide.md`
- **THEN** each SHALL count as a search action

#### Scenario: Reading an unindexed file does not count
- **WHEN** the agent runs `cat src/index.ts`, or `sed -n 1,40p CHANGELOG.md` where `CHANGELOG.md` is not indexed
- **THEN** the chain counter SHALL be unaffected

#### Scenario: Indexed-path lookup unavailable degrades to not counting
- **WHEN** the set of indexed paths cannot be read (no index yet, store error)
- **THEN** file-read commands SHALL NOT count and the tool call SHALL proceed unaffected

### Requirement: The nudge ladder escalates, and blocking is opt-in
The guard SHALL escalate across repeat firings within a session: the first firing warns, the second escalates, and the third blocks a search tool call — but only in `block` mode; `warn` mode escalates without ever blocking, and `off` remains inert. Blocking SHALL be supported but SHALL NOT be the default mode; the default mode SHALL be advisory. An environment-variable override SHALL be able to select a weaker mode but SHALL NOT be able to enable blocking. The escalation text SHALL direct that the next call be a kb retrieval call and SHALL NOT tell the agent it may continue searching without one.

#### Scenario: Second firing escalates
- **WHEN** the guard fires a second time in a session with no intervening knowledge access
- **THEN** the message SHALL escalate beyond the first warning

#### Scenario: Escalation text offers no carry-on exit
- **WHEN** the guard emits its escalation message
- **THEN** the message SHALL name `kb_search` (or `kb_get`) as the next call
- **AND** SHALL NOT contain wording that permits continuing source search without a kb call (for example "carry on")

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
