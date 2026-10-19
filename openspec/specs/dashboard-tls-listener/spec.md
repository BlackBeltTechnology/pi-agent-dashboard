# dashboard-tls-listener Specification

## Purpose
TBD - created by archiving change add-tailscale-cert-tls. Update Purpose after archive.

## Requirements

### Requirement: Optional native TLS listener
The server SHALL support an optional TLS listener, disabled by default, configured by a top-level `tls` block (`enabled`, `port` default `8443`, optional `host` defaulting to `127.0.0.1` regardless of the main listener's bind, `sources`). When enabled, the listener SHALL serve the same HTTP routes and the same WebSocket upgrade paths as the main listener, under the same host-admission, network-guard and authentication rules, with the same keep-alive, connection and request timeouts and the same client-error responses. The main HTTP listener SHALL be unaffected by the presence, absence, or failure of the TLS listener, except that host admission, which matches on the hostname alone, also admits the TLS listener's certificate names on the main listener.

#### Scenario: Disabled by default
- **WHEN** the config has no `tls` block or `tls.enabled` is `false`
- **THEN** no TLS port SHALL be bound and server behaviour SHALL be identical to before this change

#### Scenario: Same routes over TLS
- **WHEN** the TLS listener is running with a valid certificate for `host.example.ts.net`
- **THEN** `GET https://host.example.ts.net:8443/api/health` SHALL return the same response shape as the main listener
- **AND** a WebSocket upgrade to a supported path over `wss://` SHALL be accepted under the same auth rules as on the main listener

#### Scenario: Same guard over TLS
- **WHEN** a request arrives on the TLS listener from a network the universal network guard blocks
- **THEN** it SHALL be rejected exactly as it would be on the main listener

#### Scenario: Certificate names pass host admission
- **WHEN** host admission runs in `enforce` mode and a request arrives with `Host: host.example.ts.net:8443` for a name the listener holds a certificate for
- **THEN** the request SHALL be admitted

#### Scenario: TLS listener failure is isolated
- **WHEN** the TLS port cannot be bound, or a reconcile after a config change fails
- **THEN** the main listener SHALL keep serving
- **AND** the failure SHALL be reported in TLS status with a human-readable error

#### Scenario: Bind retried until the address exists
- **WHEN** `tls.host` is the tailnet address and the tailscale daemon brings that address up two minutes after the server started
- **THEN** the TLS listener SHALL bind without a restart or config change

#### Scenario: Enabled without usable sources
- **WHEN** `tls.enabled` is `true` and `sources` is empty
- **THEN** the TLS port SHALL NOT be bound and TLS status SHALL report a `no-sources` gate as unmet

#### Scenario: Unknown source type rejected
- **WHEN** a config write contains a `tls.sources` entry with an unknown `type`, or a duplicate source `id`
- **THEN** the write SHALL be rejected with HTTP 400 and a validation error naming the entry

#### Scenario: Partial config write preserves sibling keys
- **WHEN** `PUT /api/config` carries `{ "tls": { "enabled": true } }` over a stored `tls` block with `port: 9443` and one source
- **THEN** the stored block SHALL keep `port: 9443` and its source

#### Scenario: No plaintext on the TLS port
- **WHEN** a client sends a plain-HTTP request to the TLS port
- **THEN** the server SHALL NOT serve application content over that connection

#### Scenario: Shutdown closes the TLS listener
- **WHEN** the server stops or restarts
- **THEN** the TLS listener and its open connections SHALL be closed

### Requirement: Certificate selection per SNI name
The TLS listener SHALL select the certificate by the client's SNI server name: an exact-name certificate first, then a wildcard certificate whose `*` covers exactly the single left-most label. A handshake with an SNI name matching no held certificate, or with no SNI, SHALL fail. Newly issued or renewed certificates SHALL be used for subsequent full handshakes without restarting the server or dropping existing connections.

#### Scenario: Renewal without restart
- **WHEN** a certificate is renewed while the listener is running
- **THEN** new full TLS handshakes SHALL present the renewed certificate
- **AND** the server process SHALL NOT restart

#### Scenario: Wildcard single-label match
- **WHEN** the listener holds only `*.example.com`
- **THEN** a handshake for `dash.example.com` SHALL succeed
- **AND** handshakes for `a.b.example.com` and `example.com` SHALL fail

#### Scenario: Unknown SNI name
- **WHEN** a client requests an SNI name for which no certificate is held
- **THEN** the handshake SHALL fail and SHALL NOT fall back to plaintext or to another name's certificate

### Requirement: Certificate lifecycle management
Certificates SHALL be obtained per name from their configured source, re-obtained when the source's certificate-affecting settings change, renewed when less than one third of their validity remains, and retried after a failure with exponential backoff starting at 5 minutes, doubling, capped at 6 hours; a source MAY impose a longer minimum retry delay. At most one issuance per name SHALL run at a time. An operator-triggered issuance SHALL start immediately unless one is already running for that name, in which case it SHALL join the running one. Each held certificate SHALL carry whether it may be advertised as a pairing endpoint and which endpoint kind it maps to, as declared by its source. A name no longer produced by any configured source SHALL be removed from the listener and deleted from disk on reconcile. Before every attempt, scheduled or operator-triggered, unmet gates of the source (source-wide, or scoped to that name) SHALL prevent the attempt without counting it as a failure. An attempt that runs longer than the source's attempt timeout (default 10 minutes) SHALL be abandoned and counted as a failed attempt; its late result SHALL be discarded and a later operator trigger SHALL start a new attempt. A stored source entry that fails validation SHALL be skipped and reported as an `invalid-source` gate while the other sources keep running. A source that cannot currently determine its names (for example because its daemon is down) SHALL NOT cause pruning; its held certificates SHALL keep being served. The failure count and next scheduled attempt per name SHALL survive a server restart. Source types SHALL be pluggable: each type supplies its own config validation, and a new type SHALL be addable without changing this capability. Source ids SHALL be unique across all sources, lowercase letters, digits and hyphens, with `tailscale` reserved for (and the default id of) the tailscale source; an exact-name certificate and a wildcard certificate covering it SHALL NOT conflict (the exact name wins at selection); when two sources produce the same name, the first in `tls.sources` order owns it and the other SHALL report a `name-conflict` gate for it.

#### Scenario: Settings change forces re-issue
- **WHEN** a source's certificate-affecting settings change while it holds a certificate with most of its validity left
- **THEN** a new certificate SHALL be obtained for its names on reconcile

#### Scenario: Removed name is pruned
- **WHEN** a name is removed from a source's configuration
- **THEN** after reconcile the listener SHALL fail handshakes for that name and it SHALL NOT be enumerated

#### Scenario: Unmet gate prevents the attempt
- **WHEN** the `https-certs` gate is unmet and an attempt is due
- **THEN** the source SHALL NOT be asked for a certificate and the failure count SHALL stay unchanged

#### Scenario: Hung attempt abandoned
- **WHEN** an attempt has not finished after the source's attempt timeout
- **THEN** it SHALL be reported failed, an operator trigger SHALL start a new attempt, and a certificate the abandoned attempt returns later SHALL NOT be served

#### Scenario: Source temporarily unable to list names
- **WHEN** the tailscale daemon stops while a valid tailscale certificate is held
- **THEN** reconcile SHALL NOT delete the certificate and the listener SHALL keep serving it

#### Scenario: Backoff survives restart
- **WHEN** issuance for a name has failed four times and the server restarts
- **THEN** the next attempt SHALL NOT start before the time scheduled before the restart

#### Scenario: Name conflict
- **WHEN** two configured sources produce the same name
- **THEN** only the first source SHALL issue for it and the second SHALL report `name-conflict`

#### Scenario: Backoff schedule
- **WHEN** issuance for a name fails repeatedly
- **THEN** successive attempts SHALL start 5, 10, 20, 40 … minutes apart, never more than 6 hours apart

#### Scenario: Single-flight issuance
- **WHEN** an operator triggers issuance for a name while a scheduled issuance for it is running
- **THEN** only one issuance SHALL run and both callers SHALL observe its outcome

#### Scenario: Source-imposed retry delay
- **WHEN** a source reports a failure with a minimum retry delay of 1 hour
- **THEN** the next scheduled attempt SHALL NOT start earlier than 1 hour later

### Requirement: Private key storage
Certificates and private keys SHALL be stored under the dashboard data directory (`~/.pi/dashboard/tls/`) with private keys readable only by the owning user (mode `0600`) and written atomically. Private key material SHALL NOT appear in any API response or log line. A stored certificate whose private key does not match it, or that does not parse, SHALL be treated as missing and re-obtained. When a source is removed from config, the certificates and keys it produced SHALL be deleted, and the source SHALL be given the opportunity to delete any other files it owns.

#### Scenario: Key file permissions
- **WHEN** a certificate is written
- **THEN** its private key file SHALL have mode `0600`

#### Scenario: Mismatched pair is not served
- **WHEN** the stored certificate and private key for a name do not match after a crash
- **THEN** the pair SHALL NOT be loaded into the listener and a new certificate SHALL be obtained

#### Scenario: Keys never exposed
- **WHEN** `GET /api/config` or `GET /api/health` is called
- **THEN** the response SHALL NOT contain private key material

#### Scenario: Source removal deletes its keys
- **WHEN** the operator removes a source from `tls.sources`
- **THEN** that source's certificate and key files SHALL no longer exist after reconcile

### Requirement: Tailscale certificate source
The server SHALL provide a `tailscale` certificate source that obtains a certificate for the node's own MagicDNS name from the local tailscale daemon, with an issuance timeout of at least 120 seconds, and SHALL renew it before it expires. "Tailnet HTTPS certificates not enabled" SHALL be reported as an unmet `https-certs` gate with setup guidance rather than a hard error. Certificates from this source SHALL be advertisable and map to endpoint kind `magicdns`.

#### Scenario: Certificate issued for the MagicDNS name
- **WHEN** `tls.sources` contains `{ "type": "tailscale" }`, tailscale is running, and the tailnet has HTTPS certificates enabled
- **THEN** the server SHALL obtain a certificate for the node's MagicDNS name and the TLS listener SHALL serve it

#### Scenario: Tailnet HTTPS not enabled
- **WHEN** the tailnet reports HTTPS certificates as not enabled
- **THEN** the source SHALL report the `https-certs` gate as unmet with guidance to enable HTTPS certificates in the tailnet admin console
- **AND** SHALL re-check at most every 15 minutes, and immediately on a `tls` config change or operator-triggered issuance

#### Scenario: Slow issuance not killed early
- **WHEN** the daemon takes 30 seconds to issue the certificate
- **THEN** the issuance SHALL complete successfully

#### Scenario: Tailscale absent
- **WHEN** the tailscale binary is not installed, the daemon is not running, or the node is logged out
- **THEN** the source SHALL report a `tailscale-running` gate as unmet with setup guidance, SHALL NOT attempt issuance, and the main listener SHALL be unaffected

### Requirement: TLS status reporting
TLS status SHALL be exposed under `/api/health.tls`. Every caller SHALL see only whether the listener is enabled and bound. Callers for which access-posture disclosure is permitted (authenticated or genuinely local) SHALL additionally see the port, the effective bind host, the bind error when the listener failed to bind, unmet gates (source-wide or scoped to one name, each with an optional setup hint), per configured source its id, type and any non-secret status fields it declares, and per name the source produces (held, waiting on a gate, or being issued, plus held names kept while the source cannot list its names): name, source id, source type, expiry, advertisable flag, current issuance stage, the last issuance error truncated to 500 characters, the time of the next scheduled attempt when one is scheduled, and any additional non-secret status fields its source declares. Reading status SHALL NOT cause external network calls.

#### Scenario: Retry time disclosed
- **WHEN** issuance for a name failed and the next attempt is scheduled in 20 minutes
- **THEN** that name's status SHALL carry `nextAttemptAt` 20 minutes in the future

#### Scenario: Tailscale address known before the first certificate
- **WHEN** a genuinely local caller reads `/api/health` while the listener is enabled with the tailscale source, tailscale is running, and no certificate has been issued yet
- **THEN** `tls.sources` SHALL list the tailscale source with the node's tailnet IPv4 address

#### Scenario: Detail disclosed to the operator
- **WHEN** a genuinely local caller reads `/api/health` after a tailscale certificate was issued
- **THEN** `tls` SHALL list that name with source `tailscale` and a future expiry

#### Scenario: Detail withheld from undisclosed callers
- **WHEN** an unauthenticated non-local caller reads `/api/health`
- **THEN** `tls` SHALL contain only `enabled` and `bound`

### Requirement: Operator-triggered issuance
The server SHALL expose `POST /api/tls/issue` with body `{ sourceId, name? }`, authorized exactly like `PUT /api/config`. It SHALL re-check the source's gates and start issuance immediately for the given name, or, when `name` is absent, for every name of the source that has no certificate, failed, changed settings or is due for renewal, bypassing backoff — a valid, current certificate SHALL NOT be re-issued by a trigger; when issuance for a name is already running it SHALL join it. It SHALL answer `409` when the listener is disabled; otherwise `404` for an unknown source id, or for a name absent from the source's last name list when the source has produced one; otherwise `202` without waiting for issuance to finish. Unmet gates after the re-check SHALL prevent issuance as for a scheduled attempt. Outcomes SHALL be observable through TLS status.

#### Scenario: Retry now bypasses backoff
- **WHEN** an authorized operator posts `{ "sourceId": "tailscale" }` while the next scheduled attempt is 160 minutes away
- **THEN** the response SHALL be `202` and issuance SHALL start immediately

#### Scenario: Joins a running issuance
- **WHEN** the route is called for a name whose issuance is running
- **THEN** no second issuance SHALL start

#### Scenario: Unauthorized caller refused
- **WHEN** a caller that `PUT /api/config` would refuse posts to the route
- **THEN** it SHALL be refused the same way and no issuance SHALL start

### Requirement: Gateway built-in HTTPS section
The Gateway settings page SHALL show a **Built-in HTTPS** section between the gateway URLs and the "Accessible at" list, as approved in `mockups/tls.html`. It SHALL show an overall status as icon plus word (Checking…, Off, Setup needed, Getting certificate…, On, On with renewal failing, Failed, Stopped) and SHALL NOT render a default as fact before status is read. Its enable switch SHALL write `tls.enabled` immediately, adding the tailscale source when no source is configured, and SHALL revert with an inline error when the write fails. Source groups SHALL be rendered through a per-type registry so a new source type adds its own group without changing the section. While mounted, the section SHALL re-read TLS status every 5 seconds (skipping a tick while a previous read is in flight) and immediately after each of its own writes or issue requests. When enabled it SHALL show: the advertised address with copy and open actions and a note that clients must connect by the certificate name, not an IP address; each unmet gate next to what it blocks with its fix (`bind-reachable` with a one-click "Use <tailnet IPv4>" that changes only `tls.host`; `https-certs` with the admin-console steps and link; `tailscale-running` with a link to the Tailscale setup on the same page); port and listen-address fields committed by an explicit Apply, with server validation errors shown at the field; and a **Certificates** list grouped by source, one row per name with its state, expiry, retry time, last error and a Renew now / Try again now action calling operator-triggered issuance. The "Accessible at" list SHALL label endpoint kinds in words, including **Domain**, using theme tokens only.

#### Scenario: Gates shown with their fixes
- **WHEN** status reports `https-certs` and `bind-reachable` unmet and tailnet IPv4 `100.83.0.1`
- **THEN** the section SHALL show both fixes, a "Use 100.83.0.1" action, and the connect-by-name note

#### Scenario: One-click host keeps sibling settings
- **WHEN** the operator clicks "Use 100.83.0.1" over a stored `tls` block with `port: 9443` and one source
- **THEN** the config write SHALL change only `tls.host`

#### Scenario: Renewal failing while still serving
- **WHEN** a held, unexpired certificate's last renewal failed
- **THEN** the section SHALL show "On, renewal failing" as a warning, the last error, and the next retry time

#### Scenario: Status converges without a reload
- **WHEN** the section shows "Getting certificate…" and issuance finishes
- **THEN** the pill SHALL read "On" within 5 seconds, without user action

#### Scenario: Port rejected by the server
- **WHEN** Apply sends a port the server rejects with 400
- **THEN** the port field SHALL be marked invalid with the reason and the stored config SHALL be unchanged

### Requirement: Reachable bind gate
TLS-listener endpoints SHALL NOT be enumerated or advertised while the listener's effective bind host is a loopback address; TLS status SHALL report a `bind-reachable` gate as unmet with guidance to set `tls.host`.

#### Scenario: Loopback bind suppresses advertisement
- **WHEN** the listener is bound to `127.0.0.1` and holds a valid tailscale certificate
- **THEN** no TLS-listener endpoint SHALL be enumerated
- **AND** the `bind-reachable` gate SHALL be reported unmet
