## ADDED Requirements

### Requirement: Build tools referenced by workflows MUST be declared dependencies

Every external Node.js package referenced from `.github/workflows/*.yml` — including but not limited to packages loaded via `node --import <pkg>`, `node --loader <pkg>`, `NODE_OPTIONS='--import <pkg>'`, or `npx <pkg>` — SHALL be declared in a workspace `package.json` (root or sub-package) so that `npm ci` resolves it. The publish workflow SHALL NOT rely on globally-installed packages on the GitHub Actions runner, except for the runner's preinstalled toolchain (Node.js, npm, git).

This requirement closes a class of "works on my machine" CI failures where a developer has the tool installed globally but the runner does not.

#### Scenario: tsx loader referenced by bundle script
- **WHEN** `.github/workflows/publish.yml` invokes `node --import tsx/esm packages/electron/scripts/bundle-recommended-extensions.mjs`
- **THEN** `tsx` SHALL be declared as a `devDependency` in the workspace root `package.json`
- **AND** `package-lock.json` SHALL pin a specific resolved version
- **AND** the step SHALL succeed without an `ERR_MODULE_NOT_FOUND` for `tsx`

#### Scenario: New build-tool added in a future change
- **WHEN** a future workflow step is added that invokes `node --import <new-pkg>` or `npx <new-pkg>`
- **THEN** the change proposal SHALL also add `<new-pkg>` to a workspace `package.json`
- **AND** the change SHALL regenerate `package-lock.json` in the same commit

#### Scenario: Repo-lint enforcement (optional, future)
- **WHEN** a maintainer wants to enforce this requirement automatically
- **THEN** a repo-lint test MAY be added under `packages/shared/src/__tests__/` that greps `.github/workflows/*.yml` for `--import <pkg>` / `npx <pkg>` tokens and asserts each `<pkg>` resolves from the workspace root
- **AND** absence of such a lint SHALL NOT be a blocker for this change
