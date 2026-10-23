## MODIFIED Requirements

### Requirement: Dashboard env vars injected for ergonomics

The bridge SHALL inject `PI_DASHBOARD_PORT` and `PI_DASHBOARD_BASE` environment variables into the exec environment for executable-mode templates. `PI_DASHBOARD_PORT` SHALL be read from `~/.pi/dashboard/config.json` (defaulting to `8000` when absent or unparseable). `PI_DASHBOARD_BASE` SHALL equal `http://localhost:$PI_DASHBOARD_PORT`. The bridge SHALL also inject `PI_DASHBOARD_CLI`, an absolute, shell-quoted command that runs the `pi-dashboard` CLI shipped with the bridge, so a template can call a non-observe route with `eval "$PI_DASHBOARD_CLI" api <METHOD> <path>` (which sends local proof) instead of a bare `curl` to `$PI_DASHBOARD_BASE`. `eval` makes the quoting take effect for an install path containing a space; a bare `$PI_DASHBOARD_CLI` expansion also works whenever the path needs no quoting.

#### Scenario: Templates can use $PI_DASHBOARD_BASE without setup

- **GIVEN** a template body containing `curl -s "$PI_DASHBOARD_BASE/api/health"` and the user types the matching slash command
- **THEN** the curl SHALL hit the running dashboard's health endpoint without the template having to grep `~/.pi/dashboard/config.json` first.

#### Scenario: Template reaches an operate route with proof
- **WHEN** `requireLocalProof` is unset and an executable template runs `eval "$PI_DASHBOARD_CLI" api GET /api/config`
- **THEN** the request SHALL carry local proof and succeed, with no `pi-dashboard` on PATH required
