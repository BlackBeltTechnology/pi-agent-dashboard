# package-search Specification

## Purpose

Lets the dashboard search npm for pi packages and read their READMEs by proxying both through the server, so the browser needs no direct npm access.

## Requirements

### Requirement: Server proxies npm search for pi packages
The server SHALL expose `GET /api/packages/search` that proxies search requests to the npm registry filtered by `keywords:pi-package`. The endpoint SHALL accept `q` (search text) and `type` (extension/skill/theme/prompt) query parameters. Results SHALL be cached server-side with a 5-minute TTL.

#### Scenario: Search with query
- **WHEN** client sends `GET /api/packages/search?q=doom`
- **THEN** server queries `registry.npmjs.org/-/v1/search?text=keywords:pi-package+doom` and returns the results as JSON

#### Scenario: Filter by type
- **WHEN** client sends `GET /api/packages/search?q=&type=extension`
- **THEN** server returns only packages whose npm keywords include `extension` or `pi-extension`

#### Scenario: Cache hit
- **WHEN** the same search was performed less than 5 minutes ago
- **THEN** server returns cached results without querying npm

### Requirement: Server proxies package README
The server SHALL expose `GET /api/packages/readme?pkg=<name>` that fetches the package manifest from npm and returns the `readme` field.

#### Scenario: Fetch README
- **WHEN** client sends `GET /api/packages/readme?pkg=pi-doom`
- **THEN** server fetches `registry.npmjs.org/pi-doom` and returns `{ readme: "..." }`

#### Scenario: Package not found
- **WHEN** the package does not exist on npm
- **THEN** server returns 404 with an error message

### Requirement: Search can target dashboard plugins

`GET /api/packages/search` SHALL accept `type=dashboard-plugin`. For that type the server SHALL query npm with `keywords:pi-dashboard-plugin` (plus the search text) instead of `keywords:pi-package`, and the type post-filter SHALL map the keyword `pi-dashboard-plugin` to `dashboard-plugin`. Other types SHALL keep the existing keyword and post-filter. Results SHALL share the existing 5-minute cache, keyed by type and query.

#### Scenario: Plugin search
- **WHEN** a client sends `GET /api/packages/search?q=quota&type=dashboard-plugin`
- **THEN** the server SHALL query `registry.npmjs.org/-/v1/search?text=keywords:pi-dashboard-plugin+quota`
- **AND** every returned package whose keywords include `pi-dashboard-plugin` SHALL be in the response with `types` containing `dashboard-plugin`

#### Scenario: Default search unchanged
- **WHEN** a client sends `GET /api/packages/search?q=doom`
- **THEN** the server SHALL still query `keywords:pi-package+doom`

### Requirement: First-party plugins carry the search keyword

Every first-party plugin package that is not a fixture SHALL list `pi-dashboard-plugin` in its `package.json` `keywords`.

#### Scenario: First-party plugins are findable
- **WHEN** the repository's plugin packages are inspected
- **THEN** every package declaring a plugin manifest and not marked `fixture: true` SHALL list `pi-dashboard-plugin` in `keywords`
