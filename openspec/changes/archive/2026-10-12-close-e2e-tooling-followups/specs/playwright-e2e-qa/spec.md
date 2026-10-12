## MODIFIED Requirements

### Requirement: A red spec with a filed product bug is quarantined, not left red

A spec that fails because of a product defect (not spec drift) SHALL be marked with Playwright's `fixme` annotation carrying the tracking issue URL, so the baseline reports the gap as a known, linked skip rather than a failure. Spec drift SHALL be fixed in the spec. A `fixme` without an issue reference SHALL fail a repo-lint guard. A file-level (top-level, outside any test or describe body) conditional `test.skip` removes a whole spec file from every shard, so the same repo-lint guard SHALL require its reason to carry an issue URL or the exact job id of a CI leg that runs specs; a job that runs no specs (e.g. a report-merge job) and a Playwright config name SHALL NOT satisfy the rule. Indented conditional `test.skip` calls (inside a test, describe or helper body; runtime guards) SHALL NOT be subject to this rule.

#### Scenario: Quarantined spec reports as fixme with a link
- **WHEN** a spec is annotated `test.fixme(true, "https://github.com/…/issues/<n>")`
- **THEN** the run SHALL report it as skipped-fixme carrying that URL, not as failed

#### Scenario: Unlinked fixme is refused
- **WHEN** a spec carries `test.fixme(` without an `issues/<n>` URL in its reason
- **THEN** the repo-lint test SHALL fail naming the spec

#### Scenario: Unattributed file-level skip is refused
- **WHEN** a spec file carries a top-level `test.skip(<condition>, "<reason>")` whose reason names neither an `issues/<n>` URL nor a CI leg
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: File-level skip naming its CI leg is accepted
- **WHEN** a spec file's top-level conditional `test.skip` reason names the CI leg that runs it (e.g. `e2e-browser-relay`)
- **THEN** the repo-lint test SHALL pass

#### Scenario: A non-spec job or a config name does not satisfy the rule
- **WHEN** a top-level conditional `test.skip` reason names only `merge-report` or only `playwright.team.config.ts`
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: A CI job id only matches as a whole token
- **WHEN** a top-level conditional `test.skip` reason mentions `e2e` only as part of other text (e.g. "e2e flake") or a near-miss id (e.g. `e2e-browser-relax`)
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: In-test runtime guard is not subject to the rule
- **WHEN** `test.skip(!port, "harness health does not expose the bound gateway port")` appears indented inside a test or helper body
- **THEN** the repo-lint test SHALL NOT flag it
