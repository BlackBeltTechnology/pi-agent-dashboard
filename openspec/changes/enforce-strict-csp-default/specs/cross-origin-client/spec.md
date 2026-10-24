## ADDED Requirements

### Requirement: Cross-origin API base depends on the serving host's CSP mode

The cross-origin requirements of this capability describe client behaviour. They are exercisable end to end only when the dashboard server that served the page runs its CSP in `report` or `off` mode. When that server's CSP mode resolves to `enforce` (its default), the browser refuses the page's cross-origin `fetch` and image requests under the served policy, and the serving dashboard SHALL NOT widen its policy to allow them. A same-origin API base is unaffected by the CSP mode.

#### Scenario: Cross-origin switch from a report-mode host
- **GIVEN** the page was served by a dashboard running `PI_DASHBOARD_CSP=report`
- **WHEN** the client's API base is another dashboard's origin
- **THEN** REST calls, WS-ticket minting, bearer pairing and rotation SHALL reach that origin
- **AND** the authenticated WebSocket to that origin SHALL open with the minted ticket

#### Scenario: Cross-origin switch from an enforcing host is refused by the browser
- **GIVEN** the page was served by a dashboard whose CSP mode resolves to `enforce`
- **WHEN** the client's API base is another dashboard's origin
- **THEN** the browser SHALL refuse the cross-origin REST, WS-ticket and image requests under the served policy
- **AND** the serving dashboard's policy SHALL NOT be widened to allow them

#### Scenario: Dashboard-served build-time override
- **GIVEN** a client built with `VITE_API_URL` pointing at another origin
- **WHEN** a dashboard whose CSP mode resolves to `enforce` serves that build
- **THEN** the browser SHALL refuse its cross-origin REST and WS-ticket requests
- **AND** serving the same build from a dashboard running `PI_DASHBOARD_CSP=report` SHALL let them reach the configured origin

#### Scenario: Same-origin API base works in every mode
- **WHEN** the client's API base is the page's own origin
- **THEN** REST calls and WS-ticket minting SHALL work whether the serving host's CSP mode is `off`, `report` or `enforce`
