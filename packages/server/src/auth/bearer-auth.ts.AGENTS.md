# bearer-auth.ts — index

Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook… → see `bearer-auth.ts.AGENTS.md` Adds `pi_dash_device` cookie fallback (`/api/*` only, Authorization wins) + `registerDeviceSessionRoutes` (`POST/DELETE /api/device-session`). See change: harden-trust-and-credential-boundaries.
