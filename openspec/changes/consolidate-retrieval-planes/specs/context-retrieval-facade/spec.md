# context-retrieval-facade — delta

**Conditional capability.** The engine-merge requirements below describe Phase
2b, which proceeds only if the pre-registered decision rule in `design.md` (D4)
reads "proceed". A written spec is not a commitment to build; if the rule reads
"stop", this capability ends at the dispatch form.

## ADDED Requirements

### Requirement: One faceted retrieval tool spans the retained planes

A single retrieval tool SHALL accept a query and an optional scope selecting
among the retained retrieval planes. Omitting the scope SHALL search all
retained planes. A scope naming a plane that is unavailable SHALL return results
from the remaining planes together with an explicit note that a plane was
skipped, rather than failing the call or silently returning fewer results.

#### Scenario: Unscoped query spans every retained plane
- **GIVEN** documents exist in the docs plane and entries exist in the lessons plane
- **WHEN** a query matching both is issued without a scope
- **THEN** results SHALL include matches from both planes
- **AND** each result SHALL name the plane it came from

#### Scenario: A scoped query is restricted to that plane
- **GIVEN** matching content exists in more than one plane
- **WHEN** a query is issued with a scope naming one plane
- **THEN** every result SHALL come from that plane

#### Scenario: An unavailable plane degrades rather than fails
- **GIVEN** one retained plane cannot be read
- **WHEN** an unscoped query is issued
- **THEN** results from the readable planes SHALL be returned
- **AND** the response SHALL state that a plane was skipped

### Requirement: Cross-plane results are merged by rank, not by raw score

Results from different planes SHALL be merged using a rank-based fusion that
requires no score calibration between sources, because per-plane relevance
scores are computed over different corpora and are not comparable. The merge
SHALL be deterministic for a given set of inputs.

#### Scenario: Scaling one plane's scores does not change the merged order
- **GIVEN** per-plane result lists with a known merged ordering
- **WHEN** the merge is repeated with one plane's raw scores multiplied by 100
- **AND** that plane's internal rank order is unchanged
- **THEN** the merged ordering SHALL be identical to the first merge

#### Scenario: Merge is deterministic
- **GIVEN** the same per-plane result lists
- **WHEN** the merge runs more than once
- **THEN** the merged ordering SHALL be identical each time

### Requirement: The facade does not regress the docs plane it replaces

The facade SHALL NOT become the default retrieval path until an evaluation over
the existing retrieval-quality harness shows no regression against the current
docs-plane search for the same queries. Existing tool names SHALL continue to
work as scope aliases for at least one release.

#### Scenario: Regression blocks defaulting
- **GIVEN** an evaluation of the facade against the current docs-plane search
- **AND** the facade scores worse on the harness's ranking metrics
- **WHEN** a query is issued with no scope
- **THEN** it SHALL be answered by the existing docs-plane engine
- **AND** the facade SHALL NOT be recorded as the resolved default route

#### Scenario: Prior tool names keep working
- **GIVEN** a caller uses a retrieval tool name that predates the facade
- **WHEN** the call is made in the release that introduces the facade
- **THEN** the call SHALL succeed
- **AND** SHALL be answered by the corresponding scope
