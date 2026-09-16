# DOX — packages/client/src/components/connectivity

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ConnectionStatusBanner.tsx` | Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden… → see `ConnectionStatusBanner.tsx.AGENTS.md` |
| `KnownServersSection.tsx` | Settings section managing persisted known remote servers. → see `KnownServersSection.tsx.AGENTS.md` |
| `NetworkDiscoverySection.tsx` | Settings section for mDNS server discovery. Exports `NetworkDiscoverySection`. → see `NetworkDiscoverySection.tsx.AGENTS.md` |
| `PairedDevicesSection.tsx` | Settings → Security → Paired Devices. Lists bearer-paired devices (label, last-seen), per-device… → see `PairedDevicesSection.tsx.AGENTS.md` |
| `__tests__/PairedDevicesSection.test.tsx` | F4 (mcp-legacy-clients-and-token-issuance) + create-flow rows, plus F1–F5 (expand-mcp-tiered-surface): tier radio defaults `observe` and warns on `operate`, base-URL select preselects the origin, snippet uses the chosen tier+base with the token once, token not shown after reopen, per-row tier badge. Mocks `../../lib/pairing/paired-devices-api.js`. |
| `PairLanding.tsx` | Browser `/pair` landing — phone-camera counterpart of the Electron shell `PairView`. Exports `PairLanding`. → see `PairLanding.tsx.AGENTS.md` |
| `ServerSelector.tsx` | Server selector dropdown showing persisted known servers. → see `ServerSelector.tsx.AGENTS.md` |
| `TunnelButton.tsx` | Exports `TunnelButton`. Unified tunnel/QR button. Polls `/api/tunnel-status` every 30s. → see `TunnelButton.tsx.AGENTS.md` |
