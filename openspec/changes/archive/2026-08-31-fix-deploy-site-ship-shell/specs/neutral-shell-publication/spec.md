## ADDED Requirements

### Requirement: Shell publishes to the /app/ subpath of the marketing origin

The neutral shell SHALL be published as a static artifact at `https://pi-dashboard.dev/app/`. GitHub Pages serves one site per repository and `site/` owns the apex, so the shell SHALL occupy a subpath of that same origin rather than a separate host.

#### Scenario: Shell is reachable at the subpath

- **GIVEN** a successful `Deploy Site` run
- **WHEN** a browser requests `https://pi-dashboard.dev/app/`
- **THEN** the neutral shell's `index.html` is served with HTTP 200

#### Scenario: Apex continues to serve the marketing site

- **GIVEN** the same deploy
- **WHEN** a browser requests `https://pi-dashboard.dev/`
- **THEN** the marketing site is served, unaffected by the shell's presence under `/app/`

### Requirement: Shell builds with a relative asset base

The shell SHALL build with a relative base (`base: "./"`) so its emitted asset URLs resolve correctly beneath any subpath. An absolute base would emit `/assets/…` URLs that resolve against the apex and collide with the marketing site's own assets.

#### Scenario: Assets resolve beneath the subpath

- **GIVEN** the shell built with `base: "./"`
- **WHEN** `https://pi-dashboard.dev/app/` loads
- **THEN** its script and stylesheet URLs resolve under `/app/` and return 200, not under the apex

### Requirement: Subpath publication preserves the apex web origin

Publishing at a subpath SHALL NOT change the shell's web origin: a URL path is not part of an origin, so a document at `https://pi-dashboard.dev/app/` has origin `https://pi-dashboard.dev`. The server's existing built-in CORS allowance for the neutral shell therefore covers the shell without a second entry.

The CORS behaviour itself is owned by the `server-cors` capability, requirement "Neutral shell origin trusted by default". This requirement SHALL NOT restate it; it fixes only the property that makes it applicable.

#### Scenario: Shell requests carry the apex origin

- **GIVEN** the shell loaded from `https://pi-dashboard.dev/app/`
- **WHEN** it issues a cross-origin request to a paired dashboard server
- **THEN** the `Origin` header is exactly `https://pi-dashboard.dev`, which the server's built-in allowance matches without additional configuration

### Requirement: Shell relies on hash routing, not a server-side SPA fallback

The shell SHALL route on the URL hash so that no deep link requires server-side rewriting. Its build emits `site/dist/app/404.html`, but that file is inert in this deployment: GitHub Pages serves the repository-root `404.html` for any unmatched path, and the marketing site supplies one.

A stray non-hash path beneath `/app/` therefore renders the marketing 404 page, not the shell. This is recorded as actual behaviour; no SPA fallback SHALL be claimed for the subpath.

#### Scenario: Hash deep link loads the shell

- **GIVEN** a shell URL of the form `https://pi-dashboard.dev/app/#/pair`
- **WHEN** it is opened directly
- **THEN** the server serves `/app/index.html` (the fragment is never sent to the server) and the shell routes to the Pair view client-side

#### Scenario: Non-hash path beneath /app/ falls through to the site 404

- **GIVEN** a request to `https://pi-dashboard.dev/app/does-not-exist`
- **WHEN** GitHub Pages resolves it
- **THEN** the marketing site's root `404.html` is served rather than the shell
- **AND** this is accepted, because hash routing means no legitimate shell link takes that form
