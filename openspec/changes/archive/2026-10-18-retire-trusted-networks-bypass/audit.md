# Non-browser consumer audit — retire-trusted-networks-bypass (design D8)

Question per consumer: does a LAN caller reach the dashboard **only** because its peer IP is in `trustedNetworks` / `auth.bypassHosts` today, and does it have a credentialed path under `network.trustMode: "pair"`?

Gate: the follow-up change that flips upgrade-origin `legacy` installs to `pair` must not ship while a row is `blocker`.

| Consumer | Today on a LAN | Path under `pair` | Evidence | Status |
|---|---|---|---|---|
| Remote bridge `/ws/bridge` (pi gateway TCP listener) | Single-use `bridge`-scope ticket, or loopback / unix local credential. No network-match branch exists on this listener. | Ticket minted by a paired device (`POST /api/ws-ticket {scope:"bridge"}`, `decideBridgeTicketMint`) — unchanged. | `packages/server/src/pi/pi-gateway.ts:1129-1140` (`decideBridgeUpgrade`, no `trustedNetworks` input); dashboard-port `/ws/bridge` is refused 400 (`server.ts` WS handler, `scope === "bridge"`). | ok |
| MCP clients `/mcp` | In-handler device-token verification (`host.verifyDeviceToken`); `/mcp` deliberately does not trust `request.isAuthenticated`. | Unchanged — device token. | `packages/server/src/server.ts:1571-1580`. | ok |
| CLI (`pi-dashboard …`) | Same-host: local token / genuine loopback. Remote host: needs a device bearer. | Unchanged on the host; a remote CLI needs `pi-dashboard token create` (device bearer). | `packages/server/src/cli.ts` (`cmdTokenCreate`), `packages/server/src/auth/local-token.ts`. | ok |
| Model proxy `/v1/*` | `pi-proxy-*` key required on every request; network trust never admitted keyless `/v1` traffic. | Unchanged. | `packages/server/src/model-proxy/auth-gate.ts:45-62`. | ok |
| Browser in-page server switch (`ServerSelector`, cross-origin) | Cross-origin bearer on `fetch`, plus network trust for `<img>`, iframes and downloads that cannot carry an `Authorization` header. | Bearer still works for `fetch`/ticketed WS; iframes, `<img>` and downloads to a non-paired remote have **no** network-trust equivalent (the device cookie is `Path=/api/`, same-origin only). The prerequisite keeps the in-page switch for browsers, so an operator who opts into `pair` accepts this; the consequence callout in Security ▸ Network access states it. | `packages/client/src/components/settings/NetworkTrustParts.tsx` (consequence callout); `design.md` D8. | **blocker** for the N+1 flip (gates it; not a blocker for this change — `pair` is operator opt-in here) |
| Electron server windows | Prerequisite `add-electron-server-windows` opens each remote on its own origin. | Device cookie on that origin after pairing. | `openspec/specs/lan-knock-pairing/spec.md`; archived `add-electron-server-windows`. | ok |
| Live preview iframe (`/live/*`) | Network trust only (opaque-origin frame carries no cookie — spiked in a real browser). | Per-preview capability path minted at `control` tier. | `packages/server/src/live-server/live-capability.ts`; `design.md` D5. | ok (new path in this change) |

## Blocker handling (task 1.2)

- **In-page server switch** — gates the N+1 flip only. Tracked here, in `design.md` D8 and `proposal.md` (Migration phase 3). No code task in this change: resolving it needs a credentialed subresource path for non-paired remotes, which is its own proposal.
