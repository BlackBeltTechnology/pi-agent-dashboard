# electron-shell — delta

## ADDED Requirements

### Requirement: Remote-mode attach probes reachability in the main process
When attaching in remote mode, the app SHALL determine target reachability using a **main-process** probe (a Node HTTP request that sends no browser `Origin` header and is not subject to CORS), and the renderer SHALL reach the dashboard via a top-level navigation (`location.href = serverUrl`). The loading page SHALL NOT gate that navigation behind a renderer-side `fetch` from its `file://` (`Origin: null`) document, because a remote dashboard's CORS policy deliberately refuses the `null` origin — making such a probe never succeed and the attach hang until the error timeout despite a healthy, directly-reachable server.

#### Scenario: Remote attach reaches a healthy remote without a renderer fetch gate
- **WHEN** the app starts in remote mode with `remoteUrl = http://192.168.16.242:8000` and that server is healthy
- **THEN** the main process SHALL probe `${remoteUrl}/api/health` (Node fetch, no `Origin` header) and report reachable
- **AND** the loading page SHALL navigate the window to `remoteUrl` via a top-level navigation
- **AND** the attach SHALL NOT depend on a renderer `fetch(${remoteUrl}/api/health)` succeeding

#### Scenario: Loopback attach unchanged
- **WHEN** the app attaches to `http://localhost:<port>`
- **THEN** the loading page behavior SHALL be unchanged (its existing health polling and Start server / Open Doctor / server-log controls after ~15 s still apply)

#### Scenario: Unreachable remote still surfaces the error page
- **WHEN** the app starts in remote mode but the remote is genuinely unreachable
- **THEN** the main-process probe SHALL report not-reachable
- **AND** the loading page SHALL surface the existing connection-error UI after the timeout (no indefinite silent hang)
