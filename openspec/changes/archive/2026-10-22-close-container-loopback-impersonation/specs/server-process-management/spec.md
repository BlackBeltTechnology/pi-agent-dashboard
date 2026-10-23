## MODIFIED Requirements

### Requirement: Backward compatible foreground mode
Running `pi-dashboard` with no subcommand (no positional word; flags only) SHALL continue to run the server in the foreground, as it does today. A first positional word that is not a recognised subcommand (every word the CLI dispatches, including `api`, `token`, `service`, `pair` and `login`) SHALL print usage and exit 2 instead of starting the server. When foreground startup fails for any reason, the command SHALL classify the resolved port once, after the failure (no listener can be bound by a failed start, whichever listener failed first: the HTTP port or the pi gateway). When that classification finds a dashboard answering, or a non-dashboard service, it SHALL print the verdict `start` prints for that classification, including the desktop-app mention when the answering server reports `launchSource: "electron"`, instead of a generic start failure. Otherwise it SHALL print today's generic failure. The exit status SHALL be 1 in every such case, the same status a failed foreground start produces today, even where `start` would exit 0 for that verdict. No classification SHALL run before or during a successful startup, so a launch on a free port is not delayed.

#### Scenario: No subcommand runs foreground
- **WHEN** a user runs `pi-dashboard` (no subcommand)
- **THEN** the server SHALL start in the foreground, write the PID file, and block until terminated

#### Scenario: Foreground while the desktop app's server is running
- **WHEN** the pi-dashboard desktop app's server for the current HOME is serving the resolved port
- **AND** a user runs `pi-dashboard` (no subcommand) under the same HOME
- **THEN** it SHALL print "Dashboard server is already running (pid N)" together with a mention that the desktop app started it
- **AND** it SHALL NOT print a generic "Failed to start dashboard" error or stack trace
- **AND** it SHALL exit with status 1
- **AND** `server.pid`, the lock metadata and the instance-id file SHALL be unchanged

#### Scenario: Foreground on a port held by another service
- **WHEN** a non-dashboard service holds the resolved port
- **AND** a user runs `pi-dashboard` (no subcommand)
- **THEN** it SHALL print the port-conflict message `start` prints and exit with status 1

#### Scenario: Foreground fails for an unrelated reason
- **WHEN** foreground startup fails and the resolved port classifies as free
- **THEN** it SHALL print today's generic start-failure message and exit with status 1

#### Scenario: Unknown subcommand does not start a server
- **WHEN** the operator runs `pi-dashboard <word>` where `<word>` is not a recognised subcommand
- **THEN** the CLI SHALL print usage and exit `2`, and SHALL NOT bind any port

## ADDED Requirements

### Requirement: Local tooling reaches the API through a proof-minting CLI
The `pi-dashboard` CLI SHALL provide `api <METHOD> <path> [--data <json>] [--port N]`,
dispatched before generic argument parsing. It sends one request to the local
dashboard, at the address literal `pi-dashboard restart` dials, with a freshly
minted per-request local credential proof, and SHALL NOT follow redirects.
In-repo docs, skills, slash-command files and `qa/tests` scripts SHALL use it, or
`pi-dashboard restart` / `npm run reload`, instead of bare `curl` to non-observe
routes.

#### Scenario: CLI call succeeds under the default
- **WHEN** `requireLocalProof` is unset and the operator runs `pi-dashboard api POST /api/restart`
- **THEN** the request SHALL carry a valid local proof and be admitted, the response body SHALL go to stdout, and the CLI SHALL exit `0`

#### Scenario: CLI refuses a target that is not a local path
- **WHEN** the operator gives a `<path>` that is an absolute URL, does not begin with `/`, begins with `//` or `/\`, or contains a control character or `#`
- **THEN** the CLI SHALL send no request (and so no proof to any host) and SHALL exit `2`

#### Scenario: non-2xx response is reported
- **WHEN** the dashboard answers the CLI request with a 3xx, 4xx or 5xx status
- **THEN** the CLI SHALL NOT follow a redirect, SHALL print the body to stderr, and SHALL exit `1`

#### Scenario: unreachable dashboard is a usage-class error
- **WHEN** no dashboard is listening on the resolved local base
- **THEN** the CLI SHALL print a "server not running" message and exit `2`
