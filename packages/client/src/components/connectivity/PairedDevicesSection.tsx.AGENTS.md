# PairedDevicesSection.tsx — index

Settings → Security → Paired Devices. Lists bearer-paired devices (label, last-seen), per-device revoke-with-confirm (deletes registry row via `revokePairedDevice`); `manual` badge on `source: "manual"` rows; "Create token for an MCP client" flow (D6): label input → `createPairedDevice` → one-shot panel (`data-testid="mcp-token-result"`, token + `claude mcp add --transport http pi-dashboard <snippetBase()>/mcp --header "Authorization: Bearer <token>"` snippet, `copyText`), Dismiss clears token from state + reloads; `snippetBase()` = `getApiBase() || window.location.origin` (tunnel users get tunnel origin). Double-submit guard (`minting`). Exports `PairedDevicesSection`. See change: add-server-keypair-pairing, mcp-legacy-clients-and-token-issuance.

## expand-mcp-tiered-surface (tier + base-URL picker)

- Create-token flow gains a tier radio (`TIER_OPTIONS`, default `observe`) with one-line descriptions; `operate` shows a warning naming restart/package/process control.
- Base-URL `select` populated from `reachableUrls()` (`GET /api/pair/reachable-urls`); preselects `window.location.origin` when present. Snippet targets the chosen base.
- Device list shows a tier badge (`data-testid="tier-<id>"`) per row.
- `createPairedDevice(label, tier)`; `PairedDeviceView.tier`.
