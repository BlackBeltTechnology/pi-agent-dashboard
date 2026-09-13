## ADDED Requirements

### Requirement: Browser relay viewer messages (browser→server)

The browser→server protocol SHALL include `browser_relay_subscribe` (`instanceId`, `tabId`), `browser_relay_unsubscribe` (`instanceId`, `tabId`), and `browser_relay_input` (`instanceId`, `tabId`, `kind: "mouse" | "key" | "scroll" | "bringToFront"`, kind-specific payload with `mouse`/`scroll` coordinates normalized to `[0,1]`).

#### Scenario: Union type inclusion

- **WHEN** `BrowserToServerMessage` union is checked
- **THEN** it SHALL include `BrowserRelaySubscribeMessage`, `BrowserRelayUnsubscribeMessage`, and `BrowserRelayInputMessage`

### Requirement: Browser relay viewer messages (server→browser)

The server→browser protocol SHALL include `browser_relay_frame` (`instanceId`, `tabId`, `jpegBase64`, `metadata: {deviceWidth, deviceHeight, timestamp}`) sent only to subscribed sockets, and `browser_relay_status` (`instances: [{instanceId, profileDirectory, state, tabs: [{tabId, title, url, state}]}]`, `auditSeq`) broadcast to all clients.

#### Scenario: Union type inclusion

- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL include `BrowserRelayFrameMessage` and `BrowserRelayStatusMessage`

#### Scenario: Frame never contains secrets

- **WHEN** a `BrowserRelayFrameMessage` or `BrowserRelayStatusMessage` is serialized
- **THEN** it SHALL contain no relay guid and no profile token
