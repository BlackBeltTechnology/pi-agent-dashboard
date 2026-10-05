# kb-read-discipline — delta

## MODIFIED Requirements

### Requirement: The READ discipline is a mechanical tool-substitution table

The docs-first READ discipline SHALL be expressed as a tool-substitution table
that maps a raw-search reflex (`grep`/`rg`/`cat`/`Read`) to the exact retrieval
invocation to run first, rather than as prose. The table SHALL name the
symbol-lookup case explicitly and SHALL present the follow-through calls after
the initial search.

Where a retrieval facade replaces the individual retrieval tools, the table
SHALL name the facade and the **scope** to pass, so the routing information —
which lane to select and which corpus it indexes — survives the rename. Reducing
the number of tool names SHALL NOT reduce the routing rows: a facade collapses
the surface, not the doctrine.

#### Scenario: Symbol-lookup row exists with an exact command
- **WHEN** an agent reads the root `AGENTS.md` READ discipline
- **THEN** a table row maps "find where a function / type / const lives" to the exact retrieval invocation, including its scope or filter argument
- **AND** the row states the tree indexes key exported symbols per file

#### Scenario: Chain-through tools are named
- **WHEN** the READ discipline table is present
- **THEN** it includes a row routing "chase imports / callers" to the neighbours call
- **AND** a row routing "read one doc section in full" to the section-fetch call

#### Scenario: Framing leads with cost, not compliance
- **WHEN** the READ discipline is rendered
- **THEN** it presents the kb-first rule as faster/cheaper with the exact command
- **AND** it does not rely on "STOP" / "you violated the protocol" scare framing to carry the rule

#### Scenario: A facade rename preserves every routing row
- **GIVEN** the retrieval tools are replaced by a single faceted tool
- **WHEN** the READ discipline table is updated to name it
- **THEN** the table SHALL retain one row per previously routed case
- **AND** each row SHALL state the scope that selects the corresponding corpus
- **AND** the corpus boundaries SHALL remain stated
