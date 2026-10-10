# DOX — packages/client/src/components/connectivity

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `__tests__/UsersSection.test.tsx` | Users section: list/orphaned, add, invite QR, re-tier + two-click revoke, unstable disabled-with-reason, disabled note, bootstrap. See change: add-passkey-user-auth. |
| `ConnectionStatusBanner.tsx` | Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden… → see `ConnectionStatusBanner.tsx.AGENTS.md` |
| `KnownServersSection.tsx` | Settings section managing persisted known remote servers. → see `KnownServersSection.tsx.AGENTS.md` |
| `NetworkDiscoverySection.tsx` | Settings section for mDNS server discovery. Exports `NetworkDiscoverySection`. → see `NetworkDiscoverySection.tsx.AGENTS.md` |
| `PairedDevicesSection.tsx` | Settings → Security → Paired Devices. Lists bearer-paired devices (label, last-seen), per-device… → see `PairedDevicesSection.tsx.AGENTS.md` |
| `__tests__/PairedDevicesSection.test.tsx` | F4 (mcp-legacy-clients-and-token-issuance) + create-flow rows, plus F1–F5 (expand-mcp-tiered-surface): tier radio defaults `observe` and warns on `operate`, base-URL select preselects the origin, snippet uses the chosen tier+base with the token once, token not shown after reopen, per-row tier badge. Mocks `../../lib/pairing/paired-devices-api.js`. |
| `PairLanding.tsx` | Browser `/pair` landing — phone-camera counterpart of the Electron shell `PairView`. Exports `PairLanding`. → see `PairLanding.tsx.AGENTS.md` |
| `PasskeyImpactNote.tsx` | `PasskeyImpactNote({url,testId,debounceMs})`: fetches `credentialImpact(url)`, renders `impactConsequence` warning or nothing (errors swallowed — advisory). Used by primary switch + `auth.redirectBaseUrl` field. See change: add-passkey-user-auth. |
| `ServerSelector.tsx` | Server selector dropdown showing persisted known servers. → see `ServerSelector.tsx.AGENTS.md` |
| `TunnelButton.tsx` | Exports `TunnelButton`. Unified tunnel/QR button. Polls `/api/tunnel-status` every 30s. → see `TunnelButton.tsx.AGENTS.md` |
| `UsersSection.tsx` | Settings → Security → Users: add user + tier (empty ⇒ first-operator bootstrap, no tier picker), re-tier select, two-click revoke, Invite QR (img data URL + copy link), orphaned badge, unstable origin ⇒ invite DISABLED with `aria-describedby` reason, disabled feature ⇒ how-to-enable note. Uses `lib/users/*`. See change: add-passkey-user-auth. |
