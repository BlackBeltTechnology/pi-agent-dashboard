# TunnelButton.tsx — index

Exports `TunnelButton`. Toolbar **Gateway** button (user-facing label "Gateway"; wire keeps `tunnel`). Polls `/api/tunnel-status` every 30s for icon/title. unavailable → navigate `/settings/gateway`; active/inactive → open `GatewayDialog` (tabbed). Connect/disconnect now live inside the dialog, not the button. See change: add-tunnel-providers (relabel + dialog swap from `QrCodeDialog`).

Colour/title/click from `gatewayIndicator(status)` over `gateway` counts (ALL planned providers): ok green, partial amber (`N/M connected`), off/unset grey; `unset` → `/settings/gateway`, else dialog. `data-tone` for tests.
