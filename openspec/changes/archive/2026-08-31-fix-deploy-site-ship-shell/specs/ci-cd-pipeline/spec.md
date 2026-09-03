## ADDED Requirements

### Requirement: The marketing site stays dependency-free

`site/` is a hand-written static page with a zero-dependency manifest: its
build (`node site/build.mjs`) is a copy + reference check, and the deploy
workflow runs no install step for the site itself — the root
`pnpm install --frozen-lockfile` in the deploy serves the neutral shell,
not the site. The Astro-era `site/package-lock.json` and its `npm ci`
drift failure class were deleted with the framework.

The site manifest SHALL declare no `dependencies`, `devDependencies`, or
`optionalDependencies`. Reintroducing a site dependency SHALL land
together with an install strategy for the deploy workflow and a
lockfile-drift guard in the same change — never as a bare manifest edit.

#### Scenario: Site manifest declares no dependencies

- **GIVEN** `site/package.json`
- **WHEN** its dependency maps are inspected
- **THEN** `dependencies`, `devDependencies`, and `optionalDependencies`
  are all absent or empty

#### Scenario: Deploy workflow runs no site install

- **GIVEN** `.github/workflows/deploy-site.yml`
- **WHEN** its steps are inspected
- **THEN** no step runs an install scoped to the site (`npm ci`,
  `npm install`) and no step references a site lockfile
- **AND** the root `pnpm install --frozen-lockfile` remains, serving the
  neutral shell (already pinned by `pnpm-migration-contract.test.ts` X6)
