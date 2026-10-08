## MODIFIED Requirements

### Requirement: Browser relay viewer messages (browser→server)

The browser→server protocol SHALL include:
- `browser_relay_subscribe` (`instanceId`, `tabId`);
- `browser_relay_unsubscribe` (`instanceId`, `tabId`);
- `browser_relay_input` (`instanceId`, `tabId`, `kind: "mouse" | "key" | "scroll" | "bringToFront" | "resize"`, kind-specific payload), typed as a union discriminated on `kind`. The `mouse`/`scroll` coordinates are normalized to `[0,1]`, and `resize` requires numeric `width` and `height` in CSS pixels.

#### Scenario: Union type inclusion

- **WHEN** `BrowserToServerMessage` union is checked
- **THEN** it SHALL include `BrowserRelaySubscribeMessage`, `BrowserRelayUnsubscribeMessage`, and `BrowserRelayInputMessage`

#### Scenario: Resize input narrows

- **WHEN** a typed consumer switches on `kind: "resize"` of a `BrowserRelayInputMessage`
- **THEN** the type SHALL narrow to a payload with numeric `width` and `height`

### Requirement: Browser relay viewer messages (server→browser)

The server→browser protocol SHALL include:
- `browser_relay_frame` (`instanceId`, `tabId`, `jpegBase64`, `metadata: {deviceWidth, deviceHeight, timestamp}`), sent only to subscribed sockets;
- `browser_relay_status` (`instances: [{instanceId, profileDirectory, state, tabs: [{tabId, title, url, state, agentEmulation?}]}]`, `auditSeq`), broadcast to all clients. `agentEmulation` is true while the CDP client holds a device-metrics override on that tab.

The core server→browser protocol SHALL also include `editor_tab_open` (`sessionId`, `path`), broadcast to all clients.

#### Scenario: Union type inclusion

- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL include `BrowserRelayFrameMessage`, `BrowserRelayStatusMessage` and `EditorTabOpenMessage`

#### Scenario: Frame never contains secrets

- **WHEN** a `BrowserRelayFrameMessage`, `BrowserRelayStatusMessage` or an `EditorTabOpenMessage` for a `browser:` path is serialized
- **THEN** it SHALL contain no relay guid and no profile token
