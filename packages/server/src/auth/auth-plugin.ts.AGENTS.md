# auth-plugin.ts — index

Fastify plugin registers OAuth routes + `onRequest` JWT gate. Exports `registerAuthPlugin`, `validateWsUpgrade`, `isBypassed`, `escapeHtml`. Mutates auth state via `_reloadAuth` for runtime config updates. Skips auth on loopback, `/auth/`, `/api/health`, `/v1/`, bypass prefixes, trusted hosts. Cookie `pi_dash_token`, 7-day expiry, loopback/httpOnly/`sameSite:lax`.
