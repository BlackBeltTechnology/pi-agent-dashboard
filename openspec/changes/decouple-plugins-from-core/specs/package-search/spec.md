## ADDED Requirements

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
