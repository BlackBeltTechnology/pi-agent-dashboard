## ADDED Requirements

### Requirement: ACME certificate source configuration
The TLS listener SHALL accept certificate sources of type `acme`, each with: a unique `id` (lowercase kebab-case), a list of 1 to 20 domain names, a contact email, an explicit acceptance of the CA's terms of service (`agreeTos: true`), a `directory` of `staging` (default), `production`, or an `https://` RFC 8555 directory URL, and a DNS-01 `solver` of type `cloudflare` or `acme-dns`. An `acme-dns` solver SHALL carry a `server` URL using `https://`, a `subdomain` and a `fulldomain`; a `cloudflare` solver MAY carry a non-secret `zoneId`. A solver object SHALL be rejected when it carries any other field, so that no secret can be stored in config. Domain names SHALL be normalized (lowercased, one trailing dot removed, duplicates within the source removed) and then validated as ASCII hostnames of at most 253 octets whose labels are letters, digits and inner hyphens of at most 63 characters (no scheme, port, path, IP literal, underscore or bare `*`; internationalized names only in `xn--` form); a wildcard SHALL be accepted only as a single left-most `*.` label. These rules SHALL be enforced by the server on every write of an `acme` entry, not only by the UI. A `configured` flag in a submitted solver SHALL be ignored, not rejected.

#### Scenario: Valid source accepted
- **WHEN** the operator saves an `acme` source `{ id: "home", domains: ["dash.example.com"], email, agreeTos: true, solver: { type: "cloudflare" } }`
- **THEN** the config SHALL be persisted and issuance SHALL be scheduled once credentials exist

#### Scenario: Invalid domain rejected
- **WHEN** the operator saves an `acme` source with domain `https://dash.example.com:8443`, `10.0.0.5`, or `a.*.example.com`
- **THEN** the save SHALL be rejected with a validation error naming the offending entry

#### Scenario: Domains normalized
- **WHEN** the operator saves domains `Dash.Example.COM.` and `dash.example.com`
- **THEN** the stored source SHALL contain the single domain `dash.example.com`

#### Scenario: Empty domain list rejected
- **WHEN** an `acme` source is saved with `domains: []`
- **THEN** the save SHALL be rejected

#### Scenario: acme-dns over plain HTTP rejected
- **WHEN** an `acme-dns` solver is saved with `server: "http://auth.example.net"`
- **THEN** the save SHALL be rejected

#### Scenario: Secret field in config rejected
- **WHEN** an `acme` source is saved with `solver: { "type": "cloudflare", "token": "…" }`
- **THEN** the save SHALL be rejected naming the unknown field, and nothing SHALL be stored

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
A certificate from the `production` directory SHALL be advertisable. A certificate from the `staging` directory SHALL NOT be advertisable; an explicit directory URL equal to a known CA staging directory SHALL be classified as `staging` and one equal to a known production directory as `production`. A certificate from any other explicit directory URL SHALL NOT be advertisable unless the source sets `advertise: true` (an operator assertion). Changing `directory`, or changing the effective advertise value that results from this classification, SHALL cause re-issuance on reconcile; a known directory is one of the two Let's Encrypt directory URLs. Non-advertisable certificates SHALL still be served by the TLS listener and SHALL be reported with `staging: true` or `advertise: false` in status.

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
The `acme` source SHALL obtain certificates using only the DNS-01 challenge, failing the attempt when the CA offers no `dns-01` challenge, publishing the TXT record at `_acme-challenge.<domain>` (for a wildcard, at `_acme-challenge.<parent>`). It SHALL wait until the expected TXT value is served by every authoritative nameserver of the zone (falling back, when direct DNS queries are blocked, to requiring both of two public DNS-over-HTTPS resolvers to return it, which SHALL be marked in status), or fail after 180 seconds without asking the CA to validate. A whole issuance attempt SHALL be abandoned after 10 minutes, even if a CA call is still pending; on abandonment the name SHALL become available for a new attempt, the abandoned attempt SHALL start no new CA or DNS-provider call other than challenge cleanup (calls already in flight may finish and their results SHALL be ignored), challenge cleanup SHALL still be attempted (including for a record whose creation completes after abandonment), and a late result of the abandoned attempt SHALL be discarded. An `acme-dns` source SHALL run at most one non-abandoned order at a time, and the 10-minute limit for its queued names SHALL start when their order begins rather than when they were queued. After a Cloudflare-published challenge completes or fails, the TXT record SHALL be removed; acme-dns records are left in place (the service retains only the latest values). The host running the dashboard SHALL NOT need to be reachable from the internet. After a CA-side validation failure the next automatic attempt SHALL NOT start sooner than 1 hour later.

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
- **AND** an "issue now" for the same domain SHALL start a new attempt instead of joining the abandoned one, also on an `acme-dns` source

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
- **WHEN** the operator triggers "issue now" for a domain with no issuance running, through the prerequisite's `POST /api/tls/issue` with `{ sourceId, name }`
- **THEN** issuance SHALL start immediately regardless of backoff, and its outcome SHALL appear in status

### Requirement: ACME account persistence
The source SHALL create one ACME account per (normalized directory, contact email) on first use — a Let's Encrypt directory given as its keyword or as its explicit URL is the same directory — persist its private key under `~/.pi/dashboard/tls/` with mode `0600`, and reuse it for later issuances. An account key no longer used by any configured source SHALL be deleted on reconcile, whether the source was removed or its email or directory changed.

#### Scenario: Account reused
- **WHEN** a second certificate is issued against the same directory with the same email
- **THEN** no new ACME account SHALL be registered

#### Scenario: Unused account key deleted
- **WHEN** the last source using a (directory, email) pair is removed, or changes its email
- **THEN** that account key file SHALL no longer exist after reconcile

### Requirement: Solver credential storage
Solver secrets — the Cloudflare API token, and the acme-dns username and password — SHALL be stored in the dashboard's credential vault as accounts of kind `tls-solver` in the namespace `tls:<sourceId>`, never in `config.json` and never in a separate file. Non-secret solver settings (acme-dns `server`, `subdomain`, `fulldomain`) SHALL live in config. No API response and no log line SHALL contain a secret value; APIs SHALL expose only whether secrets are configured. Secret writes SHALL go through `PUT /api/tls/acme/:sourceId/credentials`, authorized as a credential-vault management route; a `sourceId` that does not name a configured `acme` source SHALL be answered 404 without touching the vault. Saving secrets SHALL trigger an issuance attempt for that source's due names. The `configured` flag SHALL be read-only (ignored on config writes). When no configured `acme` source has a given id any more (removal or rename), its `tls:<id>` accounts SHALL be deleted on a reconcile that read a parseable config and a healthy vault. When the vault cannot be read, the source SHALL report its `credentials` gate unmet and SHALL make no CA or DNS-provider call.

#### Scenario: Secrets redacted
- **WHEN** `GET /api/config` is called by the operator, or `GET /api/health` by a caller permitted to see TLS detail, with an acme source configured
- **THEN** the response SHALL contain `configured: true` for the solver and SHALL NOT contain the token or password

#### Scenario: Health withholds solver state from undisclosed callers
- **WHEN** an unauthenticated non-local caller reads `/api/health`
- **THEN** the response SHALL contain no ACME solver or domain information

#### Scenario: Source removal deletes secrets
- **WHEN** an acme source is removed from config, or its `id` is renamed
- **THEN** the vault SHALL hold no account in the old `tls:<id>` namespace after reconcile, and other namespaces SHALL be unchanged

#### Scenario: Unknown source id refused
- **WHEN** `PUT /api/tls/acme/nope/credentials` is called and no acme source `nope` is configured
- **THEN** the response SHALL be 404 and the vault SHALL be unchanged

#### Scenario: Unreadable vault blocks issuance
- **WHEN** the vault file is corrupt and an issuance for an acme source is due
- **THEN** the source SHALL report its `credentials` gate unmet with a hint naming the credential vault, and no CA or DNS-provider request SHALL be made

#### Scenario: Remote unauthenticated write rejected
- **WHEN** a caller that the credential vault's management routes would refuse tries to write solver secrets
- **THEN** it SHALL be refused the same way and the vault SHALL be unchanged

#### Scenario: Errors redacted
- **WHEN** a DNS API call fails and the error is logged or surfaced in status
- **THEN** the logged or surfaced text SHALL NOT include the secret value

#### Scenario: Saving secrets starts issuance
- **WHEN** secrets are saved for a source whose domains hold no certificate
- **THEN** an issuance attempt SHALL start without waiting for the periodic tick

### Requirement: Solver readiness
Solver readiness checks (credential validity, zone lookup, CNAME delegation) SHALL run on config or secret change, before an issuance attempt, or on explicit operator refresh, and SHALL be cached for at least 5 minutes; reading status SHALL NOT trigger external calls. Explicit refresh is the prerequisite's `POST /api/tls/issue` with `{ sourceId, name? }`, which forces a readiness refresh before triggering. Missing credentials, an unreadable vault and a missing delegation SHALL be reported as unmet gates, so that the prerequisite's gate-before-obtain rule skips the name without counting a failure, and no CA order is created and no DNS record is written for it. The acme-dns credential check SHALL write to the acme-dns server only while no order of that source is running. Status SHALL report, as source-level status fields, the time each domain's readiness was last checked. For the `acme-dns` solver the source SHALL, per domain, check on public DNS that `_acme-challenge.<d>` — where `<d>` is the domain with any leading `*.` removed — is a CNAME to the configured acme-dns `fulldomain`, asking that zone's authoritative nameservers rather than a recursive resolver, and when it is not, SHALL report an unmet gate showing the exact CNAME record to create.

#### Scenario: Wildcard delegation checked at the parent
- **WHEN** the source lists `*.example.com` with the acme-dns solver
- **THEN** readiness SHALL check the CNAME at `_acme-challenge.example.com`

#### Scenario: Status reads do not call out
- **WHEN** status is read 20 times within one minute
- **THEN** no DNS-provider or DoH request SHALL be made because of those reads

#### Scenario: Missing CNAME guidance
- **WHEN** `_acme-challenge.dash.example.com` has no CNAME
- **THEN** status SHALL report the gate unmet with the record `_acme-challenge.dash.example.com CNAME <fulldomain>`
- **AND** the source's status fields SHALL carry the time that check ran

#### Scenario: Check now after fixing the CNAME
- **WHEN** the operator calls `POST /api/tls/issue` with `{ "sourceId": "home", "name": "dash.example.com" }` after creating the missing CNAME, within the 5-minute cache window
- **THEN** the checks SHALL run again, status SHALL report the gate met with a new check time, and issuance for that name SHALL start

#### Scenario: Check now with the CNAME still missing
- **WHEN** the same call is made while the CNAME is still absent
- **THEN** no CA order SHALL be created and no DNS record SHALL be written, and the gate SHALL stay unmet with a new check time

### Requirement: ACME status reporting
For callers permitted to see TLS detail, status SHALL report per ACME domain: source id, solver type, directory (`staging`/`production`/custom), `staging` flag, `advertise` flag, expiry, current stage (`idle`, `order`, `dns-publish`, `propagation`, `validation`, `finalize`), the last redacted error, and — after a failed attempt — the time of the next automatic attempt (the prerequisite's per-certificate `nextAttemptAt`). Domains that do not yet hold a certificate SHALL be reported too.

#### Scenario: Stage visible during issuance
- **WHEN** an issuance is waiting for DNS propagation
- **THEN** status SHALL report stage `propagation` for that domain

#### Scenario: Next attempt visible after a CA failure
- **WHEN** the CA marks the challenge for `dash.example.com` `invalid` at time T and the domain holds no certificate
- **THEN** status SHALL report that domain with its redacted error and a next automatic attempt no earlier than T + 1 hour

### Requirement: Gateway ACME editor
ACME sources SHALL be shown and edited as source groups inside the prerequisite's Gateway "Certificates" list, using its per-certificate row and its issue action. Secret inputs SHALL never be prefilled; each SHALL show only whether a secret is saved, missing, or rejected by the DNS provider. Saving a new or edited source SHALL first write that entry through `PUT /api/tls/acme/:sourceId`, then any entered secrets through `PUT /api/tls/acme/:sourceId/credentials`; removing a source SHALL use `DELETE /api/tls/acme/:sourceId`. A source's `id` SHALL be read-only in the editor after the first save. Save SHALL be disabled, with the reason shown next to it, while `agreeTos` is not accepted.

#### Scenario: Secret never prefilled
- **WHEN** the editor opens for a source whose Cloudflare token is saved
- **THEN** the token input SHALL be empty and the field SHALL state that a token is saved

#### Scenario: Credential write fails after config save
- **WHEN** a new source is saved and `PUT /api/tls/acme/home` succeeds but the credentials write fails
- **THEN** the source SHALL remain saved, the group SHALL show that credentials are missing together with the error, and the entered secret SHALL NOT be written anywhere else

#### Scenario: Terms gate on save
- **WHEN** the operator fills in a new source without accepting the terms of service
- **THEN** Save SHALL be disabled and the reason SHALL be shown next to it

### Requirement: Source editing preserves other sources
Adding, editing, or removing an `acme` source through the dashboard SHALL leave every other configured TLS source unchanged, also when another dashboard tab saved a TLS change in the meantime. The dashboard SHALL write one `acme` entry at a time (`PUT` and `DELETE /api/tls/acme/:sourceId`), serialized with other config saves, and SHALL refuse the write when `config.json` exists but cannot be parsed.

#### Scenario: Editing ACME keeps tailscale
- **WHEN** `tls.sources` holds a tailscale source and an acme source, and the operator adds a domain to the acme source through the Gateway UI
- **THEN** the stored `tls.sources` SHALL still contain the unchanged tailscale source

#### Scenario: Stale tab does not drop a source
- **WHEN** tab A loaded the config, tab B then added acme source `lab`, and tab A saves an edit to acme source `home`
- **THEN** the stored `tls.sources` SHALL contain both `home` (edited) and `lab`

#### Scenario: Corrupt config refuses the write
- **WHEN** `config.json` exists but is not valid JSON and the operator saves an acme source
- **THEN** the write SHALL be refused and `config.json` SHALL be unchanged
