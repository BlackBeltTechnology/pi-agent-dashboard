# pwa-manifest

## Purpose

Dashboard installs as a PWA via a web-app manifest. Manifest name varies by origin (request `Host` header or user override) so multiple installs from the same dashboard against different origins (LAN host, tunnel, loopback) appear as distinct launcher entries. Service worker + meta tags satisfy browser installability prerequisites.

## Requirements

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

### Requirement: Service worker registration
The client SHALL register a service worker (`sw.js`) on page load. The service worker SHALL include a fetch event handler to satisfy PWA installability requirements.

#### Scenario: Service worker registers successfully
- **WHEN** the page loads in a browser that supports service workers
- **THEN** `navigator.serviceWorker.register("/sw.js")` SHALL be called

#### Scenario: Service worker fetch handler
- **WHEN** the service worker intercepts a fetch event
- **THEN** it SHALL pass through to the network (no caching)

#### Scenario: Browser without service worker support
- **WHEN** the page loads in a browser without service worker support
- **THEN** registration SHALL be skipped without errors

### Requirement: PWA meta tags
The `index.html` SHALL include `<meta name="theme-color">` matching the manifest theme color, `<meta name="apple-mobile-web-app-capable" content="yes">` for iOS support, and `<link rel="apple-touch-icon" href="/icon-192.png">` for the iOS home screen icon.

#### Scenario: Meta tags present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain theme-color and apple-mobile-web-app-capable meta tags

#### Scenario: Apple touch icon present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain a `<link rel="apple-touch-icon" href="/icon-192.png">` tag

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
