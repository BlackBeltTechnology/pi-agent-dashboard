# bearer-auth.ts — index

Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook (registered before OAuth plugin) that verifies `Authorization: Bearer` against `PairedDeviceRegistry` and sets `request.isAuthenticated` AND the additive `request.authVia = "device"` marker (read by pairing-routes `operatorGuard` to refuse a device bearer on the mint route; nothing else reads it). Exports `parseBearerHeader`. Durable bearer NEVER rides WS (F6) — WS uses `ws-ticket.ts`. See change: add-server-keypair-pairing, mcp-legacy-clients-and-token-issuance.
