# Marketing Site

## Purpose

Defines the public marketing site at pi-dashboard.dev: a single hand-written static page in `site/` (no framework, no bundler), its System / Light / Dark theming with no flash of unstyled content, the hero product film, the ambient WebGL background, the Why section, the static features grid, the on-page FAQ, the search metadata, structured data and crawler files that tie it to the pi coding agent, the latest-release surface that auto-syncs, GitHub Pages deployment, the static-site screenshot and audit driver, and the performance and accessibility budgets it must meet.

## Requirements

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

### Requirement: Theme selector with System / Light / Dark and no FOUC

The site SHALL support a System / Light / Dark theme selector with
pre-paint resolution of the initial theme. Dark is the default token set;
light is signalled by `data-theme="light"` on `<html>`.

#### Scenario: First paint matches the resolved theme

- **GIVEN** a visitor with `localStorage.pi-theme` unset and an OS set to
  light mode
- **WHEN** they load the site for the first time
- **THEN** an inline script, first in `<head>` before any stylesheet, sets
  `data-theme="light"` on `<html>`, so no flash of dark content appears
- **AND** with the OS in dark mode the attribute is absent

#### Scenario: Explicit choice is persisted across reloads

- **GIVEN** a visitor who clicks the Light option in the theme selector
- **WHEN** they reload the page
- **THEN** `<html>` carries `data-theme="light"`, `localStorage.pi-theme`
  is `"light"`, and the Light option has `aria-checked="true"`

#### Scenario: System mode tracks OS changes live

- **GIVEN** a visitor in System mode
- **WHEN** they toggle their OS color-scheme preference while the page is
  open
- **THEN** the site's theme updates to match without a reload

#### Scenario: Hero and feature mockups swap per theme

- **GIVEN** a visitor switches between light and dark modes
- **WHEN** the theme changes
- **THEN** the hero film's poster and sources swap to the matching
  `media/hero-<theme>-*` files and playback seeks back to the timestamp it
  was at before the swap

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

- **GIVEN** a commit to `develop` that modifies any file under `site/**` (excluding the `site/design-scratch/**` design-source sandbox, which is filtered out), under `packages/shell/**`, or the deploy workflow itself
- **WHEN** the workflow runs
- **THEN** it builds the site, uploads the output as a Pages artifact, and deploys it via `actions/deploy-pages`

#### Scenario: Deploy workflow can be run manually

- **GIVEN** a maintainer needs to redeploy without a source change
- **WHEN** they trigger `workflow_dispatch` on the site-deploy workflow against `develop`
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

- **GIVEN** the audit driver (`npm --prefix site run audit`) against the
  page served by `npm --prefix site run dev`
- **WHEN** it sweeps the declared themes across the declared viewports
- **THEN** it reports no document overflow and no dead in-page anchors,
  and exits non-zero on a violation

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

### Requirement: pi entity is named and linked

Because "pi" collides with unrelated products, the page SHALL name the
upstream project as "the pi coding agent" and SHALL link its repository
`https://github.com/badlogic/pi-mono` from visible copy.

#### Scenario: Hero subhead names and links the pi coding agent

- **GIVEN** the hero subhead in `site/index.html`
- **WHEN** it is inspected
- **THEN** it contains a link to `https://github.com/badlogic/pi-mono`
  whose text is the full phrase "pi coding agent" (case-insensitive), not
  the bare word "pi"

#### Scenario: FAQ restates the pi-only scope with the upstream link

- **GIVEN** the `#faq` section
- **WHEN** the coding-agent compatibility item is inspected
- **THEN** it links to `https://github.com/badlogic/pi-mono`

### Requirement: Search-engine metadata and structured data

`site/index.html` SHALL declare search and social metadata that name the
product together with the pi coding agent, and SHALL embed one JSON-LD
`SoftwareApplication` description that contains no release-specific values.

#### Scenario: Title and description carry the entity

- **GIVEN** the `<head>` of `site/index.html`
- **WHEN** it is inspected
- **THEN** `<title>` is at most 60 characters and contains "PI Dashboard"
  and "pi Coding Agent" (case-insensitive)
- **AND** `meta[name=description]` is at most 155 characters and contains
  "pi coding agent" (case-insensitive)
- **AND** a canonical link points to `https://pi-dashboard.dev/`

#### Scenario: Social card is declared completely and stays light

- **GIVEN** the head and `site/public/`
- **WHEN** the og metadata is inspected
- **THEN** `og:image` and `twitter:image` are absolute
  `https://pi-dashboard.dev/<file>` URLs whose `<file>` exists in
  `site/public/` and is no larger than 300 KB
- **AND** `og:image:width`, `og:image:height` and `og:image:alt` are declared

#### Scenario: Structured data parses and names the upstream entity

- **GIVEN** the single `script[type="application/ld+json"]` block
- **WHEN** it is parsed as JSON
- **THEN** it is one object with `@context` `https://schema.org`, `@type`
  `SoftwareApplication`, non-empty `name`, `description`, `operatingSystem`
  and `applicationCategory`, an `offers` object with `price` `"0"` and `priceCurrency` `"USD"`, and a
  `license` URL
- **AND** its `sameAs` includes the GitHub repository URL, the npm package
  URL and `https://github.com/badlogic/pi-mono`
- **AND** it has no `softwareVersion` key and no URL containing
  `/releases/download/`, so a release never makes it stale

### Requirement: Crawler directive files

The deployed site root SHALL serve `robots.txt`, `sitemap.xml` and
`llms.txt`, sourced from `site/public/`. The pairing shell under `/app/`
SHALL be excluded from crawling.

#### Scenario: robots.txt points at the sitemap and excludes the shell

- **GIVEN** `site/public/robots.txt`
- **WHEN** it is read
- **THEN** it contains `User-agent: *`, `Disallow: /app/` and
  `Sitemap: https://pi-dashboard.dev/sitemap.xml`, and no `Disallow: /`
  line that blocks the whole site

#### Scenario: sitemap lists only the canonical page

- **GIVEN** `site/public/sitemap.xml`
- **WHEN** it is read
- **THEN** its root element is `urlset` with
  `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` and it contains
  exactly one `<loc>`, equal to `https://pi-dashboard.dev/`

#### Scenario: llms.txt summarizes the product in plain text

- **GIVEN** `site/public/llms.txt`
- **WHEN** it is read
- **THEN** its first line is `# PI Dashboard`, it contains the phrase
  "pi coding agent", and it links `https://pi-dashboard.dev/`, the GitHub
  repository and `https://github.com/badlogic/pi-mono`

#### Scenario: Build ships the crawler files

- **GIVEN** `npm --prefix site run build` has run
- **WHEN** `site/dist/` is listed
- **THEN** `robots.txt`, `sitemap.xml` and `llms.txt` exist at its root

### Requirement: On-page FAQ

`site/index.html` SHALL include a `#faq` section of question/answer pairs,
placed after the `#install` section, covering: coding-agent compatibility
(asked as "Does it work with Claude Code or other coding agents?" and
answered: only the pi coding agent, Oh My Pi not supported, model providers
still usable through pi), whether pi must be installed first (per install
route), license and self-hosting, phone access, model providers, and
first-run unblocking of unsigned builds. Each answer SHALL restate only
facts already stated on the page or in the repository README, and SHALL
carry a source comment naming where that fact is stated.

#### Scenario: FAQ items are present and readable without JavaScript

- **GIVEN** the `#faq` section
- **WHEN** the static markup is inspected
- **THEN** it appears after `#install` in document order and contains at
  least six `<details>` elements, each with a `<summary>` question and
  answer text in the markup
- **AND** the section text contains each topic keyword: "Claude Code",
  "Oh My Pi", "install", "MIT", "phone", "Anthropic", "SmartScreen"
- **AND** every `<details>` element contains a `<!-- source:` comment

#### Scenario: FAQ in-page links resolve

- **GIVEN** every `href="#<id>"` inside `#faq`
- **WHEN** the static markup is inspected
- **THEN** an element with `id="<id>"` exists in `site/index.html`
- **AND** the unsigned-build item links to `#install`

#### Scenario: FAQ styling uses tokens only

- **GIVEN** the `#faq` markup and any CSS rule whose selector targets it
- **WHEN** they are inspected
- **THEN** they contain no hex colour literal and no `rgb(`/`hsl(` literal

### Requirement: Static features grid

The site SHALL present the product's headline features in a `#features`
section as a grid of cards. Each card has a short `<h3>` title and a body
that names its capability in the words a searcher would use.

#### Scenario: Feature cards carry titles and bodies

- **GIVEN** the `#features` section of `site/index.html`
- **WHEN** it is inspected
- **THEN** it contains at least nine cards, each with an `<h3>` and body text

#### Scenario: Capability phrases are bound to their cards

- **GIVEN** the feature cards
- **WHEN** each card's body text is inspected (case-insensitive)
- **THEN** "Branches and worktrees" contains "git worktree" and "OpenSpec",
  "Watch multi-agent runs" contains "in parallel", "Cron and file triggers"
  contains "schedule", and "Phone in 10 seconds" contains "from your phone"

### Requirement: Why section frames the waiting problem

The site SHALL include a `#control` section after the hero that argues
long agent runs are mostly waiting, and shows a glanceable session list
distinguishing working, blocked-on-you and idle sessions.

#### Scenario: Section states the argument and shows statuses

- **GIVEN** the `#control` section
- **WHEN** it renders
- **THEN** its `<h2>` text (tags stripped) is "Agents run for hours. You
  should not have to sit there.", and its sample session list shows at
  least the statuses "Working", "Needs you" and "Idle"

### Requirement: Hero product film

The hero SHALL show a looping screen recording of the real dashboard UI,
rendered for both themes (theme switching: see "Theme selector with System
/ Light / Dark and no FOUC").

#### Scenario: Film is muted, inline and described

- **GIVEN** the hero `<video id="film">`
- **WHEN** it is inspected
- **THEN** it has `autoplay`, `muted`, `loop`, `playsinline`, a `poster`,
  WebM and MP4 sources, and an `aria-label` describing what it shows

### Requirement: Ambient WebGL background

The page SHALL render decorative background canvases (`#field`, driven by
`site/field.js`, and `#life`, driven by `site/gol.js`) that follow the
theme while animating and show a single still frame for reduced-motion
users.

#### Scenario: Canvases are decorative

- **GIVEN** the `#field` and `#life` canvases
- **WHEN** they are inspected
- **THEN** each has `aria-hidden="true"`

#### Scenario: Animated background follows the theme

- **GIVEN** the background is animating (reduced motion not requested)
- **WHEN** the `data-theme` attribute on `<html>` changes
- **THEN** both renderers re-apply their palette via a `MutationObserver`
  on `data-theme`, and the next animated frame uses it, without a page
  reload

#### Scenario: Reduced-motion users get a still frame

- **GIVEN** a visitor with `prefers-reduced-motion: reduce`
- **WHEN** the page loads, or the preference changes while it is open
- **THEN** each renderer composes a single still frame and schedules no
  animation loop

### Requirement: Script-applied scroll reveal

Cards, section headings, and key content blocks SHALL animate into view
when they enter the viewport, with staggered timing and reduced-motion
support. The hidden state SHALL only ever be applied by script, so that
content is visible when script or `IntersectionObserver` is unavailable.

#### Scenario: Elements reveal on intersection

- **GIVEN** an element the reveal script tagged with the `.reveal` class
- **WHEN** it crosses into the viewport
- **THEN** the `.in` class is added and an opacity/transform transition
  brings it in, with a per-parent stagger capped at 5 × 70 ms

#### Scenario: Reveals reverse on exit in the direction of travel

- **GIVEN** a revealed element
- **WHEN** it leaves the viewport
- **THEN** `.in` is removed and its offset is set to the side it left
  through, so it re-reveals when scrolled back

#### Scenario: Reduced motion or missing observer leaves content visible

- **GIVEN** a visitor with `prefers-reduced-motion: reduce`, or a browser
  without `IntersectionObserver`
- **WHEN** the page loads
- **THEN** no element receives the `.reveal` class, and all content is
  visible from first paint

### Requirement: Static-site screenshot and audit driver

The repository SHALL provide a scripted, re-runnable screenshot and
layout-audit driver for the static site (`site/design-scratch/scripts/shoot.mjs`),
bound to the repository root's Playwright install.

#### Scenario: Screenshots run from a single command

- **GIVEN** the repository root with Playwright installed and the static
  page served by `npm --prefix site run dev` (default `http://localhost:8791`)
- **WHEN** a developer runs `npm --prefix site run shots`
- **THEN** the driver captures the sections `hero`, `control`, `features`,
  `download`, `install` and `faq` by default, across the declared themes
  and viewports, and writes PNGs, with no dashboard server or seeded
  session data

#### Scenario: Audit runs without screenshots

- **GIVEN** the same setup
- **WHEN** a developer runs `npm --prefix site run audit`
- **THEN** the driver writes no PNGs, reports document and nav overflow,
  dead in-page anchors, broken images, page errors and a non-sticky header,
  and exits non-zero on any of them

#### Scenario: Root script points at the live driver

- **GIVEN** the root `package.json`
- **WHEN** its `screenshots` script is run
- **THEN** it invokes the site's `shots` script rather than a script name
  that `site/package.json` does not define
