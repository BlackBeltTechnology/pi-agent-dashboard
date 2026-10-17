## ADDED Requirements

### Requirement: Service start record
Every dashboard start of a service, with any driver, SHALL write
`services-run/<id>/start.json` (mode `0600`) holding the start time, a keyed
digest of the secret values delivered to that start, and, for `native` and
`attached`, the device and inode of its output file. The digest SHALL be an
HMAC over the sorted name and value pairs, keyed with a random per-installation
key stored with mode `0600`. Adoption after a server restart SHALL read the
record back. Saving a secret value while a dashboard-started instance runs SHALL
mark the record so that the service reports `restartRequired` until its next
start, including across a server restart.

#### Scenario: Record survives a server restart
- **WHEN** the dashboard started an OCI service and the server restarts
- **THEN** the adopted instance SHALL carry the recorded start time and digest

#### Scenario: Saving a secret asks for a restart
- **WHEN** a new value is saved for secret `token` while the native service runs, and the server then restarts
- **THEN** the service SHALL still report `restartRequired`

### Requirement: Service output capture for dashboard-started processes
A `native` or `attached` instance started by the dashboard SHALL have its stdout
and stderr appended to `services-run/<id>/output.log`, opened in append mode
with file mode `0600`; the file SHALL be truncated in place, keeping its inode,
before each dashboard start, so it only ever holds the output of the latest
start. The server process SHALL NOT relay the output through its own event
loop. The size of the file SHALL be checked at each start, on each logs read,
and every 5 s for every service that has the file, leased or not; this check
reads only the local file's size and is not a health probe. When the file
exceeds 1 MiB the server SHALL truncate it in place to zero length, on the
descriptor, or by path when no descriptor is held or descriptor truncation
fails, and by path only if the path still has the device and inode in the start
record. It SHALL NOT rename, copy or reopen the live file. The bound is
steady-state: a burst may exceed 1 MiB by up to 5 s of output. Checks for one
service SHALL NOT run concurrently. A process the dashboard did not start, and
every `external`-mode service, SHALL get no output file. `remove` SHALL delete
the file with the run directory.

#### Scenario: Native child output is captured
- **WHEN** the dashboard starts a native service whose process prints a line to stderr
- **THEN** that line SHALL appear in `services-run/<id>/output.log`
- **AND** the file mode SHALL be `0600`

#### Scenario: A new start clears the previous output
- **WHEN** a native service that wrote output is started again
- **THEN** `output.log` SHALL hold only output of the new start and keep its inode

#### Scenario: Output is capped while an unleased child runs
- **WHEN** an idle native service with no lease has written 1.5 MiB to `output.log`
- **THEN** within 5 s `output.log` SHALL be truncated in place
- **AND** a line the child prints afterwards SHALL appear in `output.log`

#### Scenario: Cap still applies after a server restart
- **WHEN** the server restarts while a dashboard-started native child keeps writing, and the file passes 1 MiB
- **THEN** the file SHALL be truncated by path after its device and inode are confirmed against the start record

### Requirement: Logs route with operate authority and secret redaction
`GET /api/services/:id/logs?tail=N` SHALL return the last N lines as
`{ available: true, driver, stale, lines: string[] }` or
`{ available: false, reason, secret? }`. `tail` SHALL be an integer from 1 to
2000, default 200; any other value SHALL be refused with 400 `invalid-tail`.
`stale` SHALL be true when the service has no running instance.

Sources. OCI output SHALL be read from the current container only, with the
runtime's `logs --timestamps --since <recorded start> --tail M` through the
command runner, where M is N plus the line count of the longest secret value
minus one, merging stdout and stderr in timestamp order with stdout first on
equal timestamps. If the command times out, fails, or its output is cut by the
runner's cap, the route SHALL return `runtime-error` and no lines. Native and
attached output SHALL be read from `output.log` with the same M, whether or not
an instance is running.

Reasons. `external` for an `external`-mode service, or an instance the dashboard
did not start and that has no output file; `duplicate-instances` when more than
one container matches; `no-output` when no output or no start record exists;
`secrets-changed` when the keyed digest of the current secret values differs
from the one in the start record; `runtime-error` as above.

Authority. The route SHALL require `operate` authority like mutating routes and
SHALL carry route tier `operate`.

Redaction. Each declared secret SHALL be resolved separately. A secret whose
value is not set SHALL be skipped. If a set secret cannot be read the route SHALL
return `secret-unavailable`, and if a value is shorter than 4 characters it
SHALL return `secret-too-short`; both SHALL name, in `secret`, the first such
secret in declaration order, and return no lines. Otherwise the server SHALL
replace every occurrence of every value with `«secret:<name>»` in one pass over
the raw output, preferring the longest value at each position, before splitting
it into lines; then keep the last N lines and drop whole lines from the start
until the result is at most 512 KiB.

#### Scenario: Secret value is redacted
- **WHEN** a native service with secret `token` = `s3cr3t-value` printed `auth s3cr3t-value ok`
- **THEN** the logs route SHALL return the line `auth «secret:token» ok`

#### Scenario: Overlapping values are fully redacted
- **WHEN** secret `a` is `pass1234` and secret `b` is `pass1234xyz`, and the service printed `pass1234xyz`
- **THEN** the line SHALL read `«secret:b»`

#### Scenario: Multi-line secret at the window edge is redacted
- **WHEN** a two-line secret value was printed so that only its second line falls inside the last N lines
- **THEN** no line of the response SHALL contain either part of the value

#### Scenario: Old value is not returned after rotation and restart
- **WHEN** a native service printed secret `token` = `old-value-1`, a new value was saved, and the service was restarted
- **THEN** no line of the response SHALL contain `old-value-1`

#### Scenario: Observe-tier bearer cannot read logs
- **WHEN** a caller with an `observe`-tier bearer requests `/api/services/docling/logs`
- **THEN** the request SHALL be refused with 403 `insufficient_scope` and no output

#### Scenario: Unreadable secret withholds logs and names it
- **WHEN** a service's set `keychain:` secret `apikey` cannot be read
- **THEN** the logs route SHALL return `available: false`, `reason: "secret-unavailable"`, `secret: "apikey"` and no lines

#### Scenario: Unset secret does not withhold logs
- **WHEN** a service declares store secret `token` that has never been set
- **THEN** the logs route SHALL return the output

#### Scenario: Output produced with old secret values is withheld
- **WHEN** the `env:` value of a native service's secret changed after the service started
- **THEN** the logs route SHALL return `available: false` with `reason: "secrets-changed"` until the service is restarted

#### Scenario: Output of a failed start is readable
- **WHEN** a native service is `failed` and its last start wrote to `output.log`
- **THEN** the logs route SHALL return those lines with `stale: true`

#### Scenario: Container stderr is included
- **WHEN** an OCI service wrote one line to stdout and then one to stderr
- **THEN** the response SHALL contain both lines in that order

#### Scenario: Runtime failure returns no partial output
- **WHEN** the runtime's logs command times out or its output reaches the runner cap
- **THEN** the logs route SHALL return `available: false` with `reason: "runtime-error"` and no lines

#### Scenario: Invalid tail is refused
- **WHEN** the client requests `tail=100000`
- **THEN** the response SHALL be 400 `invalid-tail`

### Requirement: Reset service data
`POST /api/services/:id/reset-data` SHALL require `operate` authority. It SHALL
be refused with 409 `not-resettable` unless the service is `stopped`, or
`unavailable` with a reason other than `adoption-uncertain`,
`duplicate-instances` or `owner-conflict`, and no owned container of the
service is running; with 409 `no-data` when the definition declares no named
volumes; and with 409 `runtime-unreachable`, removing nothing, when the
service's containers cannot be listed or inspected. Otherwise, holding the
service's lifecycle lock, it SHALL remove without forcing the containers
labelled `pi.service=<id>` and `pi.owner=<instanceId>`, refusing with 409
`not-resettable` and removing no volume if that fails, and then remove the
declared volumes under the shared volume guard. It SHALL return
`{ volumes: [{ name, removed, reason? }] }` and SHALL NOT change
`services.json`, secrets, or the run directory. The server SHALL log
`[services] <id> data reset (<n> volumes)`.

The shared volume guard, used by reset-data and by removal with purging, SHALL
keep a volume, with reason `volume-shared`, when another defined service
declares the same name, and with reason `volume-in-use` when a container not
labelled `pi.service=<id>` and `pi.owner=<instanceId>` uses it, and SHALL never
force a volume removal, so a volume that came into use meanwhile is kept with
reason `volume-in-use`.

#### Scenario: Reset refused while running
- **WHEN** reset-data is requested for a `healthy` service
- **THEN** the response SHALL be 409 `not-resettable` and no volume SHALL be removed

#### Scenario: Volume used elsewhere is kept
- **WHEN** a container of another project mounts the volume `shared-db`, and a stopped user-origin service declaring `shared-db` requests reset-data
- **THEN** `shared-db` SHALL still exist and the response SHALL report it kept with reason `volume-in-use`

#### Scenario: Reset keeps the definition
- **WHEN** reset-data succeeds for a stopped OCI service with volume `docling-cache`
- **THEN** `docling-cache` SHALL no longer exist
- **AND** the service SHALL still be listed with its secrets still `configured`

### Requirement: Prune dashboard-owned leftovers
`POST /api/services/prune` SHALL require `operate` authority. Its candidates
SHALL be exactly: containers labelled `pi.owner=<instanceId>` whose
`pi.service` id is not defined, and `services-run/<name>/` directories whose
name matches the service id pattern, whose name is not defined, and whose
recorded process is not alive. A process SHALL count as alive when it or its
process group exists, including when signalling it is refused for lack of
permission. Running containers SHALL be reported as skipped, not removed. Prune
SHALL NOT remove volumes, containers with another `pi.owner`, any other
directory under `services-run/`, or anything belonging to a defined service.
`{ dryRun: true }` SHALL return the candidates plus the runtimes that could not
be queried, and change nothing. `{ dryRun: false, ids }` SHALL consider only the
candidates in `ids`; it SHALL remove each one only if, re-checked while holding
that id's lifecycle lock after re-reading `services.json`, it is still a
candidate, and SHALL return `removed` and `skipped`. Prune SHALL be refused with
409 while `services.json` is corrupt, and with 409 `definitions-missing` while
it does not exist.

#### Scenario: Dry run changes nothing
- **WHEN** prune is called with `dryRun: true` and one orphan container exists
- **THEN** the response SHALL list that container and it SHALL still exist

#### Scenario: Shared runtime config is never a candidate
- **WHEN** prune runs and `services-run/.docker-config/` exists
- **THEN** it SHALL NOT be listed or removed

#### Scenario: Re-added id is skipped
- **WHEN** the run directory `tika` was previewed, then `tika` is added before the confirm
- **THEN** the confirm SHALL report `tika` as skipped and its directory SHALL still exist

#### Scenario: Live process group protects its run directory
- **WHEN** an undefined id's recorded pid has exited but a child in its process group still runs
- **THEN** prune SHALL NOT list that run directory

#### Scenario: Missing definitions file blocks prune
- **WHEN** `services.json` does not exist and a container labelled with this instance's `pi.owner` exists
- **THEN** prune SHALL be refused with 409 `definitions-missing` and the container SHALL still exist

#### Scenario: Foreign owner is never pruned
- **WHEN** a container labelled `pi.service=x` carries a different `pi.owner`
- **THEN** prune SHALL NOT list or remove it

### Requirement: Lease holders and caller authority in service status
`GET /api/services/:id` and each entry of `GET /api/services` SHALL include
`leaseHolders: [{ holder?, expiresAt }]` for live leases, `expiresAt` as an
ISO 8601 string. A lease id SHALL NOT be included. `GET /api/services` SHALL
include `canOperate: boolean`, true exactly when the request would pass both the
route-tier gate at tier `operate` and the `operate` check of mutating routes.

#### Scenario: Holder visible, lease id hidden
- **WHEN** `ensure` was called with `holder: "session-abc"`
- **THEN** the status SHALL list a holder `session-abc` with its `expiresAt`
- **AND** the response SHALL NOT contain the lease id

#### Scenario: Control-tier login session cannot operate
- **WHEN** a login session of tier `control` lists services
- **THEN** the response SHALL carry `canOperate: false`

#### Scenario: Observe caller learns it cannot operate
- **WHEN** a caller with an `observe`-tier bearer lists services
- **THEN** the response SHALL carry `canOperate: false`

### Requirement: Payload-free service change notification
The server SHALL broadcast a `services_changed` browser message with no fields
other than `type` after any service state change, pin or unpin, live lease count
change (including expiry found by the lease sweep), add, update, remove, every
saved secret value, reset-data or prune. State changes SHALL be reported from
the state cell itself, for both transitions and initialisation, and lease
changes from the lease table, so background changes (idle, idle-stop,
re-probe, adoption, lease expiry) notify like explicit actions. The browser
gateway SHALL treat the message as a coalescing state frame, exempt from
transcript shedding. Notifications SHALL be coalesced so that at most one is
sent per 500 ms while still delivering a trailing notification after the last
change.

#### Scenario: Frame carries no service data
- **WHEN** a service goes from `starting` to `healthy`
- **THEN** browsers SHALL receive `{ "type": "services_changed" }` and nothing else about the service

#### Scenario: Adoption notifies
- **WHEN** the server adopts a running container after a restart
- **THEN** browsers SHALL receive a `services_changed` message

#### Scenario: Burst is coalesced
- **WHEN** ten state changes occur within 100 ms
- **THEN** browsers SHALL receive at most two `services_changed` frames for that burst

### Requirement: Container stop is owner-scoped
When an OCI service is stopped without a recorded instance, the server SHALL
stop only containers labelled both `pi.service=<id>` and
`pi.owner=<instanceId>`.

#### Scenario: Foreign container survives a stop
- **WHEN** a container labelled `pi.service=docling` with a different `pi.owner` runs, and `docling` is stopped
- **THEN** that container SHALL still be running

## MODIFIED Requirements

### Requirement: CLI and REST consumer contract
The CLI SHALL provide
`pi-dashboard service ensure|heartbeat|release|exec|list|status|start|stop|retry|pin|unpin|add|remove|prefetch|secret`.
Every verb with `--json` SHALL exit 0 with its outcome in the payload, and
without `--json` SHALL exit non-zero on failure. `remove --all` SHALL apply
`remove` to every defined service.
- `ensure --json` SHALL always exit 0 and print
  `{ id, state, reason?, retryAt?, endpoints?, leaseId?, driver?, exposure?, updateAvailable?, hint? }`.
- When the server is unreachable, the CLI SHALL emit `state: "no-server"`.
- An offered but not-added id SHALL yield `not-added` with a hint naming the add
  command.
- Without `--json`, `ensure` SHALL exit non-zero unless the state is `healthy`.
- `exec <id> -- <argv…>` SHALL hold a lease for the child's lifetime,
  heartbeating every 30 s, and SHALL forward the child's exit code.
- REST read routes under `/api/services` SHALL be protected by the existing
  network guard. `GET /api/services/:id/logs` returns process output and SHALL
  instead require the same authority as mutating routes. Every mutating route SHALL additionally require an
  authenticated caller with `operate` authority (a bearer of tier `observe` or
  `control` SHALL be refused) or a locally trusted caller, honouring the strict
  local-proof mode. Every route SHALL carry a route-tier entry and SHALL be
  bound in or denylisted from the MCP tool manifest.
- User-origin OCI entries SHALL NOT declare privileged mode, host networking or
  non-loopback ports.

#### Scenario: Dashboard down
- **WHEN** `pi-dashboard service ensure docling --json` runs and no server is reachable
- **THEN** it SHALL print a payload with `state: "no-server"` and exit 0

#### Scenario: Observe-tier bearer cannot create an attached service
- **WHEN** a caller authenticated with an `observe`-tier bearer POSTs a user-origin `attached` definition
- **THEN** the request SHALL be rejected and `services.json` SHALL be unchanged

#### Scenario: Trusted-network caller cannot create an attached service
- **WHEN** an unauthenticated caller from a configured trusted network POSTs a user-origin `attached` definition
- **THEN** the request SHALL be rejected and `services.json` SHALL be unchanged

#### Scenario: Logs need operate although they are a read
- **WHEN** an unauthenticated caller from a configured trusted network requests `/api/services/docling/logs`
- **THEN** the request SHALL be refused and no output SHALL be returned


### Requirement: Adding, updating and removing services are explicit actions
`POST /api/services` with `dryRun: true` SHALL return a review: the image digest
or runner recipe, ports, volumes, secret names and `templateHash`. The same call
with `dryRun: false` SHALL write the entry. `pi-dashboard service add <id>`
SHALL show that review and require confirmation unless `--yes` is given. When an
offer's `templateHash` differs from the entry's `origin.templateHash`, the
service SHALL report `updateAvailable` with a diff `[{ path, from, to }]`, and
SHALL apply it only on an explicit update request (`update: true` /
`service add --update <id>`). `DELETE /api/services/:id`
(`service remove <id>`) SHALL stop the service if it is owned, remove its
container or instance files, its `services-run/<id>/` directory and its stored
secrets. Named volumes SHALL be retained unless purging is explicitly requested
(`--purge-data` / `purgeData: true`). A purge SHALL remove volumes only through
the shared volume guard of "Reset service data", and the removal result SHALL
list each declared volume as removed or kept with its reason. The confirmation skipped by `--yes` SHALL
NOT cover any package prefetch.

#### Scenario: Plugin upgrade does not rewrite the entry
- **WHEN** a package upgrade changes the `docling` offer's image digest
- **THEN** the `docling` entry in `services.json` SHALL be unchanged
- **AND** `GET /api/services` SHALL report `updateAvailable: true` with the digest diff

#### Scenario: Dry-run writes nothing
- **WHEN** `POST /api/services` is called with `dryRun: true`
- **THEN** `services.json` SHALL be unchanged

#### Scenario: Purge keeps a volume used elsewhere
- **WHEN** a service declaring volume `shared-db` is removed with `purgeData: true` while another project's container mounts `shared-db`
- **THEN** the service SHALL be removed and `shared-db` SHALL still exist and be reported as kept with reason `volume-in-use`

