# auth-bypass-url-list Specification

## Purpose

Defines which requests may skip dashboard authentication: a configurable list of bypass URLs and a configurable set of trusted hosts that bypass by source IP. Exists so local and automated callers can reach specific endpoints without a token, while keeping the bypass surface explicit and reviewable rather than implicit in route code.

## Requirements

### Requirement: Configurable auth bypass URL list
The dashboard SHALL support a `bypassUrls` field inside `auth` config containing an array of URL path prefixes that skip OAuth authentication for HTTP requests. When a request URL starts with any entry in the list, the `onRequest` hook SHALL allow the request through without requiring a valid session cookie. The field SHALL be optional; when absent or empty, behaviour SHALL be identical to the current implementation.

#### Scenario: Request matches a bypass prefix
- **WHEN** `auth.bypassUrls` contains `"/webhooks/"` and an unauthenticated request arrives at `/webhooks/github`
- **THEN** the server SHALL process the request without redirecting to `/auth/login` or returning 401

#### Scenario: Request does not match any bypass prefix
- **WHEN** `auth.bypassUrls` contains `"/webhooks/"` and an unauthenticated request arrives at `/api/sessions`
- **THEN** the server SHALL enforce authentication as normal (redirect or 401)

#### Scenario: bypassUrls is empty
- **WHEN** `auth.bypassUrls` is `[]` or omitted from config
- **THEN** auth bypass behaviour SHALL be identical to the current implementation (no additional paths bypassed)

#### Scenario: Multiple bypass prefixes
- **WHEN** `auth.bypassUrls` is `["/metrics", "/healthz"]` and unauthenticated requests arrive at `/metrics` and `/healthz/ready`
- **THEN** both requests SHALL be allowed through without authentication

#### Scenario: Bypass prefix is not a prefix of the request URL
- **WHEN** `auth.bypassUrls` contains `"/api/public"` and the request URL is `/api/publications`
- **THEN** authentication SHALL be enforced (prefix must be a leading substring match — `startsWith`)

### Requirement: Configurable trusted hosts (auth bypass by source IP)
The dashboard SHALL support a `bypassHosts` field inside `auth` config containing an array of trusted source IPs or hostnames. Requests originating from a matching IP SHALL skip OAuth authentication for both HTTP requests and WebSocket upgrades. The field SHALL be optional; when absent or empty, no additional hosts are bypassed.

Supported formats:
- **Exact IP**: `"10.0.0.5"` — matches that specific IP
- **Wildcard**: `"10.0.0.*"` — matches any IP where `*` is replaced by digits
- **CIDR**: `"192.168.1.0/24"` — matches IPs within the CIDR range

#### Scenario: Request from exact trusted IP
- **WHEN** `auth.bypassHosts` contains `"10.0.0.5"` and a request arrives from `10.0.0.5`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: Request from untrusted IP
- **WHEN** `auth.bypassHosts` contains `"10.0.0.5"` and a request arrives from `10.0.0.6`
- **THEN** the server SHALL enforce authentication as normal

#### Scenario: Wildcard match
- **WHEN** `auth.bypassHosts` contains `"10.0.0.*"` and a request arrives from `10.0.0.99`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: CIDR match
- **WHEN** `auth.bypassHosts` contains `"192.168.1.0/24"` and a request arrives from `192.168.1.50`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: CIDR non-match
- **WHEN** `auth.bypassHosts` contains `"192.168.1.0/24"` and a request arrives from `192.168.2.50`
- **THEN** the server SHALL enforce authentication as normal

#### Scenario: WebSocket upgrade from trusted host
- **WHEN** `auth.bypassHosts` contains `"10.0.0.5"` and a WebSocket upgrade request arrives from `10.0.0.5` without an auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: bypassHosts is empty
- **WHEN** `auth.bypassHosts` is `[]` or omitted from config
- **THEN** no additional hosts SHALL be bypassed (only localhost loopback applies)
