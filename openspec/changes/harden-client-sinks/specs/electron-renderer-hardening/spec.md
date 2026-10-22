# Spec Delta

## ADDED Requirements

### Requirement: Bundled local renderer pages enforce Trusted Types
Every HTML page the Electron shell loads from its own bundle (the loading, connecting, remote-connect, and doctor windows) SHALL declare its own Content-Security-Policy. That policy SHALL include `default-src 'none'` and an enforced `require-trusted-types-for 'script'`, plus only the allowances the page needs. Markup the page inserts SHALL go through a page-local policy registered before first use, or be built with DOM APIs; data SHALL be escaped or set as text.

#### Scenario: Doctor page has a policy
- **WHEN** the doctor window loads
- **THEN** its document carries a Content-Security-Policy with `default-src 'none'` and `require-trusted-types-for 'script'`

#### Scenario: Server name with markup in the remote list
- **WHEN** a discovered or recent server URL contains `"><img src=x onerror=alert(1)>`
- **THEN** the remote-connect list shows it as text and no handler runs

#### Scenario: Loading page still probes local servers
- **WHEN** the loading window probes a loopback dashboard's health endpoint
- **THEN** the request is allowed by the page policy and a reachable server is reported reachable

#### Scenario: Pages render under enforcement
- **WHEN** the loading, connecting, remote-connect, and doctor windows open with real data, including a known-server list on the loading page
- **THEN** each renders fully with zero Trusted Types violations
