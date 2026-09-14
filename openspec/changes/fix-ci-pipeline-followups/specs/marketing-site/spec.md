## MODIFIED Requirements

### Requirement: Public marketing site source

The repository SHALL contain a self-contained marketing site at `/site/`: a hand-written static page (`site/index.html`, `site/404.html`, assets) assembled by `node site/build.mjs` with no framework and no runtime npm dependencies, producing a fully static output.

#### Scenario: Site builds independently of the main app

- **GIVEN** a fresh clone of the repository
- **WHEN** a developer runs `cd site && npm run build` (which runs `node build.mjs`)
- **THEN** the build succeeds without depending on the root workspace, the `packages/*` workspaces, or any main-app build artifacts
- **AND** output is written to `site/dist/` as static HTML/CSS/JS assets

#### Scenario: Site declares "Pi blue" design tokens as CSS variables

- **GIVEN** the site's stylesheet
- **WHEN** the stylesheet loads
- **THEN** every `pi-*` colour resolves through a CSS variable of
  the form `rgb(var(--pi-xxx) / <alpha>)` so opacity variants still
  work, and both `:root` (light) and `:root.dark` declare a complete set of
  these variables covering bg, surface, surface-alt, border, fg, muted,
  accent, accent2, success, and warn

## ADDED Requirements

### Requirement: sync-release-version has no release-event trigger

`sync-release-version.yml` SHALL declare only `workflow_dispatch` (with the `correlation` input). It SHALL NOT declare a `release:` trigger: releases are created by `publish.yml` under the default Actions token, whose events never start a workflow, so the trigger can never fire for a pipeline release; the pipeline dispatches the workflow explicitly (see "A release event cannot start the redeploy, so the pipeline dispatches it"). A release published by hand from a draft SHALL be followed by a manual `workflow_dispatch`, which the workflow's docstring SHALL say.

#### Scenario: Contract test refuses the trigger's return
- **WHEN** `release:` appears under `on:` in `sync-release-version.yml`
- **THEN** the site-deploy workflow contract test SHALL fail naming the workflow

#### Scenario: Manual dispatch still works
- **WHEN** a maintainer dispatches `sync-release-version` from the Actions UI
- **THEN** the run SHALL rewrite the download block and commit to `develop` as before
