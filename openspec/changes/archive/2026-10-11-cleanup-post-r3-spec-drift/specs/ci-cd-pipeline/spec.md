## REMOVED Requirements

### Requirement: Build tools referenced by workflows MUST be declared dependencies

**Reason**: The rule stands, but its only concrete scenario ("tsx loader referenced by bundle script") pins a `publish.yml` step that runs the deleted `bundle-recommended-extensions.mjs`. `bundle-runtime-contract.test.ts` asserts that step is gone, and the scenario title states removed behaviour.
**Migration**: Replaced by "Workflow build tools are declared dependencies" below. The rule is unchanged; the stale scenario is dropped.

## ADDED Requirements

### Requirement: Workflow build tools are declared dependencies

Every external Node.js package referenced from `.github/workflows/*.yml` — including but not limited to packages loaded via `node --import <pkg>`, `node --loader <pkg>`, `NODE_OPTIONS='--import <pkg>'`, or `npx <pkg>` — SHALL be declared in a workspace `package.json` (root or sub-package) so that `npm ci` resolves it. The publish workflow SHALL NOT rely on globally-installed packages on the GitHub Actions runner, except for the runner's preinstalled toolchain (Node.js, npm, git).

This requirement closes a class of "works on my machine" CI failures where a developer has the tool installed globally but the runner does not.

#### Scenario: New build-tool added in a future change
- **WHEN** a future workflow step is added that invokes `node --import <new-pkg>` or `npx <new-pkg>`
- **THEN** the change proposal SHALL also add `<new-pkg>` to a workspace `package.json`
- **AND** the change SHALL regenerate `package-lock.json` in the same commit

#### Scenario: Repo-lint enforcement (optional, future)
- **WHEN** a maintainer wants to enforce this requirement automatically
- **THEN** a repo-lint test MAY be added under `packages/shared/src/__tests__/` that greps `.github/workflows/*.yml` for `--import <pkg>` / `npx <pkg>` tokens and asserts each `<pkg>` resolves from the workspace root
- **AND** absence of such a lint SHALL NOT be a blocker for this change
