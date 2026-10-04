## MODIFIED Requirements

### Requirement: Public marketing site source

The repository SHALL contain a self-contained marketing site at `/site/`: a hand-written static page (`site/index.html`, `site/404.html`, assets) assembled by `node site/build.mjs` with no framework and no runtime npm dependencies, producing a fully static output.

#### Scenario: Site builds independently of the main app

- **GIVEN** a fresh clone of the repository
- **WHEN** a developer runs `cd site && npm run build` (which runs `node build.mjs`)
- **THEN** the build succeeds without depending on the root workspace, the `packages/*` workspaces, or any main-app build artifacts
- **AND** output is written to `site/dist/` as static HTML/CSS/JS assets

#### Scenario: Site declares "Pi blue" design tokens as CSS variables

- **GIVEN** the site's inline stylesheet
- **WHEN** the stylesheet loads
- **THEN** `:root` SHALL declare the token set lifted from
  `packages/client/src/index.css` — `--bg-primary`, `--bg-secondary`,
  `--bg-tertiary`, `--text-primary`, `--text-secondary`, `--text-tertiary`,
  `--accent`, `--accent-solid`, `--accent-text`, `--status-idle`,
  `--status-working`, `--status-needs-you`, and `--border` — as literal colour
  values, so the landing page and the product resolve the same palette
- **AND** light mode SHALL be expressed as a `[data-theme="light"]` override
  declaring a complete set of the same variables, not a separate selector
  vocabulary and not a `:root.dark` pairing

## ADDED Requirements

### Requirement: sync-release-version has no release-event trigger

`sync-release-version.yml` SHALL declare only `workflow_dispatch` (with the `correlation` input). It SHALL NOT declare a `release:` trigger, in block, inline-mapping, or sequence form.

The trigger is removed because the run it starts is incomplete, not because it cannot fire. Pipeline releases are created by `publish.yml` under the default Actions token, whose events never start a workflow — but `publish.yml` drafts every prerelease, so a human publishes it and that human-actor `release: published` event does start a run. That run commits under `GITHUB_TOKEN`, and a `GITHUB_TOKEN` push cannot start `deploy-site.yml`; the site is therefore never redeployed by the trigger's path. The pipeline dispatches both workflows explicitly instead (see "A release event cannot start the redeploy, so the pipeline dispatches it").

A release published by hand from a draft SHALL be followed by **two** manual `workflow_dispatch` runs — `sync-release-version`, then `deploy-site` — which the workflow's docstring SHALL state. The docstring SHALL NOT claim that `deploy-site.yml`'s `paths:` filter picks up the workflow's own commit. This maintainer obligation is documentation, not a machine-checkable assertion; only the trigger's absence and the dispatch input's presence are pinned by tests.

#### Scenario: Contract test refuses the trigger's return
- **WHEN** `release:` appears under `on:` in `sync-release-version.yml`, in block form or inline-mapping/sequence form
- **THEN** the site-deploy workflow contract test SHALL fail with a message naming `sync-release-version.yml`, in a `describe` block that names that workflow rather than `deploy-site.yml`

#### Scenario: Dispatch input survives the removal
- **WHEN** the site-deploy workflow contract test parses `sync-release-version.yml`
- **THEN** `workflow_dispatch.inputs.correlation` SHALL still be declared, so `publish.yml`'s correlated wait keeps working

#### Scenario: Manual dispatch still works
- **WHEN** a maintainer dispatches `sync-release-version` from the Actions UI
- **THEN** the run SHALL rewrite the download block and commit to `develop` as before
