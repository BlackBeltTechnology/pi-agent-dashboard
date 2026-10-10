## ADDED Requirements

### Requirement: Usage evidence
The skill SHALL map application log types to UI actions and use cases in a gated shared record, aggregate real snapshot logs per customer into local-only output, and refuse output that leaks identifying data.

#### Scenario: Source decoding
- **WHEN** a usage source starts with a UTF-16 BOM
- **THEN** it is decoded as UTF-16, else as UTF-8 when valid, else with the job's `encoding`

#### Scenario: Mapping grounded in code
- **WHEN** a mapped type's cite line does not contain the type literal
- **THEN** `check-usage` fails naming the type

#### Scenario: Complete mapping
- **WHEN** `check-usage --complete` runs and a type seen in a snapshot is neither mapped nor unmapped with a reason
- **THEN** it fails listing the type

#### Scenario: Local only
- **WHEN** the shared catalog is built
- **THEN** it contains the mapping but no counts, users or customer values; usage appears only with `--local` under `_local/`

#### Scenario: Leak check
- **WHEN** aggregated output contains a user value or any non-type string from a usage source
- **THEN** `check-usage-output` fails and `render.sh` stops

#### Scenario: Never-used findings respect logging coverage
- **WHEN** an action has no mapped log type
- **THEN** it is reported as "not logged", never as "never used"
