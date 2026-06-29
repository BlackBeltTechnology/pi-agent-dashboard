# server-bind-host Specification

## Purpose
TBD - created by archiving change configurable-bind-host. Update Purpose after archive.
## Requirements
### Requirement: Loopback bind default

The dashboard HTTP server and the pi gateway WebSocket server MUST bind `127.0.0.1` by default. When no bind host is configured via flag, environment, or config file, both listeners SHALL be reachable only on loopback and MUST NOT be reachable on any routable network interface.

#### Scenario: default install binds loopback only
- **GIVEN** no `--host` flag, no `PI_DASHBOARD_HOST` env var, and no `bindHost` in config.json
- **WHEN** the dashboard server starts
- **THEN** the HTTP listener SHALL bind `127.0.0.1`
- **AND** the pi gateway WebSocket listener SHALL bind `127.0.0.1`
- **AND** neither port SHALL accept a connection arriving on a non-loopback interface

#### Scenario: model-proxy second port stays loopback
- **GIVEN** the optional model-proxy second port is enabled
- **WHEN** the server starts with any `bindHost` value
- **THEN** the model-proxy second port SHALL remain bound to `127.0.0.1`

### Requirement: Bind host resolution precedence

The effective bind host MUST resolve through the same precedence chain used for `port`: the `--host` CLI flag overrides the `PI_DASHBOARD_HOST` environment variable, which overrides `config.bindHost` from config.json, which overrides the hardcoded default `127.0.0.1`. The resolved bind host SHALL govern both the HTTP listener and the pi gateway listener.

#### Scenario: env var opts into all interfaces
- **GIVEN** `PI_DASHBOARD_HOST=0.0.0.0` and no `--host` flag
- **WHEN** the server starts
- **THEN** the HTTP and pi gateway listeners SHALL bind `0.0.0.0`

#### Scenario: CLI flag overrides env and config
- **GIVEN** `PI_DASHBOARD_HOST=0.0.0.0`, `config.bindHost = "10.0.0.5"`, and `--host 127.0.0.1`
- **WHEN** the server starts
- **THEN** the listeners SHALL bind `127.0.0.1`

#### Scenario: config overrides default
- **GIVEN** `config.bindHost = "10.0.0.5"` and no flag or env var
- **WHEN** the server starts
- **THEN** the listeners SHALL bind `10.0.0.5`

### Requirement: Bind host change requires restart

Changing `bindHost` through the config API MUST be reported as restart-required, consistent with `port` and `piPort`. The running server SHALL NOT attempt to rebind a live socket; the new bind host SHALL take effect only on the next start.

#### Scenario: writing bindHost reports restart required
- **GIVEN** a running server
- **WHEN** the config API persists a new `bindHost` value
- **THEN** the write result SHALL indicate a restart is required
- **AND** the live listeners SHALL keep their current bind until restart

### Requirement: Settings exposes a constrained interface picker

The Settings UI MUST present the listen interface as a constrained choice — Local only (`127.0.0.1`), All interfaces (`0.0.0.0`), or a specific detected interface — rather than a free-text host field. The specific-interface options SHALL come from the existing network-interfaces detection endpoint. Selecting All interfaces while neither authentication nor trusted networks are configured SHALL display an advisory exposure warning; the warning SHALL NOT alter request-guard behavior.

#### Scenario: picker offers detected interfaces
- **GIVEN** the host has a non-internal IPv4 interface `10.0.0.5`
- **WHEN** the user opens the listen-interface picker and chooses "Specific interface"
- **THEN** `10.0.0.5` SHALL appear as a selectable option sourced from the network-interfaces endpoint

#### Scenario: exposure warning on all-interfaces without guard config
- **GIVEN** no auth providers and no trusted networks are configured
- **WHEN** the user selects All interfaces
- **THEN** an advisory exposure warning SHALL be shown
- **AND** the request guard behavior SHALL remain unchanged

