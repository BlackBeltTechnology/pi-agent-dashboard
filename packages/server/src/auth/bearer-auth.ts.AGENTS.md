# bearer-auth.ts — index

Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook (registered before OAuth plugin) that verifies `Authorization: Bearer` against `PairedDeviceRegistry` and sets `request.isAuthenticated`. Exports `parseBearerHeader`. Durable bearer NEVER rides WS (F6) — WS uses `ws-ticket.ts`. See change: add-server-keypair-pairing.
