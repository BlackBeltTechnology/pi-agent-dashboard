## MODIFIED Requirements

### Requirement: Per-claim provenance and confidence

Every behavioral claim, rule, entity field, quirk and gap SHALL carry an inline citation naming at least one source location (`path:line` or `path:startLine-endLine`) and a confidence level of `confirmed`, `inferred` or `assumed`. `confirmed` SHALL require direct code evidence (or a test assertion) for the exact claimed behavior; `inferred` SHALL denote reasoning across code evidence; `assumed` SHALL denote convention without direct evidence. A claim whose citation lists more than one source location, or that states an absence (a behavior that never happens, a value that is never validated, a path that is unreachable), SHALL be at most `inferred`. When items from several capabilities are merged into one catalog entry, the merged entry SHALL take the lowest confidence of its sources, and when its citation joins more than one source location it SHALL be at most `inferred`. Each citation comment SHALL occupy a single line. The confidence cap for multi-location and absence claims is a rule, not a judgement: the auditor SHALL NOT report a claim as under-confident when the cap alone lowered it. The skill SHALL run a deterministic check that rejects every `confirmed` citation naming more than one source location (counted as source-location tokens, whatever the separator) and every unterminated citation comment, over the generator output before each merge and over the merged catalog files after each merge; no audit SHALL run on a package with a rejected citation. A rejected citation in the generator output SHALL be fixed in the generator output; a rejected citation present only in a merged catalog SHALL be treated as a merge error and fixed by re-running the merge.

#### Scenario: Claim cites its source
- **WHEN** a spec states that an order total is rejected above a threshold
- **THEN** the claim is followed by a citation naming the file and line range implementing the check
- **AND** a confidence level

#### Scenario: Uncited claim fails audit
- **WHEN** the auditor finds a claim without a citation, or whose cited lines do not implement the claimed behavior
- **THEN** the auditor reports it and the capability verdict is `revise`

#### Scenario: Multi-location confirmed citation rejected before audit
- **WHEN** a capability spec or fragment contains a citation with confidence `confirmed` and two or more `;`-separated source locations
- **THEN** the deterministic check reports the file and the location of the citation and exits non-zero
- **AND** the citation is lowered to `inferred`, or regenerated with one location that directly implements the claim, before the grounding audit runs

#### Scenario: Multi-location cite with a non-standard separator rejected
- **WHEN** a citation reads `ref=a.ts:1, b.ts:2` with confidence `confirmed`
- **THEN** the deterministic check rejects it as naming two source locations

#### Scenario: Cap-lowered confidence not reported by the auditor
- **WHEN** a rule enforced at two sites that each state it directly is cited with both locations and tagged `inferred`
- **THEN** the auditor does not report its confidence as incorrect

#### Scenario: Nested fragment citation checked
- **WHEN** a generator fragment records an entity field with confidence `confirmed` and a citation of two locations, nested inside an entity
- **THEN** the deterministic check rejects it and identifies the entity and field

#### Scenario: Merge does not raise confidence
- **WHEN** one capability records a rule as `inferred` and another records the same rule as `confirmed`
- **THEN** the single merged `rules.md` entry carries `inferred`

#### Scenario: Merged citation joining two locations
- **WHEN** two capabilities each record the same rule as `confirmed`, citing different single locations, and the merged entry cites both
- **THEN** the merged `rules.md` entry carries `inferred`

### Requirement: Business rule catalog

The package SHALL contain `rules.md` listing each business rule exactly once with a stable `BR-NNN` identifier, a precise statement (including concrete thresholds, formulas, precedence, rounding and time handling found in code), a classification of `explicit` (stated directly in a conditional, guard, validation, lookup table or comment) or `implicit` (arising from default values, exception handlers, fall-through, ordering, or cross-module interaction), and the capabilities that apply it. Business rules SHALL include error-handling decisions: which failure classes yield which caller-visible outcome (an HTTP status, an error code, an error reply, a CLI exit status that differs between failure classes), and what a fallback handler hides or substitutes for unexpected failures. Interface plumbing — numbering or formatting choices that encode no decision (a non-success exit status that is the same for every failure, output formatting, identifier formats, subscription mechanics) — SHALL stay in the capability specs and SHALL NOT be required in `rules.md`. Behavioral spec scenarios that depend on a rule SHALL reference its `BR-NNN` identifier.

#### Scenario: Implicit rule from a default value
- **WHEN** code assigns a default that changes business outcome when an input is absent
- **THEN** `rules.md` contains a rule classified `implicit` describing that outcome and citing the default

#### Scenario: Error-to-outcome mapping cataloged
- **WHEN** code maps domain error codes to caller-visible statuses through a lookup table
- **THEN** `rules.md` contains a rule classified `explicit` stating each code and its status, citing the table

#### Scenario: Generic failure fallback cataloged
- **WHEN** a handler answers every unexpected failure with a generic code and message, hiding the original details
- **THEN** `rules.md` contains a rule classified `implicit` stating the fallback outcome and that details are hidden, citing the handler

#### Scenario: Output formatting not required in the catalog
- **WHEN** code formats command output, or exits with the same non-success status for every failure
- **THEN** the capability spec describes it
- **AND** the auditor does not report it as missing from `rules.md`

#### Scenario: Re-run preserves identifiers
- **WHEN** the skill is re-run on the same target and a previous rebuild package is supplied
- **THEN** rules, quirks and gaps that still exist keep their previous identifiers
- **AND** new items receive identifiers greater than any previously used, and removed items' identifiers are not reused

#### Scenario: Rule shared by two capabilities
- **WHEN** the same rule is enforced by two capabilities
- **THEN** `rules.md` lists it once with both capabilities
- **AND** both capability specs reference the same `BR-NNN`

### Requirement: Gap register

When the skill cannot determine a behavior from code (dynamic dispatch, external configuration, missing source, ambiguous logic), it SHALL record the unknown in `gaps.md` with a stable `GAP-NNN` identifier, what is unknown, why, the affected capabilities, and what evidence would resolve it, instead of inventing behavior. A rule whose value comes from external configuration SHALL name the configuration key exactly as it appears in the external source (the literal key string read from the file, environment or service), not the in-code property or variable it is loaded into.

#### Scenario: Behavior depends on external configuration
- **WHEN** a rule's threshold is read from configuration not present in the target
- **THEN** the rule states that the threshold is configurable and names the key
- **AND** `gaps.md` records the unknown value as a gap

#### Scenario: Literal key preferred over in-code property
- **WHEN** code reads the external key `limits.maxRetries` from a configuration file into an in-code property `settings.retryLimit`
- **THEN** the rule statement names `limits.maxRetries`
- **AND** the merged `rules.md` entry keeps that literal key

### Requirement: Grounding audit and revise loop

The skill SHALL audit each capability spec and the cross-cutting files against the code, reporting hallucinated claims, missing central behaviors, incorrect citations, misclassified explicit/implicit rules, and incorrect confidence levels as strict JSON with a `pass` or `revise` verdict. Specs with verdict `revise` SHALL be regenerated with the findings and re-audited. Only packages whose capabilities all pass audit, all pass the format gate, pass the completeness gate, and pass the deterministic citation check SHALL be offered for promotion.

#### Scenario: Hallucinated rule removed
- **WHEN** the auditor reports a rule with no basis in the cited code
- **THEN** the rule is removed or corrected in a revise pass
- **AND** the package is not offered for promotion until the re-audit passes

#### Scenario: Dangling identifier reference
- **WHEN** a capability spec references a `BR-`, `QUIRK-` or `GAP-` identifier that does not exist in the corresponding cross-cutting file
- **THEN** the auditor reports it and the package is not offered for promotion until every reference resolves

#### Scenario: Gate summary before promotion
- **WHEN** the skill offers promotion
- **THEN** it reports per capability the audit verdict, format-gate result (structural check, plus `openspec validate` when it ran), and counts of rules (explicit/implicit), quirks and gaps, plus the completeness verdict and the citation-check result
