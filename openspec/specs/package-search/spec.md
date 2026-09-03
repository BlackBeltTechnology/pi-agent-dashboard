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
