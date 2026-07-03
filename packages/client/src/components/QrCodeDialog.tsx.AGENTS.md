# QrCodeDialog.tsx — index

Dialog showing tunnel URL as QR code for mobile access. Exports `QrCodeDialog`. Props: `url`, `connected`, `onDisconnect`, `onConnect`, `onSetup`, `busy`. Renders QR via `QRCode.toCanvas` (swallows jsdom canvas failure), copy-URL button, connect/disconnect/setup actions.
