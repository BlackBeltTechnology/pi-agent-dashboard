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
(`--purge-data` / `purgeData: true`). The confirmation skipped by `--yes` SHALL
NOT cover any package prefetch.

#### Scenario: Plugin upgrade does not rewrite the entry
- **WHEN** a package upgrade changes the `docling` offer's image digest
- **THEN** the `docling` entry in `services.json` SHALL be unchanged
- **AND** `GET /api/services` SHALL report `updateAvailable: true` with the digest diff

#### Scenario: Dry-run writes nothing
- **WHEN** `POST /api/services` is called with `dryRun: true`
- **THEN** `services.json` SHALL be unchanged

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
  network guard. Every mutating route SHALL additionally require an
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
