# pairing-qr.ts — index

Pairing payload ↔ QR/copy-string codecs. Exports `encodePayloadString` (bare `pi:pair:v1.<b64>` copy-string, Electron paste), `encodePairingQrUrl(payload, baseUrl)` (camera-scannable `https://<host>/pair#pi:pair:v1.<b64>` deep link; payload in FRAGMENT so the one-time code never reaches server/logs), `decodePayloadString` (accepts https deep link → strips fragment, `pi:pair:v1.` prefix, bare b64, or raw JSON; validates). See change: make-pairing-qr-camera-scannable.
