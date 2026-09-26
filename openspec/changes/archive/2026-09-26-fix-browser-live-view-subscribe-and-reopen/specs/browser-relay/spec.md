## ADDED Requirements

### Requirement: Tab viewability is reported in status

`browser_relay_status` SHALL report a tab that the relay knows about but that has no debugger session (for example the extension's own `chrome-extension://` connect page, or a tab the agent has not attached to) as `state: "detached"` with `reason: "no-session"`, never as `live`. When that tab later gains a debugger session, the relay SHALL broadcast `browser_relay_status` with the tab's new state. `reason: "devtools"` keeps its existing meaning and takes precedence over `no-session`.

#### Scenario: Extension connect page is not reported live

- **WHEN** a connected instance's only known tab has no debugger session
- **THEN** `browser_relay_status` SHALL list that tab with `state: "detached"` and `reason: "no-session"`

#### Scenario: Tab becomes viewable

- **WHEN** the agent attaches to a previously `no-session` tab
- **THEN** the relay SHALL broadcast `browser_relay_status` listing that tab in a state other than `detached/no-session`

#### Scenario: DevTools reason wins

- **WHEN** a tab was detached by the user opening DevTools and has no session
- **THEN** the tab SHALL be reported with `reason: "devtools"`

### Requirement: Refused viewer subscribes are audited

When a `browser_relay_subscribe` for a known instance is refused (tab has no debugger session, tab detached by DevTools, or the CDP client owns the tab's screencast), the relay SHALL append an audit entry of kind `viewer-subscribe-refused` whose detail names the tab and the refusal reason, SHALL NOT start a screencast, and SHALL keep the viewer unsubscribed.

#### Scenario: Subscribe to a no-session tab

- **WHEN** a viewer subscribes to a tab with no debugger session
- **THEN** no `Page.startScreencast` SHALL be sent and the profile's audit SHALL gain a `viewer-subscribe-refused` row with reason `no-session`
