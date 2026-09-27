## ADDED Requirements

### Requirement: ACME certificate source configuration
The TLS listener SHALL accept certificate sources of type `acme`, each with: a unique `id` (lowercase kebab-case), a non-empty list of domain names, a contact email, an explicit acceptance of the CA's terms of service (`agreeTos: true`), a `directory` of `staging` (default), `production`, or an `https://` RFC 8555 directory URL, and a DNS-01 `solver` of type `cloudflare` or `acme-dns`. Domain names SHALL be validated as DNS hostnames (no scheme, port, path, or IP literal); a wildcard SHALL be accepted only as a single left-most `*.` label.

#### Scenario: Valid source accepted
- **WHEN** the operator saves an `acme` source `{ id: "home", domains: ["dash.example.com"], email, agreeTos: true, solver: { type: "cloudflare" } }`
- **THEN** the config SHALL be persisted and issuance SHALL be scheduled once credentials exist

#### Scenario: Invalid domain rejected
- **WHEN** the operator saves an `acme` source with domain `https://dash.example.com:8443`, `10.0.0.5`, or `a.*.example.com`
- **THEN** the save SHALL be rejected with a validation error naming the offending entry

#### Scenario: Terms not accepted
- **WHEN** an `acme` source is saved without `agreeTos: true`
- **THEN** the save SHALL be rejected

#### Scenario: Duplicate source id rejected
- **WHEN** two `acme` sources share the same `id`
- **THEN** the save SHALL be rejected

#### Scenario: Non-https directory URL rejected
- **WHEN** `directory` is `http://ca.internal/dir`
- **THEN** the save SHALL be rejected

### Requirement: Advertisement trust classification
A certificate from the `production` directory SHALL be advertisable. A certificate from the `staging` directory SHALL NOT be advertisable; an explicit directory URL equal to a known CA staging directory SHALL be classified as `staging` and one equal to a known production directory as `production`. A certificate from any other explicit directory URL SHALL NOT be advertisable unless the source sets `advertise: true` (an operator assertion). Changing `directory` or `advertise` SHALL cause re-issuance on reconcile. Non-advertisable certificates SHALL still be served by the TLS listener and SHALL be reported with `staging: true` or `advertise: false` in status.

#### Scenario: Staging by default, not advertised
- **WHEN** an `acme` source is saved without a `directory` and issuance succeeds
- **THEN** the certificate SHALL come from the CA's staging directory
- **AND** it SHALL NOT appear in `GET /api/tunnel/endpoints` or the pairing payload

#### Scenario: Switch to production re-issues
- **WHEN** a source holding a fresh staging certificate is switched to `directory: "production"`
- **THEN** a production certificate SHALL be issued on reconcile and then advertised

#### Scenario: Custom directory not advertised by default
- **WHEN** issuance succeeds against `https://pebble.test:14000/dir` without `advertise: true`
- **THEN** the certificate SHALL NOT be advertised

#### Scenario: Production advertised
- **WHEN** issuance succeeds against the production directory for `dash.example.com` on a TLS listener bound to a non-loopback host at port `8443`
- **THEN** `GET /api/tunnel/endpoints` SHALL include `https://dash.example.com:8443` tagged `domain` with `tls: true`

### Requirement: DNS-01 issuance and renewal
The `acme` source SHALL obtain certificates using only the DNS-01 challenge, publishing the TXT record at `_acme-challenge.<domain>` (for a wildcard, at `_acme-challenge.<parent>`). It SHALL wait until the expected TXT value is served by every authoritative nameserver of the zone (falling back to two public DNS-over-HTTPS resolvers when direct DNS queries are blocked), or fail after 180 seconds without asking the CA to validate. A whole issuance attempt SHALL be abandoned after 10 minutes, even if a CA call is still pending; on abandonment the name SHALL become available for a new attempt, challenge cleanup SHALL still be attempted, and a late result of the abandoned attempt SHALL be discarded. An `acme-dns` source SHALL run at most one order at a time. After a Cloudflare-published challenge completes or fails, the TXT record SHALL be removed; acme-dns records are left in place (the service retains only the latest values). The host running the dashboard SHALL NOT need to be reachable from the internet. After a CA-side validation failure the next automatic attempt SHALL NOT start sooner than 1 hour later.

#### Scenario: Issuance for a private-IP domain
- **WHEN** `dash.example.com` resolves to a private mesh address and the solver can write its DNS
- **THEN** a certificate for `dash.example.com` SHALL be issued and served by the TLS listener

#### Scenario: Cloudflare challenge record cleaned up
- **WHEN** a Cloudflare-published attempt completes or fails after the TXT record was created
- **THEN** that TXT record SHALL no longer exist

#### Scenario: Propagation timeout
- **WHEN** the TXT value is not served by every authoritative nameserver within 180 seconds
- **THEN** the attempt SHALL fail with a propagation error and the CA SHALL NOT be asked to validate

#### Scenario: Hung CA
- **WHEN** the CA does not settle an order within 10 minutes
- **THEN** the attempt SHALL be abandoned and reported as failed
- **AND** an "issue now" for the same domain SHALL start a new attempt instead of joining the abandoned one

#### Scenario: Editing one domain does not re-issue others
- **WHEN** a domain is added to a production source whose other domains hold fresh certificates
- **THEN** only the added domain SHALL be issued

#### Scenario: CA validation failure floor
- **WHEN** the CA reports the challenge invalid
- **THEN** the next automatic attempt SHALL NOT start within 1 hour

#### Scenario: Renewal
- **WHEN** a held ACME certificate has less than one third of its validity remaining
- **THEN** a replacement SHALL be issued and served without restart

#### Scenario: Issue now
- **WHEN** the operator triggers "issue now" for a domain with no issuance running
- **THEN** issuance SHALL start immediately regardless of backoff, and its outcome SHALL appear in status

### Requirement: ACME account persistence
The source SHALL create one ACME account per (directory, contact email) on first use, persist its private key under `~/.pi/dashboard/tls/` with mode `0600`, and reuse it for later issuances. An account key no longer used by any configured source SHALL be deleted on reconcile.

#### Scenario: Account reused
- **WHEN** a second certificate is issued against the same directory with the same email
- **THEN** no new ACME account SHALL be registered

#### Scenario: Unused account key deleted
- **WHEN** the last source using a (directory, email) pair is removed
- **THEN** that account key file SHALL no longer exist after reconcile

### Requirement: Solver credential storage
Solver secrets — the Cloudflare API token, and the acme-dns username and password — SHALL be stored in a file under `~/.pi/dashboard/tls/` with mode `0600`, keyed by source `id`, separate from `config.json`. Non-secret solver settings (acme-dns server URL and subdomain) SHALL live in config. No API response and no log line SHALL contain a secret value; APIs SHALL expose only whether secrets are configured. Secret writes SHALL be accepted only from callers that are authenticated or genuinely local. Saving secrets SHALL trigger an issuance attempt for that source's due names. The `configured` flag SHALL be read-only (ignored on config writes). Removing a source SHALL delete its stored secrets.

#### Scenario: Secrets redacted
- **WHEN** `GET /api/config` is called by the operator, or `GET /api/health` by a caller permitted to see TLS detail, with an acme source configured
- **THEN** the response SHALL contain `configured: true` for the solver and SHALL NOT contain the token or password

#### Scenario: Health withholds solver state from undisclosed callers
- **WHEN** an unauthenticated non-local caller reads `/api/health`
- **THEN** the response SHALL contain no ACME solver or domain information

#### Scenario: Source removal deletes secrets
- **WHEN** an acme source is removed from config
- **THEN** its entry SHALL no longer exist in the secrets file after reconcile

#### Scenario: Remote unauthenticated write rejected
- **WHEN** a non-local, unauthenticated request tries to write solver secrets
- **THEN** it SHALL be rejected and no file SHALL change

#### Scenario: Errors redacted
- **WHEN** a DNS API call fails and the error is logged or surfaced in status
- **THEN** the logged or surfaced text SHALL NOT include the secret value

#### Scenario: Saving secrets starts issuance
- **WHEN** secrets are saved for a source whose domains hold no certificate
- **THEN** an issuance attempt SHALL start without waiting for the periodic tick

### Requirement: Solver readiness
Solver readiness checks (credential validity, zone lookup, CNAME delegation) SHALL run on config or secret change, before an issuance attempt, or on explicit operator refresh, and SHALL be cached for at least 5 minutes; reading status SHALL NOT trigger external calls. For the `acme-dns` solver the source SHALL, per domain, check on public DNS that `_acme-challenge.<d>` — where `<d>` is the domain with any leading `*.` removed — is a CNAME to the configured acme-dns full domain, and when it is not, SHALL report an unmet gate showing the exact CNAME record to create.

#### Scenario: Wildcard delegation checked at the parent
- **WHEN** the source lists `*.example.com` with the acme-dns solver
- **THEN** readiness SHALL check the CNAME at `_acme-challenge.example.com`

#### Scenario: Status reads do not call out
- **WHEN** status is read 20 times within one minute
- **THEN** no DNS-provider or DoH request SHALL be made because of those reads

#### Scenario: Missing CNAME guidance
- **WHEN** `_acme-challenge.dash.example.com` has no CNAME
- **THEN** status SHALL report the gate unmet with the record `_acme-challenge.dash.example.com CNAME <fulldomain>`

### Requirement: ACME status reporting
For callers permitted to see TLS detail, status SHALL report per ACME domain: source id, solver type, directory (`staging`/`production`/custom), `staging` flag, `advertise` flag, expiry, current stage (`idle`, `dns-publish`, `propagation`, `validation`, `finalize`), and the last redacted error.

#### Scenario: Stage visible during issuance
- **WHEN** an issuance is waiting for DNS propagation
- **THEN** status SHALL report stage `propagation` for that domain

### Requirement: Source editing preserves other sources
Adding, editing, or removing an `acme` source through the dashboard SHALL leave every other configured TLS source unchanged.

#### Scenario: Editing ACME keeps tailscale
- **WHEN** `tls.sources` holds a tailscale source and an acme source, and the operator adds a domain to the acme source through the Gateway UI
- **THEN** the stored `tls.sources` SHALL still contain the unchanged tailscale source
