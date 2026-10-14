# device-auth.ts — index

Paired-device bearer store + consumption for the browser (web-client analogue of shell `connect.ts`). Exports `getDeviceBearer`/`storeDeviceBearer`/`clearDeviceBearer` (localStorage key `pi-dashboard:device-bearer`), `installDeviceAuthFetch` (idempotent global `fetch` wrapper adding `Authorization: Bearer` to same-origin `/api/*`+`/v1/*`; never overrides an explicit header), `mintWsTicket(scope)` (`POST /api/ws-ticket` with bearer → ticket; null when unpaired), `appendWsTicket`. Durable bearer never rides WS (F6). See change: make-pairing-qr-camera-scannable.

`finishDevicePairing` returns `{keepFailed}` and clears the in-memory bearer ONLY after a cookie-only authenticated request has succeeded — on a plain-http LAN origin the device cookie may be dropped, and clearing first would strand an already-approved device. See change: add-lan-knock-pairing.
