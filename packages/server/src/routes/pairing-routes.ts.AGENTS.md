# pairing-routes.ts — index

Server-identity challenge + device-pairing routes. Exports `registerPairingRoutes`, `PUBLIC_PAIRING_PREFIXES`. PUBLIC (device-facing, auth-exempt): `POST /api/pair/challenge` (signed-nonce identity proof), `/redeem` (code→pending+confirm code), `/poll` (collect bearer). AUTH (networkGuard): `GET /api/pair/payload`, `POST /api/pair/approve` (D12 typed compare-code), `GET /api/paired-devices`, `DELETE /api/paired-devices/:id`. See change: add-server-keypair-pairing.
