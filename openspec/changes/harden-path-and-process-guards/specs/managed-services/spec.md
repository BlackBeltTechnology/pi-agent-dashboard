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
- While the child runs, `exec` SHALL forward `SIGTERM`, `SIGINT` and `SIGHUP`
  to it, wait for it to exit, release the lease, and exit with the child's
  status (128+n when the child died to signal n). If the child is still alive
  after a kill-grace (default 5 s) from the first forwarded signal, `exec` SHALL
  send it `SIGKILL`. A repeated signal SHALL be forwarded but SHALL NOT shorten
  the grace (a terminal delivers the same signal to `exec` directly and through
  the CLI wrapper). Its handlers SHALL stay installed until the lease release has
  completed and SHALL then be removed. `exec` signals its direct child only;
  descendants reparented by a child that exits are not reaped. `SIGKILL` of
  `exec` itself cannot be forwarded; the lease then expires at its TTL.
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
#### Scenario: exec forwards SIGTERM and releases the lease
- **GIVEN** `service exec docling -- <child>` is running a child that is terminated by `SIGTERM`
- **WHEN** `exec` receives `SIGTERM`
- **THEN** the child SHALL receive `SIGTERM`, the lease SHALL be released after it exits, and `exec` SHALL exit with 143
- **AND** a child that handles `SIGTERM` and exits with code N SHALL make `exec` exit with N

#### Scenario: A child that ignores the signal is killed after the grace
- **GIVEN** a child that ignores `SIGTERM`
- **WHEN** `exec` receives `SIGTERM` and the kill-grace elapses
- **THEN** `exec` SHALL send the child `SIGKILL`, release the lease, and exit

#### Scenario: A repeated signal does not escalate
- **GIVEN** a child that ignores `SIGTERM` and a forwarded `SIGINT` is already in flight
- **WHEN** `exec` receives `SIGINT` again immediately (a terminal Ctrl-C reaching `exec` directly and through the wrapper)
- **THEN** the child SHALL NOT receive `SIGKILL` before the kill-grace elapses

#### Scenario: Handlers do not outlive the child
- **WHEN** the child has exited, `exec` has released the lease, and the release call has resolved
- **THEN** no `SIGTERM`, `SIGINT` or `SIGHUP` listener added by `exec` SHALL remain registered

#### Scenario: A signal during the lease release does not skip it
- **GIVEN** the child has exited and the lease release call is in flight
- **WHEN** `exec` receives `SIGTERM`
- **THEN** `exec` SHALL still complete the lease release before exiting
