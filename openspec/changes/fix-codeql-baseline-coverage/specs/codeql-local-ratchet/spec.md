## ADDED Requirements

### Requirement: operator-authz reasons cite their bounding gate
Every committed `codeql-baseline.json` entry whose reason is `operator-authz: <text>`, bare or after a `github-dismissed (…): ` prefix, SHALL name its bounding gate as `gate: <symbol> <repo-path>:<line>` (existing path, symbol in the file), or, only for the contract test's allowlist of control-tier-only source files, as `control-tier: <basis>`. A contract test SHALL enforce this from the baseline file alone.

#### Scenario: Reason names an existing gate
- **WHEN** an `operator-authz` entry reads `operator-authz: gate: admitCwd packages/server/src/routes/folder-project-routes.ts:65; known folders only`
- **THEN** the contract test SHALL pass when that file exists and contains `admitCwd`

#### Scenario: Canned universal-guard reason rejected
- **WHEN** an `operator-authz` entry contains the phrase `can already spawn shell-capable sessions`, as in `operator-authz: Operator API behind the universal network guard (createNetworkGuardHook); an admitted caller can already spawn shell-capable sessions.`
- **THEN** the contract test SHALL fail naming the entry

#### Scenario: Control-tier form on an allowlisted file
- **WHEN** an entry for `packages/server/src/spawn-process/spawn-preflight.ts` reads `operator-authz: control-tier: POST /api/session/spawn; probe targets a directory the caller may already start a shell in`
- **THEN** the contract test SHALL pass

#### Scenario: Control-tier form on any other file rejected
- **WHEN** an entry for a file outside the allowlist (`git-operations.ts`, `process-manager.ts`, `spawn-preflight.ts` under `packages/server/src/`), such as `packages/server/src/routes/browse.ts`, reads `operator-authz: control-tier: …`
- **THEN** the contract test SHALL fail naming the entry

#### Scenario: Mirrored entry keeps the gate first
- **WHEN** an entry reads `github-dismissed (#57, won't fix): operator-authz: gate: isWithinBrowseRoots packages/server/src/routes/file-routes.ts:621; …`
- **THEN** the contract test SHALL accept it, and the GitHub dismissal comment, which is the text after the `github-dismissed (…): ` prefix taken verbatim, SHALL still start with the gate (`operator-authz: gate: …`: the gate immediately follows the `operator-authz: ` class marker)

#### Scenario: Not-request-reachable or primitive sink is not operator-authz
- **WHEN** the entry for `packages/server/src/rpc-keeper/keeper-manager.ts` (not request-reachable) or `packages/server/src/lib/path-containment.ts` (the containment primitive) reads `operator-authz: …`
- **THEN** the contract test SHALL fail naming the entry; both SHALL carry a `false-positive:` reason

#### Scenario: Gate symbol absent from the file
- **WHEN** a `gate: <symbol> <path>:<line>` reason names a symbol the file does not contain, or a path that does not exist
- **THEN** the contract test SHALL fail naming the entry

#### Scenario: Over-long reason rejected
- **WHEN** the part of an `operator-authz` reason after any `github-dismissed (…): ` prefix is 237 characters (the GitHub comment is that text plus ` — See change: <id>`, capped at 280)
- **THEN** the contract test SHALL fail naming the entry

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
- **WHEN** the baseline holds an entry for `packages/automation-plugin/src/server/automation-writer.ts` (finding F1, tracked in #1104)
- **THEN** its reason SHALL start with `accepted-risk:` and cite the issue as `#<digits>` (`#1104`), never `false-positive:` and never a placeholder, and the contract test SHALL fail naming the entry otherwise

#### Scenario: Test code stays out of scope
- **WHEN** a flagged pattern exists only in a `__tests__` file
- **THEN** no result SHALL reference that file
