## ADDED Requirements

### Requirement: In-process dedicated browser service

The browser plugin SHALL provide an in-process service named `browser.dedicated` to other dashboard plugins with:
- `status()`: `enabled` (the browser plugin is loaded and its config kill switch is on) and the dedicated profile status reported by `GET /api/browser/status`;
- `connect({client, takeover?, private?, ephemeral?})`: the same behaviour, results and refusals as `POST /api/browser/dedicated/connect`, with `client` recorded as the holder. With `takeover: true` it SHALL close the live dedicated instance and register the new one atomically, so no other connect can succeed in between. With `private: true` the instance's tabs SHALL be excluded from `browser_relay_status` and viewer subscribes to them SHALL be refused and audited as `viewer-subscribe-refused`. With `ephemeral: true` the instance SHALL get its own browser context, separate from the profile's cookies, storage and history: every tab the client creates SHALL open in it, the client SHALL see only that context's targets, its downloads SHALL go to the downloads directory, and the context SHALL be discarded with everything in it when the instance closes for any reason;
- `open({url, instanceId?})`: the same behaviour and URL rules as `POST /api/browser/dedicated/open`; with the `instanceId` of an ephemeral instance the hidden tab SHALL open in that instance's context;
- `focus(tabId)`: bring a server-owned tab opened through `open` to the front;
- `tabOrigin(tabId)`: the current origin of a server-owned tab (never its path, query or content), or `null` when it is closed;
- `disconnect(instanceId)`: closes that instance as `POST /api/browser/disconnect` does.

Refusals SHALL be returned as `{status, reason, holder?, instanceId?}` values, never as thrown errors carrying secrets. The service SHALL apply the same kill switch, deny set and audit as the HTTP routes. After the browser plugin stops, every service method SHALL refuse with `{status: 503, reason: "unloaded"}`.

#### Scenario: Plugin consumer connects

- **WHEN** another plugin calls `connect({client: "gmail-setup"})` while the dedicated profile is free
- **THEN** it SHALL receive `{cdpUrl, instanceId}`, and `status()` SHALL then report `holder` `gmail-setup`

#### Scenario: Busy refusal names the instance

- **WHEN** an agent session holds the dedicated profile and a consumer calls `connect({client: "gmail-setup"})`
- **THEN** it SHALL receive `{status: 409, reason: "busy", holder, instanceId}`

#### Scenario: Atomic takeover

- **WHEN** a consumer calls `connect({client: "gmail-setup", takeover: true})` while an agent session holds the profile and that session immediately calls `browser_connect` again
- **THEN** the consumer SHALL hold the profile and the agent session SHALL receive `busy`

#### Scenario: Ephemeral context is discarded

- **WHEN** a consumer connects with `ephemeral: true`, signs in to a site in a tab of that instance, and then disconnects
- **THEN** the site SHALL not be signed in in the dedicated profile's normal context, and a new ephemeral instance SHALL start signed out

#### Scenario: Ephemeral context gone after a crash

- **WHEN** the dedicated Chrome exits while an ephemeral instance is live
- **THEN** after the next launch no cookie set in that ephemeral context SHALL exist

#### Scenario: Private instance

- **WHEN** a consumer connects with `private: true` and creates a tab
- **THEN** `browser_relay_status` SHALL NOT list that tab

#### Scenario: Disabled

- **WHEN** the browser plugin's kill switch is off and a consumer calls `connect`
- **THEN** it SHALL receive `{status: 403, reason: "disabled"}` and nothing SHALL be launched

#### Scenario: Plugin stopped

- **WHEN** the browser plugin has stopped and a consumer still holds the service object
- **THEN** every method SHALL return `{status: 503, reason: "unloaded"}`
