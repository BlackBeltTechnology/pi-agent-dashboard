# TunnelButton.tsx — index

Exports `TunnelButton`. Unified tunnel/QR button. Polls `/api/tunnel-status` every 30s. unavailable → navigate `/tunnel-setup`; active/inactive → open `QrCodeDialog`. `connect`/`disconnect` via `useAsyncAction` hitting `/api/tunnel-connect` `/api/tunnel-disconnect`.
