# bearer-auth.ts — index

Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook… → see `bearer-auth.ts.AGENTS.md` Adds `pi_dash_device` cookie fallback (`/api/*` only, Authorization wins) + `registerDeviceSessionRoutes` (`POST/DELETE /api/device-session`). See change: harden-trust-and-credential-boundaries.

`deviceCookieSecure` global branch = `isSecureOrigin(request, globalSecure())` (`secure-origin.ts`): https base or loopback peer + Host equal to a live https tunnel origin. LAN carve-out (non-loopback peer, no forwarding header → no `Secure`) unchanged. See change: harden-auth-credentials.

Hook judges the `Authorization` bearer via `registry.verifyDetailed` BEFORE any network trust: expired → 401 `BEARER_EXPIRED_BODY` (`code:"bearer_expired"`) from every peer incl. loopback/trusted (`refuseExpired`; also audits `[pairing] rotate_refused … reason=bearer_expired` on `ROTATE_ROUTE`). Revoked/unknown/superseded-after-grace stay plain denial (no `code`); an expired cookie bearer falls through unauthenticated. Exports `ROTATE_ROUTE`, `BEARER_EXPIRED_BODY`. See change: harden-auth-credentials.
