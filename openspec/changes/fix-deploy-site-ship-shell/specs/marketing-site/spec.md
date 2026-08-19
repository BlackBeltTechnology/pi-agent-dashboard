## MODIFIED Requirements

### Requirement: Latest-release surface with auto-sync

The site SHALL prominently surface the latest published GitHub release
(version tag, publish date, per-platform downloads) and keep that
surface in sync without manual editing.

#### Scenario: Download section renders per-platform cards

- **GIVEN** a successful build with at least a cached release in
  `site/src/data/latest-release.json`
- **WHEN** the rendered page is inspected
- **THEN** there is a `#download` section that shows the release tag,
  publish date, links to release notes and the releases index, and three
  platform cards (macOS / Linux / Windows), each with a primary download
  button sized by the classifier (DMG for macOS, AppImage for Linux,
  Installer .exe for Windows) and any additional assets tucked into a
  collapsible “Other downloads” accordion

#### Scenario: Hero CTA reflects the current version

- **GIVEN** a successful build with a resolved release
- **WHEN** the hero renders
- **THEN** its primary CTA label is “Download <tag> →” and its href is
  the in-page anchor `#download`

#### Scenario: Build survives API outage via committed cache

- **GIVEN** the GitHub API is unreachable (timeout, 403, or 5xx)
- **WHEN** the site builds
- **THEN** `github-release.ts` falls back to
  `site/src/data/latest-release.json` and the Download section still
  renders the last known release with no HTML difference to the visitor

#### Scenario: Release publish updates the committed cache

- **GIVEN** a maintainer publishes a new GitHub release
- **WHEN** the `sync-release-version` workflow runs
- **THEN** it writes the latest release metadata to
  `site/src/data/latest-release.json` and, if the content changed,
  commits the file back to `develop` with a message of the form
  `chore(site): sync latest-release.json to <tag>`

#### Scenario: Release event redispatches the deploy workflow on develop

- **GIVEN** the deploy-site workflow
- **WHEN** a GitHub release is published
- **THEN** the `release: { types: [published] }` trigger fires on the tag ref, and because the
  `github-pages` environment rejects deploys from a non-default ref, the workflow SHALL NOT build or
  deploy inline
- **AND** it SHALL re-dispatch itself on `develop` via `gh workflow run deploy-site.yml --ref develop`
- **AND** that dispatched run builds the site with fresh release data and publishes via
  `actions/deploy-pages@v4`

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

The site SHALL ship minimal JavaScript and meet accessibility baselines. The JavaScript budget covers the marketing site only; the neutral shell is a separately-budgeted artifact that happens to be published from the same directory tree.

#### Scenario: JavaScript bundle budget

- **GIVEN** a successful site build
- **WHEN** the total gzipped size of `site/dist/**/*.js` is measured, **excluding** everything under `site/dist/app/`
- **THEN** it does not exceed 50 KB

#### Scenario: Budget is independent of workflow step order

- **GIVEN** the shell has already been copied into `site/dist/app/`
- **WHEN** the JS bundle budget check runs
- **THEN** it SHALL report the same total as it would before the copy, so the check cannot be broken
  by reordering the build steps
- **AND** the exclusion assumes `site/dist/app/` holds only neutral-shell output; a future site page
  published under `/app/` would escape the budget and SHALL require this scope to be revisited

#### Scenario: Lighthouse mobile targets

- **GIVEN** a Lighthouse mobile audit of the deployed site
- **WHEN** the audit completes
- **THEN** Performance, Accessibility, Best Practices, and SEO each score at least 95
