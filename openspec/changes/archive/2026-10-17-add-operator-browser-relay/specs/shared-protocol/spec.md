## MODIFIED Requirements

### Requirement: Browser relay viewer messages (browser→server)

The browser→server protocol SHALL include:
- `browser_relay_subscribe` (`instanceId`, `tabId`, optional `local: boolean`);
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
- `browser_relay_status` (`instances: [{instanceId, profileDirectory, host, state, tabs: [{tabId, title, url, state, agentEmulation?}]}]`, `auditSeq`), broadcast to all clients. `agentEmulation` is true while the CDP client holds a device-metrics override on that tab. `host` is `"dashboard"` or the operator `hostId` the instance runs on.

The core server→browser protocol SHALL also include `editor_tab_open` (`sessionId`, `path`), broadcast to all clients.

#### Scenario: Union type inclusion

- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL include `BrowserRelayFrameMessage`, `BrowserRelayStatusMessage` and `EditorTabOpenMessage`

#### Scenario: Frame never contains secrets

- **WHEN** a `BrowserRelayFrameMessage`, `BrowserRelayStatusMessage` or an `EditorTabOpenMessage` for a `browser:` path is serialized
- **THEN** it SHALL contain no relay guid and no profile token

## ADDED Requirements

### Requirement: Browser relay operator host messages

The browser→server protocol SHALL include `browser_host_hello` (`hostId`, `publicKey`), `browser_host_register` (`hostId`, `signature`, `label`, `platform`, `canOpenChrome`, `profiles: [{profileDirectory, label, email?, installed}]`), `browser_host_connect_result` (`requestId`, `ok`, `reason?`), `browser_host_ext_open` (`linkId`), `browser_host_ext_data` (`linkId`, `data: string`) and `browser_host_ext_close` (`linkId`, `code`). The server→browser protocol SHALL include `browser_host_challenge` (`nonce`, `serverId`), `browser_host_registered` (`hostId`), `browser_host_connect` (`requestId`, `linkId`, `instanceId`, `profileDirectory`, `serverLabel`), `browser_host_connect_cancel` (`requestId`), `browser_host_relay_data` (`linkId`, `data`), `browser_host_relay_close` (`linkId`, `code`, `reason?`) and `browser_host_tee` (`linkId`, `instanceId`, `tabId`, `on`). No message type name SHALL be used in both directions. Every browser→server `browser_host_*` type SHALL be listed at tier `operate` in the WS message tier table.

#### Scenario: Union type inclusion

- **WHEN** the `BrowserToServerMessage` and `ServerToBrowserMessage` unions are checked
- **THEN** they SHALL include every `browser_host_*` message type above, each in exactly one union

#### Scenario: Tier table lists the new types

- **WHEN** the WS message tier of each browser→server `browser_host_*` type is looked up
- **THEN** it SHALL be `operate`

#### Scenario: No guid, token or key on the wire

- **WHEN** any `browser_host_*` message is serialized
- **THEN** it SHALL contain no relay guid, no pairing token and no private key
