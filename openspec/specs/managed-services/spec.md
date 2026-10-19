# managed-services Specification

## Purpose
Run, adopt, probe and stop the long-lived services skills and plugins depend on (container, native-runner, user-attached and external), behind one consumer contract (`ensure` / `heartbeat` / `release` / `exec`), from a user-owned `services.json` and inert `pi.services` package offers, without implicit execution, silent downloads, or host-VM control.

## Requirements

### Requirement: Service definitions file is user-owned and separate
The server SHALL read service definitions from `~/.pi/dashboard/services.json`,
separate from `config.json`. The file SHALL carry `schemaVersion: 1`, a stable
per-install `instanceId`, and a `services` array. Every write SHALL go through
the shared lock + atomic-write module with mode `0600`. Each entry SHALL carry
`origin`, which is either `"user"` or `{ package, version, templateHash }`. A
missing file SHALL mean zero services, and SHALL cause no runtime probing or
command execution at server start. A corrupt file SHALL be preserved byte-exact,
every write SHALL be refused while it is corrupt, and every service SHALL
report `unavailable` with reason `invalid-definition`.

#### Scenario: No file, no services, no probing
- **WHEN** `~/.pi/dashboard/services.json` does not exist and the server starts
- **THEN** `GET /api/services` SHALL return an empty list
- **AND** no container-runtime, hypervisor or runner command SHALL have been executed

#### Scenario: Write is atomic and owner-only
- **WHEN** a service is added
- **THEN** `services.json` SHALL be replaced atomically
- **AND** its mode SHALL be `0600`

### Requirement: Packages offer service templates via `pi.services`
The server SHALL discover `pi.services` arrays in installed package manifests
using the same package walk as `pi.tools` discovery. Packages that declare
`pi.services` without `pi.tools` SHALL be included, and the existing `pi.tools`
discovery result SHALL be unchanged. Each entry SHALL be validated strictly:
unknown keys are rejected and named, and `schemaVersion` SHALL be present. An
offer SHALL NOT contain lifecycle commands, bind mounts, privileged mode, host
networking, or non-loopback port bindings. An OCI image SHALL be digest-pinned
(`@sha256:`). A native recipe SHALL name an allowlisted runner and an exact
package version. A discovered offer SHALL NOT start, pull, fetch or execute
anything.

#### Scenario: Services-only package is discovered
- **WHEN** a package declares `pi.services` and no `pi.tools`
- **THEN** `GET /api/services/offers` SHALL list its offers
- **AND** `pi.tools` ingestion SHALL produce the same records as before

#### Scenario: Offer is listed but inert
- **WHEN** a package declares a valid `pi.services` entry `docling`
- **THEN** no container or process SHALL be created and no package SHALL be fetched

#### Scenario: Offer with a shell command is rejected
- **WHEN** a `pi.services` entry contains a `lifecycle` key
- **THEN** discovery SHALL reject that entry and name the package and the key

#### Scenario: Unpinned image is rejected
- **WHEN** an offer's OCI image is `ghcr.io/x/y:latest` without a digest
- **THEN** discovery SHALL reject the entry

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

### Requirement: Three ownership modes behind one consumer contract
A definition SHALL declare `mode`, one of `managed`, `attached` or `external`.
`managed` entries SHALL declare `drivers` in preference order, drawn from
`oci:docker`, `oci:podman` and `native`. Every mode SHALL be consumed through the
same `ensure` / `heartbeat` / `release` / `exec` operations and the same `ensure`
payload.

#### Scenario: Same payload shape across modes
- **WHEN** `ensure` is called for a managed OCI service and for an external service
- **THEN** both responses SHALL contain `id` and `state`, and, when healthy, `endpoints`

### Requirement: Lifecycle state machine with explicit failure states
Each service SHALL be in exactly one of `stopped`, `starting`, `healthy`,
`idle`, `stopping`, `stop-failed`, `blocked`, `failed` or `unavailable`.
- `unavailable` SHALL carry a `reason` from the closed set `runtime-missing`,
  `runtime-unreachable`, `host-vm-stopped`, `image-absent`, `runner-absent`,
  `package-absent`, `secret-unavailable`, `unsupported-platform`,
  `invalid-definition`, `adoption-uncertain`, `owner-conflict` and
  `duplicate-instances`. When every driver fails, `reason` SHALL be the
  first-preference driver's reason, and `tried` SHALL list each driver's reason.
- Lifecycle operations on one service SHALL be serialized, so concurrent
  `ensure` calls produce at most one start.
- Every transition SHALL be logged with the id, the from and to states, and a
  reason, without secret values.
- `blocked` SHALL mean the instance is alive but its probe has failed beyond
  `startTimeout`. The manager SHALL NOT kill, relaunch or idle-stop a `blocked`
  service, and SHALL move it to `healthy` when the probe recovers, resetting the
  idle clock.
- A transition into `healthy` (including from `idle`) SHALL require a passing
  probe at that moment. An alive instance whose probe fails SHALL become
  `blocked`.
- A stop SHALL be confirmed only by observing exit within `stopTimeout`;
  otherwise the state SHALL become `stop-failed`, regardless of the stop
  command's exit code.
- After a failed start, the service SHALL NOT be started again before its
  `retryAt` by any start path. Backoff SHALL be exponential from 5 s, capped
  at 5 min, and reset on `healthy`. Only `service retry <id>` or a definition
  change SHALL clear `retryAt`.
- `startTimeout` SHALL default to 120 s and `stopTimeout` to 15 s, both
  overridable per definition.
- When a live instance was created from a different definition than the current
  one, `ensure` SHALL keep serving it and report `restartRequired: true`.

#### Scenario: Concurrent ensure starts once
- **WHEN** two `ensure` calls for a stopped service arrive concurrently
- **THEN** exactly one start SHALL be issued and both calls SHALL receive the same instance's endpoints

#### Scenario: Alive but unhealthy becomes blocked, then recovers
- **WHEN** an attached service's process is running but its probe has failed past `startTimeout`
- **THEN** its state SHALL be `blocked`
- **AND** no stop or start command SHALL be issued automatically, even when its leases reach zero and `idleStopMinutes` elapses
- **AND** when the probe later succeeds, its state SHALL become `healthy` with the same process

#### Scenario: Stop command reports failure but the process exits
- **WHEN** a stop command exits non-zero and the process exits within `stopTimeout`
- **THEN** the state SHALL become `stopped`

#### Scenario: Stop command reports success but the process stays
- **WHEN** a stop command exits 0 and the process is still alive after `stopTimeout`
- **THEN** the state SHALL become `stop-failed`

#### Scenario: Failing service is not respawned in a loop
- **WHEN** a service's start fails and `ensure` is called again before `retryAt`
- **THEN** `ensure` SHALL return `state: "failed"` with `retryAt`
- **AND** no start SHALL be issued

### Requirement: Leases, idle-stop and pin
`ensure` SHALL create a lease, with a TTL of 300 s by default, only when it
returns `healthy`. `heartbeat` SHALL
extend it, `release` SHALL end it, and an expired lease SHALL be removed.
`heartbeat` or `release` on an unknown lease SHALL return `lease-unknown`. On
`lease-unknown`, the CLI `heartbeat` and `exec` SHALL call `ensure` again and
continue with the new lease. A service with zero live leases SHALL be idle. An
idle service SHALL be stopped after `idleStopMinutes` (default 15) only if it
is not pinned, is not `blocked`, its current instance has
`startedBy: "dashboard"`, and the service has a stop path. An `attached` entry
without `lifecycle.stop` SHALL require `idleStopMinutes: null`. Pinning, unpinning, or changing a definition SHALL
reset the idle clock. `idleStopMinutes: null` SHALL disable idle-stop and SHALL
be the default for `attached` services.

#### Scenario: Crashed holder does not keep a service alive
- **WHEN** the only lease holder is killed without releasing
- **THEN** the lease SHALL expire at its TTL after the last heartbeat
- **AND** the service SHALL be stopped `idleStopMinutes` after that

#### Scenario: Externally started instance is never idle-stopped
- **WHEN** an attached service is already running when the dashboard first ensures it
- **THEN** its instance SHALL be recorded as `startedBy: "external"`
- **AND** no stop command SHALL be issued when its leases reach zero

#### Scenario: Unpin does not stop immediately
- **WHEN** a pinned service with zero leases has been idle longer than `idleStopMinutes` and is then unpinned
- **THEN** it SHALL NOT be stopped until `idleStopMinutes` have elapsed after the unpin

#### Scenario: exec survives a server restart
- **WHEN** the server restarts while `pi-dashboard service exec docling -- <cmd>` is running
- **THEN** the exec's next heartbeat SHALL receive `lease-unknown`, re-ensure, and hold a new lease
- **AND** the service SHALL NOT be idle-stopped while the child runs

### Requirement: Adoption after server restart without duplication
On startup with definitions present, the manager SHALL adopt existing instances.
OCI containers SHALL be matched by the labels `pi.service=<id>` and
`pi.owner=<instanceId>`. A single running match SHALL become `idle` with re-read
endpoints, and an exited match SHALL become `stopped`. More than one match
SHALL make the service `unavailable` with reason `duplicate-instances`, serving
no endpoint, and stop/remove SHALL act on all matches. Containers labelled
`pi.service=<id>` with a different `pi.owner` SHALL make the service
`unavailable` with reason `owner-conflict`, and no container SHALL be created.
`instanceId` SHALL NOT be regenerated while `services.json` exists. Native
processes SHALL be adopted only when the recorded pid is alive, its command line
contains the recorded package token, and it holds the recorded port. A dead pid
SHALL discard the instance file. An alive but unverifiable pid (including when the port
check cannot run) SHALL make the service `unavailable` with reason
`adoption-uncertain`, and no new process SHALL be spawned until an explicit
forced stop or remove. No health probe or network I/O SHALL run during boot
adoption. Adoption SHALL NOT create an
instance. More than one matching container SHALL be reported in
`status` and SHALL NOT be removed automatically. A container whose `pi.def-hash`
label differs from the current definition SHALL be recreated on its next start.
Adopted instances SHALL start with zero leases and a fresh idle clock.

#### Scenario: Restart adopts a running container
- **WHEN** the server restarts while a labelled managed container is running
- **THEN** the service SHALL be reported `idle` with that container's endpoints
- **AND** `ensure` SHALL NOT create a new container

#### Scenario: Exited container is adopted as stopped
- **WHEN** the server restarts and the only labelled container has exited
- **THEN** the service SHALL be reported `stopped` and no endpoints SHALL be returned

### Requirement: OCI driver isolation, probing and stop
The OCI driver SHALL resolve `docker` and `podman` via `ToolRegistry`, run them
with `DOCKER_CONFIG` pointing at an empty dashboard-owned directory, and add
`--init` unless the definition opts out. For each runtime in preference order it
SHALL check, in this order:
1. the binary resolves, else reason `runtime-missing`;
2. the engine is reachable, else `host-vm-stopped` when a known host VM reports
   stopped, or `runtime-unreachable` otherwise;
3. the image is present, else `image-absent`.

An engine reporting Windows-container mode SHALL yield `unsupported-platform`.
It SHALL NOT pull images. It SHALL publish ports as `127.0.0.1::<containerPort>`
and SHALL re-read host ports after every start. Stop SHALL use the runtime's
graceful stop with `stopTimeout`, and SHALL be confirmed by inspecting that the
container is no longer running. Containers SHALL be retained after stop and
removed only by `remove` or by recreation on definition change. When the
in-container probe passes but the endpoint is unreachable from the host, and the
runtime is a podman machine, the driver SHALL open an SSH local-forward that the
service owns, expose the forwarded port as the endpoint, and terminate it with
the service.

#### Scenario: Broken registry credential helper does not break start
- **WHEN** the user's `~/.docker/config.json` names a failing credential helper and the image is local
- **THEN** the container SHALL still be created and started

#### Scenario: Runtime down is not reported as image missing
- **WHEN** docker is installed but its engine is unreachable
- **THEN** `ensure` SHALL report `unavailable` with reason `runtime-unreachable` or `host-vm-stopped`, not `image-absent`

#### Scenario: Host port changes on restart
- **WHEN** a managed container is restarted and the runtime assigns a new host port
- **THEN** the next `ensure` SHALL return the new port

### Requirement: Host VMs are never started or stopped
The manager SHALL report host-VM state (Docker Desktop, podman machine) and
SHALL NOT start or stop any host VM.

#### Scenario: Stopped podman machine
- **WHEN** a service prefers `oci:podman` and the podman machine is stopped
- **THEN** that runtime SHALL be skipped with reason `host-vm-stopped`
- **AND** no `podman machine start` SHALL be issued

#### Scenario: Idle-stop leaves the podman machine running
- **WHEN** the last managed service on a podman machine is idle-stopped
- **THEN** the podman machine SHALL remain running

### Requirement: Native driver uses structured runner recipes and never fetches implicitly
A native recipe SHALL be `{ runner, package, bin?, args }`:
- `runner` comes from a closed allowlist (`uvx`, `npx`) resolved via
  `ToolRegistry`;
- `package` pins an exact version;
- `args` may contain only `${port.<name>}` placeholders, each bound to a free
  loopback port allocated at every start.

Presence SHALL be determined without network access, either by the runner's
offline mode or by a prefetch marker that the dashboard writes after a
successful explicit prefetch. A missing package SHALL yield `unavailable` with
reason `package-absent`. Fetching SHALL happen only through an explicit prefetch
action (`service prefetch <id>`, `POST /api/services/:id/prefetch`, or the
confirmed prefetch step of `service add`). The process SHALL be spawned detached, with
pid, argv and ports recorded under `~/.pi/dashboard/services-run/<id>/`. Stop
SHALL use the shared platform helper `killProcessGroup`, and SHALL be confirmed
by no member of the process group being alive.

#### Scenario: ensure never downloads
- **WHEN** a native service's package is not in the runner's cache and `ensure` is called
- **THEN** `ensure` SHALL return `unavailable` with reason `package-absent`
- **AND** no network fetch SHALL be issued

#### Scenario: Stop leaves no orphan workers
- **WHEN** a native service whose process has spawned child workers is stopped
- **THEN** no process from its tree SHALL remain

#### Scenario: Unknown runner rejected
- **WHEN** a definition declares `runner: "bash"`
- **THEN** validation SHALL reject it with reason `invalid-definition`

### Requirement: Attached lifecycle commands are user-authored only
`attached` entries MAY declare per-platform `lifecycle.start` / `lifecycle.stop`
argv arrays only when `origin` is `"user"`. An entry that declares
`lifecycle.stop` SHALL also declare a `process` matcher, which SHALL match the
exact executable basename (case-insensitive on darwin and win32, `.exe` ignored
on win32), never a command-line substring. Commands SHALL be
executed as argv without a shell. A missing command for the current platform
SHALL make that operation unsupported, in which case `ensure` only probes. Stop
success SHALL be judged only by the `process` matcher no longer matching within
`stopTimeout`, never by the probe.

#### Scenario: Stop is not confirmed by a failing probe
- **WHEN** a `blocked` attached service (probe already failing) is stopped and its process keeps running
- **THEN** the state SHALL become `stop-failed`, not `stopped`

#### Scenario: Offer-origin attached entry with commands is refused
- **WHEN** an entry whose `origin` is a package declares `lifecycle.start`
- **THEN** validation SHALL reject the entry

### Requirement: Health probes and exposure reporting
A definition SHALL declare one health probe: `http` (path, 2xx), `tcp`,
`ws-first-message` (connection opens and a first frame arrives within the
timeout, without authentication), or `oci-healthcheck`. An `oci-healthcheck`
probe on an image without a healthcheck SHALL make the definition invalid.
Probes SHALL run async with a global concurrency cap of 4. A running service
SHALL be re-probed every 30 s while it has live leases, and on every `ensure`
and `status`. A service with no live leases SHALL NOT be polled. For local endpoints, the
service SHALL report `exposure`, one of `loopback`, `all-interfaces` or
`unknown`, as a non-blocking field.

#### Scenario: OBS-style websocket health
- **WHEN** an attached service with `ws-first-message` health sends a hello frame on connect
- **THEN** the probe SHALL pass without using any secret

#### Scenario: Service listening on all interfaces is flagged
- **WHEN** the service's port is bound to all interfaces
- **THEN** `GET /api/services` SHALL report `exposure: "all-interfaces"` for it

### Requirement: Runtime detection report
`GET /api/services/runtimes` SHALL report, for docker, podman, qemu, VirtualBox
and VMware: `installed`, `version`, `reachable` (container runtimes), host-VM
state, and a capability set using the values `ok`, `ok-destructive`,
`cli-present`, `needs-secret`, `unavailable` and `unsupported`. Detection SHALL
run only on demand, SHALL use read-only commands, and SHALL be cached for 30 s.

#### Scenario: Installed but unreachable runtime
- **WHEN** docker is installed and its engine is down
- **THEN** the report SHALL show docker `installed: true`, `reachable: false`, and its container capabilities `unavailable`

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
