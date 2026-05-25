# pwa-manifest — Delta

## MODIFIED Requirements

### Requirement: Web app manifest

The server SHALL serve `/manifest.json` from a dynamic route that returns a valid web app manifest JSON document. The manifest SHALL include `display` set to `standalone`, `start_url` set to `/`, `id` set to `/`, `theme_color` and `background_color` set to appropriate brand colors, and at least one icon entry. The static `public/manifest.json` SHALL be the source of icon, color, display, and start_url fields and SHALL be loaded at server startup.

The `name` field SHALL be `"Pi-Dash · <source>"` and `short_name` SHALL be `<source>` truncated to the first 12 characters, where `<source>` is the first non-empty value of:

1. `dashboardName` from `~/.pi/dashboard/config.json`, trimmed.
2. The request `Host` header with port stripped (including IPv6 bracketed form `[::1]:8000` → `::1`).
3. `os.hostname()`.
4. The literal string `"Pi-Dash"`.

The response SHALL include `Cache-Control: no-cache, must-revalidate` so manifest updates propagate without full uninstall on supported browsers.

The dynamic `/manifest.json` route SHALL be registered before fastify-static so the dynamic body always wins over the on-disk file.

#### Scenario: Manifest is served

- **WHEN** a browser requests `/manifest.json`
- **THEN** the server SHALL return a valid web app manifest JSON document
- **AND** the response SHALL include `id`, `name`, `short_name`, `icons`, `theme_color`, `background_color`, `display`, and `start_url` fields

#### Scenario: Manifest link in HTML

- **WHEN** the client `index.html` is loaded
- **THEN** it SHALL contain a `<link rel="manifest" href="/manifest.json">` tag

#### Scenario: Default name uses Host header when no override is set

- **GIVEN** `dashboardName` is unset in dashboard config
- **WHEN** a browser requests `/manifest.json` with `Host: mybox.local:8000`
- **THEN** the response `name` SHALL be `"Pi-Dash · mybox.local"`
- **AND** the response `short_name` SHALL be `"mybox.local"`

#### Scenario: Default name falls back to os.hostname when Host header is absent

- **GIVEN** `dashboardName` is unset
- **AND** the request has no `Host` header (or it is empty)
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response `name` SHALL be `"Pi-Dash · " + os.hostname()`

#### Scenario: User override wins over Host header and hostname

- **GIVEN** `dashboardName` is set to `"Home NAS"` in dashboard config
- **WHEN** a browser requests `/manifest.json` with `Host: anything.local:8000`
- **THEN** the response `name` SHALL be `"Pi-Dash · Home NAS"`
- **AND** the response `short_name` SHALL be `"Home NAS"`

#### Scenario: Short name is truncated to 12 characters

- **GIVEN** the resolved source is `"abc123.share.zrok.io"`
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response `short_name` SHALL be exactly `"abc123.share"` (12 chars)

#### Scenario: IPv6 host header strips port correctly

- **WHEN** a browser requests `/manifest.json` with `Host: [::1]:8000`
- **THEN** the resolved source SHALL be `"::1"` (brackets removed, port stripped)

#### Scenario: Manifest carries no-cache headers

- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL include `Cache-Control: no-cache, must-revalidate`

## ADDED Requirements

### Requirement: Dashboard display-name config field

The dashboard config (`~/.pi/dashboard/config.json`) SHALL accept an optional `dashboardName` string field used as the source for the PWA manifest name. The Settings panel SHALL expose this field as a single free-text input under General settings.

#### Scenario: Blank override falls back to auto-derived name

- **GIVEN** `dashboardName` is set to `""` (empty) or `"   "` (whitespace only)
- **WHEN** the manifest route resolves the source
- **THEN** the override SHALL be ignored and Host-header/hostname fallback SHALL apply

#### Scenario: Settings panel exposes the field

- **WHEN** the user opens Settings
- **THEN** a text input labelled "PWA display name" SHALL be visible under General settings
- **AND** changing the value and saving SHALL persist `dashboardName` to dashboard config
- **AND** clearing the value SHALL remove `dashboardName` from the config payload (or save it as empty/null)
