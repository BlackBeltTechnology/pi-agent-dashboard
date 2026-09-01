## MODIFIED Requirements

### Requirement: Latest-release surface with auto-sync

The site SHALL prominently surface the latest published GitHub release
(version tag, publish date, per-platform downloads) and keep that
surface in sync without manual editing. The site is a hand-written
static page: release data lives inline in `site/index.html` and the
`sync-release` script rewrites it — there is no build-time fetch.

#### Scenario: Download section renders per-platform cards

- **GIVEN** the current `site/index.html` with a synced download block
- **WHEN** the page is inspected
- **THEN** there is a `#download` section that shows the release tag,
  publish date, links to release notes and the releases index, and three
  platform cards (macOS / Linux / Windows), each with a primary download
  button sized by the classifier (DMG for macOS, AppImage for Linux,
  Installer .exe for Windows) and additional assets matched by shape
  (extension + arch suffix), never by a hardcoded filename

#### Scenario: Release publish updates the download block

- **GIVEN** a maintainer publishes a new GitHub release
- **WHEN** the release pipeline dispatches `sync-release-version` on `develop`
- **THEN** `sync-release.mjs` rewrites the download block in
  `site/index.html` from the GitHub API and, if the content changed,
  commits it back to `develop` with a message of the form
  `chore(site): sync download block to <tag>`

#### Scenario: Site build does not fetch the GitHub API

- **GIVEN** the static-page site build (`node site/build.mjs`)
- **WHEN** it runs with the GitHub API unreachable
- **THEN** the build succeeds unchanged — release data is inline markup,
  not build-time output
- **AND** the deploy workflow runs `npm run check-release` non-blocking,
  so a page advertising a stale version is visible in the log without
  blocking the deploy

#### Scenario: A release event cannot start the redeploy, so the pipeline dispatches it

- **GIVEN** `publish.yml` creates the GitHub Release with the default Actions token, and GitHub
  suppresses workflow runs from events raised by that token — so the resulting `release` event
  CANNOT start a run, and historically never has
- **WHEN** the `github-release` job completes successfully
- **THEN** `publish.yml` SHALL dispatch `sync-release-version.yml` and then `deploy-site.yml`, each
  via `workflow_dispatch` with `--ref develop`, because `workflow_dispatch` is an explicit exception
  that always creates a run even when triggered by the default token
- **AND** the `deploy-site.yml` dispatch SHALL follow the `sync-release-version` run's completion, so
  the build observes the committed download block rather than racing it
- **AND** the dispatched run builds the site and publishes via `actions/deploy-pages@v4`
- **AND** `--ref develop` SHALL be preserved on both dispatches, because the `github-pages`
  environment rejects deploys from a tag ref

#### Scenario: The dead release path is absent from the deploy workflow

- **GIVEN** the deploy-site workflow
- **WHEN** its triggers and job graph are inspected
- **THEN** it SHALL NOT declare a `release:` trigger, SHALL NOT contain a `redispatch-on-release`
  job, and SHALL NOT gate any job on `github.event_name != 'release'` — none of which can ever
  execute, and whose presence misleads readers into believing the redeploy is automatic
- **AND** `workflow_dispatch` SHALL remain available for manual redeploys

### Requirement: GitHub Pages deployment via GitHub Actions

The repository SHALL deploy the marketing site to GitHub Pages using the modern `actions/deploy-pages` workflow, without using a `gh-pages` branch. The published Pages artifact SHALL contain both the marketing site at the apex and the neutral shell at the `/app/` subpath.

#### Scenario: Deploy workflow triggers on site or shell changes

- **GIVEN** a commit to `develop` that modifies any file under `site/**`, under `packages/shell/**`, or the deploy workflow itself
- **WHEN** the workflow runs
- **THEN** it builds the site, uploads the output as a Pages artifact, and deploys it via `actions/deploy-pages`

#### Scenario: Deploy workflow can be run manually

- **GIVEN** a maintainer needs to redeploy without a source change
- **WHEN** they trigger `workflow_dispatch` on the site-deploy workflow
- **THEN** the workflow runs to completion and publishes the current `develop` content

#### Scenario: Custom domain is active

- **GIVEN** `site/public/CNAME` contains `pi-dashboard.dev`
- **WHEN** the Pages artifact is deployed
- **THEN** the site SHALL be served from `https://pi-dashboard.dev` rather than a
  `username.github.io/pi-agent-dashboard` path

#### Scenario: Shell is composed into the artifact under /app

- **GIVEN** a deploy run that has built the marketing site into `site/dist/`
- **WHEN** the workflow builds `packages/shell` and copies its output
- **THEN** the shell's built files SHALL land in `site/dist/app/` before the Pages artifact is
  uploaded, so a single artifact serves the apex and `/app/`

### Requirement: Performance and accessibility budgets

The site ships as hand-written HTML plus vendored, pre-minified JavaScript
(`site/field.js`, `site/vendor/`); there is no bundler and no build-time
bundle. The Astro-era 50 KB gzipped JavaScript budget and its
`check-js-size.mjs` check were deleted with the framework. A JavaScript
size gate SHALL NOT be reinstated without reintroducing a measurement
mechanism in the same change — a budget with no checker is decoration.

#### Scenario: No bundle budget is asserted

- **GIVEN** the static site has no bundler and no size-check script
- **WHEN** the deploy workflow builds `site/dist/`
- **THEN** no JavaScript-size gate runs, and no workflow step references a
  bundle budget or `check-js-size`

#### Scenario: Layout and anchor audit guards the rendered page

- **GIVEN** the audit driver (`npm run audit -w site`)
- **WHEN** it sweeps the declared themes across the declared viewports
- **THEN** it reports no document overflow and no dead in-page anchors,
  and exits non-zero on a violation
