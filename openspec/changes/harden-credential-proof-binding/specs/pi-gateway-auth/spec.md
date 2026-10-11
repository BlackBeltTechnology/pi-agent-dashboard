## ADDED Requirements

### Requirement: The spawned-bridge endpoint tracks the gateway's actual TCP host
The endpoint URL a spawned bridge dials, and the endpoint its enforcement marker
names, SHALL be derived from the host the gateway's TCP listener actually binds,
not from the dashboard's HTTP bind host. When the gateway serves no TCP listener
of its own (unix socket only) the fallback loopback address `127.0.0.1` SHALL be
used. A gateway host of `localhost` SHALL keep the unmarked legacy endpoint,
because it may bind only an IPv6 address.

#### Scenario: HTTP bound to a LAN address, gateway on the loopback fallback
- **WHEN** the dashboard's HTTP bind host is a LAN address and the gateway binds only `127.0.0.1`
- **THEN** a spawned bridge SHALL be given a loopback literal endpoint and a marker naming it

#### Scenario: Gateway TCP host is IPv6 loopback
- **WHEN** the gateway's TCP listener binds `::1`
- **THEN** a spawned bridge SHALL be given and marked for `ws://[::1]:<piPort>`

#### Scenario: Gateway host is the name localhost
- **WHEN** the gateway's TCP host is `localhost`
- **THEN** a spawned bridge SHALL be given the legacy `ws://localhost:<piPort>` endpoint with no marker

### Requirement: The credential verdict is immutable and the proof floor follows readiness
The verdict recorded for a request SHALL be defined so that no later code can
redefine or overwrite it. The listener's proof floor (the moment before which a
proof is refused as `before-start`) SHALL be taken after the HTTP application is
ready and immediately before the bind call, never before readiness.

#### Scenario: Redefining a recorded verdict
- **WHEN** code that holds the stamp key attempts to redefine a recorded verdict
- **THEN** the attempt SHALL fail and the original verdict SHALL stand

#### Scenario: Slow application readiness
- **WHEN** application readiness takes longer than a proof's freshness
- **THEN** the proof floor SHALL be later than the end of readiness

### Requirement: A local dial host is always an IP literal
The host a local caller dials, and therefore the host a proof binds to, SHALL be
an IP literal. A bind host that is a DNS name SHALL resolve to the IPv4 loopback
literal rather than make every local credential call fail.

#### Scenario: DNS-name bind host
- **WHEN** the configured bind host is a DNS name
- **THEN** local callers SHALL dial `127.0.0.1` and mint a valid proof for it
