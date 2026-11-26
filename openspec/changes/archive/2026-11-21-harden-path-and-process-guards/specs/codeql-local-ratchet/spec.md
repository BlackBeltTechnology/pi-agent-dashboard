## MODIFIED Requirements

### Requirement: Plugin server route modules are analysed through an anchor
The repository SHALL contain a non-test, never-executed module `scripts/codeql-anchor/plugin-routes.mjs` that gives a real `Fastify()` to each registrar in an explicit allowlist of registrars measured hidden by `paths-ignore`, so CodeQL treats their handlers as HTTP sources. A contract test SHALL pin the anchor to that allowlist. `paths-ignore` SHALL keep excluding `**/__tests__/**`.

#### Scenario: Plugin route handler is analysed
- **WHEN** the local analysis runs on the repository with the anchor present
- **THEN** results for the measured plugin production files (for example `packages/team-plugin/src/server/paths.ts` `js/path-injection`) SHALL appear in the run, and the ratchet SHALL exit 0 because each is covered by a baseline entry with a reason other than `untriaged`

#### Scenario: Allowlist is bounded to the measured registrars
- **WHEN** the contract test's allowlist is read
- **THEN** it SHALL be exactly `mountAutomationRoutes`, `mountTeamRoutes`, `registerGoalRoutes`, `registerBlackholeRoutes`, `mountRolesRoutes`, and the anchor SHALL contain no call to `listen(`

#### Scenario: Allowlisted registrar missing from the anchor
- **WHEN** the anchor does not import the module of an allowlisted registrar, or imports a module outside the allowlist
- **THEN** the contract test SHALL fail naming the module

#### Scenario: Registrar renamed or removed
- **WHEN** an allowlisted module no longer exists or no longer exports its registrar
- **THEN** the contract test SHALL fail naming the module and registrar

#### Scenario: Unfixed finding keeps an accepted-risk reason
- **WHEN** the baseline holds an `accepted-risk:` entry for `packages/automation-plugin/src/server/automation-writer.ts` while the finding is unfixed
- **THEN** its reason SHALL cite an issue as `#<digits>`, never a placeholder, and the contract test SHALL fail naming the entry otherwise

#### Scenario: Fixed F1 leaves no accepted-risk entry
- **GIVEN** the automation `plugin_action` `create` and `run` actions admit `payload.cwd` (#1104)
- **WHEN** the contract test reads the baseline entries for `packages/automation-plugin/src/server/automation-writer.ts`
- **THEN** none SHALL carry an `accepted-risk:` reason or cite `#1104`
- **AND** any entry that remains SHALL be `false-positive:` and SHALL name the admission gate and the file:line where the route and the `plugin_action` handler run it

#### Scenario: A still-reproducing F1 entry is re-typed by a reason-only edit
- **GIVEN** the F1 alerts still reproduce after #1104 is fixed (no script mode re-types a still-reproducing entry)
- **WHEN** only the `reason` of each `automation-writer.ts` entry is changed to a `false-positive:` reason naming the admission gate, and the analysis is then re-run
- **THEN** the run SHALL be recorded against the edited baseline and `--check-baseline-diff` SHALL show only those reason changes (no `ruleId`, `file`, `lineHash` or `count` change)

#### Scenario: Test code stays out of scope
- **WHEN** a flagged pattern exists only in a `__tests__` file
- **THEN** no result SHALL reference that file
