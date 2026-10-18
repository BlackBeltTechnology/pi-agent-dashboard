## ADDED Requirements

### Requirement: Configured networks extend knock eligibility
The knock admission gate's address rule SHALL admit a peer when it lies in a default private range (as defined by this capability) **or** matches an entry of the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`). The list branch SHALL apply only to a request that carries no proxy-forwarding header at all (as strict as the private-range branch), and SHALL ignore the match-all entries `0.0.0.0/0`, `::/0` and `*.*.*.*`. (An operator who lists ranges that together span the internet still opens knocking to them; the Security page shows every listed range as "may request access".) The list branch does not require the peer to be on-link. This extension SHALL apply in both trust modes and SHALL be read live, so an entry added or revoked takes effect on the next knock without a restart.

A list match SHALL widen only **where a knock may come from**. It SHALL NOT bypass any other knock gate (`pairing.acceptLanRequests`, one live knock per address, the pending cap, the per-address rate limit), SHALL NOT pre-approve, shorten or skip the operator's typed confirm-code approval, and SHALL NOT change the tier a knock is issued with. A relayed-loopback peer (loopback-range socket peer carrying a proxy-forwarding header) SHALL be refused even when the list covers loopback.

#### Scenario: Public-range peer listed by the operator may knock
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `198.51.100.0/24`
- **WHEN** a knock arrives from `198.51.100.7`
- **THEN** the address gate SHALL pass and a pending device SHALL be created awaiting operator approval

#### Scenario: Unlisted public-range peer is refused
- **GIVEN** `pairing.acceptLanRequests` is enabled and no list entry covers `198.51.100.7`
- **WHEN** a knock arrives from `198.51.100.7`
- **THEN** it SHALL be refused with the address-gate error code

#### Scenario: Listed peer still needs the setting
- **GIVEN** `pairing.acceptLanRequests` is disabled and `trustedNetworks` contains `192.168.16.0/24`
- **WHEN** a knock arrives from `192.168.16.20`
- **THEN** it SHALL be refused with the setting-disabled error code

#### Scenario: Listed peer still needs operator approval
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `192.168.16.0/24`
- **WHEN** a knock from `192.168.16.20` is admitted
- **THEN** no bearer SHALL be issued until the operator approves with the typed confirm code

#### Scenario: Loopback entry does not admit a relayed knock
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `127.0.0.0/8`
- **WHEN** a knock arrives from `127.0.0.1` carrying `X-Forwarded-For`
- **THEN** it SHALL be refused

#### Scenario: Forwarded knock from a listed peer is refused
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `198.51.100.0/24`
- **WHEN** a knock arrives from `198.51.100.7` carrying `X-Forwarded-For`
- **THEN** it SHALL be refused with the address-gate error code

#### Scenario: Match-all entry does not open knocking
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `0.0.0.0/0`
- **WHEN** a knock arrives from public address `203.0.113.9`
- **THEN** it SHALL be refused with the address-gate error code
