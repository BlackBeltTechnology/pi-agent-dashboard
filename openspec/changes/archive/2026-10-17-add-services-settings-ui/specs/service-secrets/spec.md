## MODIFIED Requirements

### Requirement: Secret values never leave the delivery channel
No secret value SHALL appear in any `ensure` payload, REST response, CLI output,
log line, error message, process argv, or container `inspect` output. REST and
CLI SHALL report only `configured: boolean` per secret name. Secret write and
import routes SHALL accept only a caller with `operate` authority (an
`observe`- or `control`-tier bearer SHALL be refused) or a locally trusted
caller (honouring strict local-proof mode), as for every mutating
`/api/services` route, and SHALL NOT echo the value. A child
process launched through `service exec` receives secret values by design. Its
own output is outside this requirement. Captured service output is the one further exception. A native or attached
child's output MAY be kept at rest in `services-run/<id>/output.log`, mode
`0600`, inside the run directory that already holds mounted secret files,
holding only the output of the latest start, bounded to about 1 MiB and deleted
with the service. The operate-only
`GET /api/services/:id/logs` route MAY return it only after replacing every
configured secret value of that service, and SHALL return no output when a
configured secret cannot be read, is shorter than 4 characters, or has changed
since the output's instance started. A value the service transforms before
printing (encoded, split, partial) is not detected; this residual risk SHALL be
stated in the threat model in `docs/managed-services.md`. The digest of secret
values kept in a service's start record SHALL be keyed with a random
per-installation key stored `0600`, so it cannot be checked against guessed
values without that key.

#### Scenario: ensure carries no secret
- **WHEN** `ensure` is called for a service with a configured password
- **THEN** the payload SHALL contain no secret value

#### Scenario: Trusted-network unauthenticated secret write rejected
- **WHEN** an unauthenticated caller from a configured trusted network writes a secret
- **THEN** the write SHALL be rejected and the store SHALL be unchanged

#### Scenario: Logs carry no plain secret value
- **WHEN** a service whose secret `token` is `s3cr3t-value` printed that value and an operate caller reads its logs
- **THEN** the response SHALL contain `«secret:token»` and SHALL NOT contain `s3cr3t-value`
