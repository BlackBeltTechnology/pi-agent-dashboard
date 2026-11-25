## MODIFIED Requirements

### Requirement: Baseline policy directives

The baseline CSP header value SHALL contain the baseline directives that restrict script execution, framing, object embedding, and base URI while permitting same-origin resources plus the specific inline-style/worker/websocket allowances the dashboard requires. The `strict` policy and the `baseline` policy SHALL differ only in `script-src`. A route-level per-response policy is not bound by this directive set. `frame-src` admits same-origin and `https:` frames so editor-pane web tabs can embed external pages that permit it, plus the live-preview capability origins the dashboard itself mints, built at response time from the page request's `Host`: `http://*.localhost:<HostPort>` only while `liveServer.previewOrigins.enabled` is true (the port is the page's own `Host` port, never `:*`, so an `ssh -L` forward on any local port still works because the preview uses the same port); `http://*.<a-b-c-d>.<ipDnsSuffix>:<HostPort>` only while `liveServer.previewOrigins.ipDnsSuffix` is configured and the page was requested with an IP-literal `Host` (`<a-b-c-d>` is that IP, dashed); `http://*.<wildcard.suffix>[:<port>]` only while `liveServer.previewOrigins.wildcard.scheme` is `http`; and `http://<HostIP>:*` only while `liveServer.previewOrigins.portPool` is configured and the page was requested with an IP-literal `Host`. The tier-3 entry keeps `:*` because an explicit list of up to 100 pool ports would bloat every response (user-confirmed); CSP has no port ranges. Every other source, including the bare scheme sources `http:`, `data:` and `blob:`, and the bare wildcard `*`, stays blocked; no wildcard host-source is emitted for a configured wildcard domain beyond what `https:` already covers and the `wildcard.scheme: http` entry above. `<HostPort>` is the `Host` port, else the accepting socket's port, omitted when it is the scheme default (80 for http); the same rule applies to the localhost and ipDns entries, and a `wildcard.port` equal to the scheme default is omitted. When the page `Host` is an IPv6 literal (`[::1]`) no tier 1-4 source is emitted, because CSP has no IPv6 host-source form; `frame-src` never carries an IPv6 entry.

#### Scenario: Policy directive set
- **WHEN** the server emits the strict policy
- **THEN** the header value SHALL contain `default-src 'self'`
- **AND** on an HTML document it SHALL contain a `script-src` of `'self'` plus a per-response `'nonce-…'` source and no other script source
- **AND** it SHALL contain `style-src 'self' 'unsafe-inline'`
- **AND** it SHALL contain `img-src 'self' data: blob:`
- **AND** it SHALL contain `font-src 'self' data:`
- **AND** it SHALL contain `worker-src 'self' blob:`
- **AND** it SHALL contain `connect-src 'self' ws: wss:`
- **AND** it SHALL contain a `frame-src` beginning with `'self' https:` and followed only by the live-preview capability sources named above
- **AND** it SHALL contain `object-src 'none'`
- **AND** it SHALL contain `base-uri 'self'`
- **AND** it SHALL contain `frame-ancestors 'self'`

#### Scenario: Current policy directive set
- **WHEN** the server emits the `baseline` policy in `report` mode
- **THEN** it SHALL contain `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
- **AND** every other baseline directive SHALL match the `strict` policy

#### Scenario: Non-https frame sources stay blocked
- **WHEN** the server emits either policy
- **THEN** `frame-src` SHALL NOT contain the bare scheme sources `http:`, `data:` or `blob:`, nor a bare `*` source
- **AND** every `http:` entry SHALL be a host-source of the forms `http://*.localhost:<HostPort>`, `http://*.<a-b-c-d>.<ipDnsSuffix>:<HostPort>`, `http://*.<wildcard.suffix>[:<port>]` (only while `wildcard.scheme` is `http`), or `http://<HostIP>:*`

#### Scenario: Localhost preview origins are framed on the page's own port
- **WHEN** `liveServer.previewOrigins.enabled` is true and the dashboard page is requested with `Host: localhost:9000`
- **THEN** `frame-src` SHALL contain `http://*.localhost:9000` and SHALL NOT contain `http://*.localhost:*`

#### Scenario: No localhost preview source when previews are disabled
- **WHEN** `liveServer.previewOrigins.enabled` is `false`
- **THEN** `frame-src` SHALL NOT contain any `http://*.localhost` entry

#### Scenario: IP-DNS-suffix origins are framed on the page's own IP when configured
- **WHEN** `liveServer.previewOrigins.ipDnsSuffix` is `sslip.io` and the dashboard page is requested with `Host: 192.168.1.5:8000`
- **THEN** `frame-src` SHALL contain `http://*.192-168-1-5.sslip.io:8000` and SHALL NOT contain `http://*.sslip.io:*`
- **WHEN** `liveServer.previewOrigins.ipDnsSuffix` is not configured, or the page is requested with a hostname `Host`
- **THEN** `frame-src` SHALL NOT contain any `<a-b-c-d>.<suffix>` entry

#### Scenario: Plain-http wildcard domain is framed only while its scheme is http
- **WHEN** `liveServer.previewOrigins.wildcard.suffix` is `preview.test`, `wildcard.scheme` is `http`, and `wildcard.port` is `8000`
- **THEN** `frame-src` SHALL contain `http://*.preview.test:8000`
- **WHEN** `wildcard.scheme` is `https` or unset
- **THEN** `frame-src` SHALL NOT contain any `http://*.<wildcard.suffix>` entry (`https:` already covers it)

#### Scenario: Pool origins are framed on the page's own IP when tier 3 is configured
- **WHEN** `liveServer.previewOrigins.portPool` is `8100-8199` and the dashboard page is requested with `Host: 192.168.1.5:8000`
- **THEN** `frame-src` SHALL contain `http://192.168.1.5:*`
- **AND** it SHALL NOT contain any other IP's host-source and no bare `http:` or `*`

#### Scenario: Host without a port uses the accepting socket's port
- **WHEN** the dashboard page is requested with `Host: localhost` on a socket accepting on port 9000 and `ipDnsSuffix` is `sslip.io`
- **THEN** `frame-src` SHALL contain `http://*.localhost:9000`
- **WHEN** the page is requested with `Host: 192.168.1.5` on a socket accepting on port 80
- **THEN** `frame-src` SHALL contain `http://*.192-168-1-5.sslip.io` with no port and SHALL NOT contain `:80`
- **WHEN** `wildcard` is `{ suffix: "preview.test", scheme: "http", port: 80 }`
- **THEN** `frame-src` SHALL contain `http://*.preview.test` with no port

#### Scenario: IPv6 literal Host emits no preview sources
- **GIVEN** `portPool` `8100-8199` and `ipDnsSuffix` `sslip.io` are configured
- **WHEN** the dashboard page is requested with `Host: [::1]:8000`
- **THEN** `frame-src` SHALL equal `'self' https:` with no `http://` entry and no `[`
- **AND** `frame-ancestors` SHALL be `'self'`

#### Scenario: No pool source without tier 3 or an IP Host
- **WHEN** `portPool` is not configured, or the page is requested with a hostname Host such as `dash.example.com`
- **THEN** `frame-src` SHALL NOT contain any `http://<IP>:*` entry

### Requirement: Own responses only, skip proxied prefixes

The server SHALL apply the CSP header only to its own responses and SHALL skip any request whose URL begins with a proxied/sandboxed prefix (`/live/`, `/preview/`) so that the proxied target's own policy is preserved. Responses under these prefixes are governed by their route-level policy, not by the dashboard page policy.

#### Scenario: Header applied to dashboard's own path
- **WHEN** the mode is `report` or `enforce`
- **AND** a request URL does not begin with a skipped prefix
- **THEN** the CSP header SHALL be added to the response

#### Scenario: Proxied prefix skipped
- **WHEN** a request URL begins with `/live/`
- **THEN** the server SHALL NOT add any CSP header to the response
- **AND** the payload SHALL be returned unchanged

#### Scenario: Preview prefix skipped
- **WHEN** a request URL begins with `/preview/`
- **THEN** the server SHALL NOT add the dashboard page CSP header to the response
- **AND** the payload SHALL be returned unchanged apart from the route-level live-preview policy

#### Scenario: Existing header preserved
- **WHEN** the response already has the CSP header set for the active mode
- **THEN** the server SHALL NOT overwrite the existing header value

## ADDED Requirements

### Requirement: Preview prefix carries no dashboard Trusted Types directive
A response whose request URL begins with `/preview/` SHALL carry no Trusted Types directive from the dashboard, matching the `/live/` rule, because the preview's own route-level policy (and the previewed server's own policy) governs it.

#### Scenario: Preview prefix untouched
- **WHEN** a request URL begins with `/preview/`
- **THEN** the response carries no Trusted Types directive from the dashboard
