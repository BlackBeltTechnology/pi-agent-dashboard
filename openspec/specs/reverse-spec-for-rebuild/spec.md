# reverse-spec-for-rebuild Specification

## Purpose
Define the contract of the `reverse-spec-for-rebuild` skill: extracting, from existing code, a rebuild package that lets a team reimplement the same business logic and use cases without reading the original source.

## Requirements

### Requirement: Skill registration and attribution

The `packages/eng-disciplines` package SHALL register the `reverse-spec-for-rebuild` skill in its `package.json` `pi.skills[]` array alongside its existing skills. The package `NOTICE` SHALL credit greenfield (Apache-2.0) as the source of adapted methodology. The skill's evaluation fixture SHALL be excluded from the published package files. The skill SHALL NOT reference files outside its own skill directory, so it works when the package is installed on its own.

#### Scenario: Skill is discoverable
- **WHEN** pi loads the `eng-disciplines` package
- **THEN** the `reverse-spec-for-rebuild` skill is available with a description naming rebuild/reimplementation triggers
- **AND** no file under `packages/openspec-workflow/.pi/skills/reverse-spec-from-code/` is modified by this change

#### Scenario: Self-contained skill
- **WHEN** an auditor extracts every relative path referenced by the skill's `SKILL.md`, prompts and references
- **THEN** each resolves to a file inside the skill directory

#### Scenario: Eval fixture not published
- **WHEN** the package is packed for publishing
- **THEN** the packed file list contains the skill's SKILL.md, prompts, references and scripts
- **AND** contains no file from the skill's evaluation fixture directory

### Requirement: Portable operation with optional OpenSpec and knowledge-base integration

The skill SHALL run in any git repository. When a knowledge-base tree (`AGENTS.md` rows / `kb` tooling) is present, discovery MAY use it to map capability boundaries; otherwise discovery SHALL use manifests, entry points and directory structure. Every capability spec SHALL pass the skill's built-in structural check; when the OpenSpec CLI and an `openspec/` directory are both present, each spec SHALL additionally pass `openspec validate`.

#### Scenario: Plain repository without OpenSpec or kb
- **WHEN** the target repository has no `openspec/` directory, no OpenSpec CLI and no `AGENTS.md` tree
- **THEN** discovery produces a capability manifest from manifests, entry points and directories
- **AND** specs are gated by the built-in structural check only, and the run completes

#### Scenario: OpenSpec project
- **WHEN** the OpenSpec CLI and an `openspec/` directory are present
- **THEN** each capability spec is also validated with `openspec validate` through a transient id

#### Scenario: Structural check rejects a malformed spec
- **WHEN** a capability spec labels a scenario with bold `**Scenario:**`, numbers a requirement heading, or has a scenario without a `- **WHEN**` and a `- **THEN**` line
- **THEN** the built-in structural check fails and names the offending line

### Requirement: Rebuild package layout and promotion

The skill SHALL write all output for a target to a scratch directory `.reverse-spec-scratch/` at the repository root, containing per-capability behavioral specs and the cross-cutting files `model.md`, `rules.md`, `quirks.md`, `gaps.md` and `completeness.md`. When the scratch directory is not ignored by git, the skill SHALL ask the user before writing, offering to add it to the local exclude file. The skill SHALL move the package to a user-chosen destination only after explicit user confirmation, and SHALL refuse any destination whose resolved real path lies inside a protected root; protected roots default to `openspec/`, `docs/`, `packages/` and `.pi/` and MAY be overridden per run. Transient validation ids the skill creates under `openspec/specs/` SHALL use a prefix unique to this skill, SHALL be deleted within the same gate iteration, and leftovers from an interrupted earlier run SHALL be swept at the start and end of every run.

#### Scenario: Scratch-first output
- **WHEN** the skill runs against a target directory
- **THEN** every generated file is written under `.reverse-spec-scratch/<target-slug>/rebuild/`
- **AND** no file under `openspec/` persists after the run (transient throwaway validation ids used by the format gate are deleted before the run ends)

#### Scenario: Scratch directory not ignored
- **WHEN** `git check-ignore .reverse-spec-scratch` reports the directory is not ignored
- **THEN** the skill asks before writing and, on consent, appends it to `.git/info/exclude` (never to a committed ignore file)

#### Scenario: Promotion requires confirmation
- **WHEN** all gates pass and the user confirms a destination path
- **THEN** the package is moved (not copied) to that path

#### Scenario: Destination inside a protected root rejected
- **WHEN** the user chooses a destination under a protected root, including a relative, `..`-containing or symlinked path that resolves there, or a not-yet-existing path whose nearest existing ancestor resolves there
- **THEN** the skill refuses the promotion and asks for another destination

#### Scenario: Interrupted run leftovers swept
- **WHEN** a previous run was interrupted and left a transient validation id directory with this skill's prefix under `openspec/specs/`
- **THEN** the next run deletes it before generating
- **AND** does not touch transient directories belonging to other skills

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

### Requirement: Domain model

The package SHALL contain `model.md` describing each business entity and value type with its fields, field types, nullability or optionality, allowed values or ranges, identity, relationships, and persistence format where the code defines one.

#### Scenario: Entity with optional field
- **WHEN** code defines an entity whose field may be absent
- **THEN** `model.md` lists the field as optional and states the behavior or default applied when absent, with a citation

### Requirement: Behavioral coverage of state, edge cases and errors

Each capability spec SHALL use the OpenSpec full-form requirement/scenario format and SHALL pass the format gate (built-in structural check, plus `openspec validate` when available) before promotion. Each capability spec SHALL cover, where the code exhibits them: state machines (states, legal transitions with their triggers, rejected transitions, initial state, persistence), edge cases (empty input, maximum size or limits, concurrent access, interruption or partial failure), and error handling (detection, response, user-visible message or code, recovery).

#### Scenario: State transition captured
- **WHEN** code allows a transition from state A to state B only on a specific trigger
- **THEN** the capability spec contains a scenario for the allowed transition
- **AND** a scenario for the rejected transition when the trigger is absent

#### Scenario: Format gate
- **WHEN** a capability spec fails the format gate
- **THEN** it is regenerated and is not promotable until it validates

### Requirement: Quirk annotation

When code behavior appears to be a defect or unintended (contradicts a comment, name, sibling code path or evident intent), the skill SHALL keep the behavioral spec faithful to what the code does and SHALL record the suspected defect in `quirks.md` with a stable `QUIRK-NNN` identifier, the observed behavior, the suspected intended behavior, the evidence, and a confidence level. The skill SHALL NOT silently correct the behavior.

#### Scenario: Suspected off-by-one
- **WHEN** a limit check uses an inclusive comparison while its message and name imply exclusive
- **THEN** the capability spec describes the inclusive behavior actually implemented
- **AND** `quirks.md` records a quirk referencing that spec and citing the check

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

### Requirement: Entry-point completeness gate

The skill SHALL inventory the target's entry points — registered tools or commands, environment variables read, CLI flags, HTTP routes, WebSocket or event message types, configuration keys, and error codes or error types — and SHALL write `completeness.md` mapping each to a capability spec or a `GAP-NNN`. Any entry point mapped to neither SHALL fail the gate regardless of its priority; priority levels only order remediation. A package that fails the gate SHALL NOT be promotable, and any capability revised to satisfy the gate SHALL pass the grounding audit and format gate again before promotion.

#### Scenario: Unmapped route fails the gate
- **WHEN** the target registers an HTTP route that no capability spec or gap references
- **THEN** `completeness.md` lists the route as unmapped with verdict FAIL
- **AND** the skill revises the affected capability or registers a gap before offering promotion

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

### Requirement: Frontend UI-model extraction

The skill SHALL ship dependency-free programs that turn a legacy frontend into a gated UI model inside the rebuild package: a behavioural inventory with `file:line`, effective per-variant configuration, form records, screen records written by a subagent from a shipped prompt and accepted only when the gate passes, flows from code, a style kit extracted from the application's own stylesheets, and screen plans that keep the original layout and link every control to an action, a field, a recorded unmapped reason or the application shell. Stack specifics SHALL live in an adapter loaded by built-in name or file path; the screen-plan toolbar convention SHALL be an optional adapter hook.

#### Scenario: Project adapter by path
- **WHEN** `style-kit.mjs` or `screen-plan.mjs` is given a path to an adapter file instead of a built-in name
- **THEN** it loads that adapter and produces the same outputs as for a built-in adapter

#### Scenario: No toolbar hook
- **WHEN** the adapter declares no `toolbar` hook
- **THEN** the screen plan keeps every toolbar control and filters none by toolbar key

#### Scenario: Unlinked control refused
- **WHEN** a plan control links to no action, field, unmapped reason or shell
- **THEN** `screen-plan.mjs` exits 1 naming the control's number, cite and label

### Requirement: Behaviour-model generation

The skill SHALL ship generator prompts for sequence records (deepening a `sequence-from-ui` draft past the data-layer boundary) and state-machine records (one entity field), run one subagent per record, and accept a record only when `rebuild-package-diagrams` `check-sequences` / `check-states` pass with `--app`.

#### Scenario: Gate failure routed back
- **WHEN** a generated state machine fails `check-states`
- **THEN** the record is regenerated with the gate lines as findings and is not rendered until it passes

### Requirement: CRUD classification step

The skill SHALL provide a CRUD classifier prompt that a subagent fills per screen batch from the
`crud-draft` output, choosing for each effect the entity it persists or reads (from the
candidates or `model.md`) and the op from the cited code, and SHALL accept a record only when
`check-crud` passes for it.

#### Scenario: Record accepted only when gated
- **WHEN** a classifier writes an entity that `model.md` does not define
- **THEN** `check-crud` refuses the record and the classifier fixes it before reporting

### Requirement: Application-neutral skill
The skill's scripts, prompts and references SHALL contain no knowledge of a particular analysed application or customer; application knowledge SHALL live in a project-owned adapter profile.

#### Scenario: Generality gate
- **WHEN** a skill file outside `adapters/` names a pilot application or customer, or uses an application convention such as a config global or toolbar object name
- **THEN** the package test suite fails naming the file and token

#### Scenario: Built-in adapters are stack-level
- **WHEN** a built-in adapter references an application file path
- **THEN** the generality gate fails

### Requirement: Adapter profiles
An adapter MAY declare `parent: "<built-in name>"`; the loader SHALL merge the profile over the built-in adapter, merging `dialect` key-wise, and SHALL pass `parseLiteralAt` with the other helpers to hooks.

#### Scenario: Profile overrides one dialect key
- **WHEN** a profile has `parent: "angularjs"` and sets only `dialect.exprText`
- **THEN** the merged adapter keeps the built-in AngularJS attributes and uses the profile's expression rendering

### Requirement: Template dialect
`screen-plan.mjs` SHALL take every template-language rule (interpolation, control/drop/select tags, event/model/change/bind attributes, conditions, repeats, switch values, expression text, conjunct decisions, CSS classes, language) from `adapter.dialect`; without a dialect it SHALL plan plain HTML.

#### Scenario: Plain HTML
- **WHEN** the adapter has no dialect
- **THEN** buttons, inputs, selects and textareas are numbered controls and no template-language attribute is interpreted

### Requirement: Legacy encoding parameter
Source decoding SHALL use UTF-16 by BOM, then UTF-8 when valid, then the adapter's `encoding` (default `windows-1252`).

#### Scenario: Profile code page
- **WHEN** a profile sets `encoding: "windows-1250"` and a source is neither UTF-16 nor valid UTF-8
- **THEN** it is decoded as windows-1250

### Requirement: Use-case linker step
The UI phase SHALL include an optional linker step: one `rsfr-uc-linker` subagent per use-case batch fills `prompts/uc-linker.md`, writes only `diagrams/uc-links/<UC-id>.json`, and is accepted only when `check-uc-links` passes.

#### Scenario: Gate loop
- **WHEN** the linker's record fails `check-uc-links`
- **THEN** the failing lines go back to the same linker and the record is never hand-edited to pass

### Requirement: Variability classifier step
The UI phase SHALL include an optional variability step: `rsfr-variability-classifier` subagents, one per config-key batch, fill `prompts/variability-classifier.md`, write only `diagrams/variability/` records, and are accepted only when `check-variability` passes.

#### Scenario: Gate loop
- **WHEN** the record fails `check-variability`
- **THEN** the failing lines go back to the classifier and the record is never hand-edited to pass
