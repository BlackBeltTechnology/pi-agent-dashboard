# DOX — packages/client/src/components/Gateway

Reusable Gateway (tunnel-providers) UI sections + two hosts. User-facing label
"Gateway"; the wire keeps `tunnel`. Composed by the Gateway settings page and
the tabbed Gateway dialog. See change: add-tunnel-providers.

| File | Purpose |
|------|---------|
| `GatewayDialog.tsx` | Tabbed **Gateway** dialog (task 9.3): Setup / Access & QR (default) / Security. Reads `tunnel.provider`/`mode` via `GET /api/config`, persists via `PUT /api/config` (`tunnel` deep-merged). Composes the four sections; Security tab cross-refs the Security page. Exports `GatewayDialog`. |
| `GatewayEndpoints.tsx` | "Accessible at" tagged endpoint list (kind pill + TLS/no-TLS badge + copy) + **Add HTTPS URL** control (task 6.4). Add path: re-read config → `appendPublicBaseUrl` → PUT FULL `pairing` (shallow-overwrite) → refetch. Client https/wss gate is UX-only. Exports `GatewayEndpoints`. |
| `GatewayPage.tsx` | **Gateway** settings page (task 9.2) under Network nav. Full-width host: provider/mode, connect-a-device (QR first), accessible-at, setup guide, Security cross-ref. Self-manages provider/mode via GET/PUT config. Exports `GatewayPage`. |
| `GatewayPairQR.tsx` | Connect-a-device — two QR kinds by transport (D1). Pairing QR encodes a camera-scannable `https://<tls-endpoint>/pair#pi:pair:v1.<b64>` deep link (`encodePairingQrUrl` from `lib/pairing-qr.ts`; landing base = `pairingEps[0]?.url ?? payload.urls[0]`; payload in FRAGMENT, one-time code out of logs); copy-string stays bare `pi:pair:v1.…` (`encodePayloadString`, unchanged). TLS-only `{v,id,code,urls[]}` re-guarded by `guardPairingUrls` (task 8.3). Link QR = bare URL per no-TLS endpoint (task 8.2, no payload/crypto/bearer). Endpoint mini-list marks `in QR`/`excluded`. Typed compare-code approval (D12). Exports `GatewayPairQR`. See change: make-pairing-qr-camera-scannable. |
| `GatewayProviderSection.tsx` | Provider + mode segmented controls. Mode gated by the provider matrix (`supportsMode`); switching provider auto-selects a valid mode. Exports `GatewayProviderSection`. |
| `GatewaySetupGuide.tsx` | Per-provider setup steps (D3): install=copy-paste; auth-token/activate=field+button → `runEnrollStep` (`POST /api/tunnel/enroll`, validated param); browser-auth/external=link. Exports `GatewaySetupGuide`. |
