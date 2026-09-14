## REMOVED Requirements

### Requirement: Enforcement mode is switchable and defaults to report-only
**Reason**: The report-only default existed to size refusal logs before enforcing (`add-host-allowlist-admission`). This change flips the default; the requirement is re-stated under a name that does not encode the old default so the header stays truthful.
**Migration**: Operators who need the old behaviour set `hostGate.mode: "report"` in `config.json` or `PI_DASHBOARD_HOST_GATE=report`. Every other clause carries over unchanged into "Enforcement mode is switchable and defaults to enforce".

## ADDED Requirements

### Requirement: Enforcement mode is switchable and defaults to enforce
The gate SHALL run in one of two modes, `report` or `enforce`, resolved in this order: the `PI_DASHBOARD_HOST_GATE` environment variable when it holds a recognised value (an unrecognised value contributes nothing and SHALL be logged once at boot); else the `hostGate.mode` config value read live; else `enforce`. In `report` a non-admissible Host is logged and the request proceeds; in `enforce` it is refused. A refused HTTP request SHALL receive `403` and no CORS headers; when the request's `Accept` header's first media type is `text/html` (absent `Accept`, `*/*`, or `application/json, text/html;q=0.9` select JSON) the body SHALL be a static HTML page that names the received `Host` (HTML-escaped), names `http://localhost:<port>` as the way in, and names `allowedHosts` and `publicBaseUrls` as the two ways to admit the name; it SHALL NOT enumerate admitted hostnames, tunnel origins, or bind addresses (the refused page is same-origin-readable by a rebinding page) and SHALL reference no script or asset served by the dashboard; otherwise the body SHALL be JSON `{ success: false, error: "host_not_allowed", reason: <human-readable>, hint: <names the config keys that would admit the host> }`. A refused WebSocket upgrade SHALL receive `HTTP/1.1 403` and the socket SHALL be destroyed. The server SHALL log the resolved mode and its source (`env`, `config`, or `default`) once at boot.

#### Scenario: Enforce default refuses a non-admissible Host
- **WHEN** `PI_DASHBOARD_HOST_GATE` is unset, `hostGate.mode` is absent, and a request arrives with a non-admissible `Host`
- **THEN** the request SHALL be refused with `403` and one refusal line SHALL be logged

#### Scenario: Enforce default still admits the loopback and IP-literal population
- **WHEN** `PI_DASHBOARD_HOST_GATE` is unset, `hostGate.mode` is absent, and requests arrive with `Host: localhost:8000`, `Host: 127.0.0.1:8000`, `Host: [::1]:8000`, and `Host: 192.168.1.20:8000`
- **THEN** every request SHALL be served normally

#### Scenario: Report-only opt-out via config
- **WHEN** `hostGate.mode` is `report` and the env var is unset and a request arrives with a non-admissible `Host`
- **THEN** the request SHALL be served normally and one refusal line SHALL be logged

#### Scenario: Enforce mode refuses with a self-describing body
- **WHEN** `PI_DASHBOARD_HOST_GATE=enforce` and `GET /api/health` arrives with `Host: rebind.example`
- **THEN** the response SHALL be `403` with `error: "host_not_allowed"` and a `hint` naming `allowedHosts` and `publicBaseUrls`, and SHALL carry no `Access-Control-Allow-Origin` header

#### Scenario: Unrecognised env value falls through to config
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is absent
- **THEN** the gate SHALL behave as `enforce`
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is `report`
- **THEN** the gate SHALL behave as `report`

#### Scenario: Config mode applies live and env overrides it
- **WHEN** `hostGate.mode` is changed to `report` in `config.json` while the server runs and the env var is unset
- **THEN** the next non-admissible request SHALL be served with no restart
- **WHEN** `PI_DASHBOARD_HOST_GATE=report` is set and `hostGate.mode` is `enforce`
- **THEN** the gate SHALL behave as `report`

#### Scenario: Browser navigation gets the HTML refusal page
- **WHEN** `enforce` mode and `GET /` arrives with `Host: rebind.example:8000` and `Accept: text/html,*/*`
- **THEN** the response SHALL be `403` with `Content-Type: text/html`, the body SHALL contain `rebind.example:8000`, `localhost:8000`, `allowedHosts`, and `publicBaseUrls`, and SHALL contain no `<script>` and no `/assets/` reference

#### Scenario: Received Host is escaped in the HTML page
- **WHEN** `enforce` mode and `GET /` arrives with `Host: a<img>.example` and `Accept: text/html`
- **THEN** the body SHALL contain `a&lt;img&gt;.example` and SHALL NOT contain `<img>`

#### Scenario: HTML page does not enumerate admitted hosts
- **WHEN** `enforce` mode, a live tunnel origin is `https://abc.share.zrok.io`, `allowedHosts` contains `dash.home.arpa`, and `GET /` arrives with a refused Host and `Accept: text/html`
- **THEN** the body SHALL contain neither `abc.share.zrok.io` nor `dash.home.arpa`

#### Scenario: fetch caller gets the JSON refusal
- **WHEN** `enforce` mode and `GET /api/health` arrives with `Host: rebind.example` and `Accept: application/json`
- **THEN** the response SHALL be `403` JSON with `error: "host_not_allowed"`

#### Scenario: Boot log names the resolved mode
- **WHEN** the server starts with neither env var nor config mode set
- **THEN** one boot log line SHALL state the host gate is `enforce` from `default`
