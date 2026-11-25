## MODIFIED Requirements

### Requirement: Public marketing site source

The repository SHALL contain a self-contained marketing site at `/site/`: a hand-written static page (`site/index.html`, `site/404.html`, assets) plus static policy pages (`site/privacy.html`, `site/terms.html`) and the static Google sign-in return page (`site/oauth/return.html`) assembled by `node site/build.mjs` with no framework and no runtime npm dependencies, producing a fully static output.

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

#### Scenario: Policy and return pages ship

- **GIVEN** `npm --prefix site run build` has run
- **WHEN** `site/dist/` is listed
- **THEN** `privacy.html`, `terms.html` and `oauth/return.html` exist

### Requirement: Crawler directive files

The deployed site root SHALL serve `robots.txt`, `sitemap.xml` and
`llms.txt`, sourced from `site/public/`. The pairing shell under `/app/`
and the Google sign-in return page under `/oauth/` SHALL be excluded from crawling.

#### Scenario: robots.txt points at the sitemap and excludes the shell

- **GIVEN** `site/public/robots.txt`
- **WHEN** it is read
- **THEN** it contains `User-agent: *`, `Disallow: /app/`, `Disallow: /oauth/` and
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

## ADDED Requirements

### Requirement: Return page is locked down as a static file
`site/oauth/return.html` SHALL carry a meta Content-Security-Policy that allows only its own inline script and style by hash (`default-src 'none'`), a `no-referrer` meta referrer policy, and SHALL refuse to act when framed. `node site/build.mjs` SHALL compute the hashes and fail when the page's inline script or style does not match them, and SHALL check local references in every shipped HTML page.

#### Scenario: Edited script without a new hash
- **WHEN** the inline script of `oauth/return.html` is edited and the build runs
- **THEN** the build fails naming the hash mismatch

#### Scenario: Page loaded in a frame
- **WHEN** `oauth/return.html` is loaded inside an iframe with a code in its address
- **THEN** it shows an error and offers no Continue control

### Requirement: Privacy page names the return page
`site/privacy.html` SHALL state that for dashboards on another computer Google returns the browser once through `https://pi-dashboard.dev/oauth/return.html`, which stores nothing, and that the static host may log that address.

#### Scenario: Privacy page text
- **WHEN** the built `privacy.html` is read
- **THEN** it names `oauth/return.html` and the static-host logging
