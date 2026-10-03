## Why

pi 1.0.0 makes Radius (Earendil's AI gateway) a top-level `/login` option. After sign-in, `/login` offers to point the Radius MCP server in the global `mcp.json` at that login (`"auth": { "provider": "radius" }`), then reloads the session. Split out of the pi 1.0.0 adoption review.

The dashboard cannot do any of this. `provider-auth-registry.ts` hard-excludes `radius` (`EXCLUDED_PROVIDER_IDS`, `packages/server/src/auth/provider-auth-registry.ts:53`) on the grounds that its OAuth targets a gateway the dashboard does not manage. On pi 1.0.0 that reason no longer holds for the built-in provider:
- pi-ai's built-in `radius` is `radiusProvider()` with no options (`@earendil-works/pi-ai/dist/providers/all.js:116`), so its OAuth always targets `DEFAULT_RADIUS_GATEWAY` (`https://radius.pi.dev`). `PI_RADIUS_GATEWAY` only steers bug-report upload (`pi-coding-agent/dist/core/radius.js`, `bug-report-upload.js`), not login.
- The only non-default gateway path is a `models.json` provider with `oauth: "radius"` + `baseUrl` (`pi-coding-agent/dist/core/model-runtime.js:114-126`). When that provider's id is `radius`, it **replaces** the built-in in pi sessions — the one case the dashboard must not sign in to the default gateway.

## What Changes

- Remove the unconditional `radius` exclusion. The registry includes the built-in `radius` entry, **except** while the Pi-global `models.json` (pi's agent dir, JSONC) declares a provider with id `radius`, `oauth: "radius"` and a non-default `baseUrl` (a custom gateway pi would use instead). In that case Radius stays out of the registry. The file is parsed as pi parses it (schema validation excepted), and the result is cached for at most 1 s, so a `models.json` edit applies without restart. Other custom `oauth: "radius"` ids remain out of scope (registry is built with `modelsPath: null`).
- Radius name and badge come from pi: name `Radius`; `isSubscription` unset → **Account** badge. The flow-type hint gains `radius: "auth_code"`, the same as `openai-codex`, since both start with a browser/device `select`. The login's first prompt (browser vs device code) renders through the existing generic `select` step — no Radius-specific dialog code.
- After a successful Radius sign-in, the providers section shows an inline opt-in offer to configure the Radius MCP server in the Pi-global `mcp.json`, mirroring pi's `offerRadiusMcpServer` semantics (match by URL; set `auth.provider`; drop `oauth`; name = existing entry, else `radius`, else `radius-mcp`; no offer when already configured). Accepting writes through the `mcp-client` writer, fans out `/reload` to sessions, and reports how many actually reloaded.
- `RADIUS_API_KEY` keeps working; as `radius` is now an OAuth id, its api-key / environment row takes the existing twin naming (`radius-api`, "Radius (API Key)").

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `provider-auth-server`: `radius` joins the registry unless overridden by `models.json`. The exclusion, handler-id and subscription scenarios change, and new Radius MCP status + configure endpoints are added.
- `headless-reload`: the Radius MCP configure write becomes reload trigger source 7.
- `provider-auth-ui`: Radius row (Account badge) and the post-sign-in "configure Radius MCP" offer.

## Impact

- Code: `packages/server/src/auth/provider-auth-registry.ts`, `packages/server/src/routes/provider-auth-routes.ts`, new `packages/server/src/auth/radius-override.ts` + `radius-mcp.ts`, `packages/server/src/server.ts` (reload fan-out wiring), `packages/server/package.json` (workspace dep on `mcp-client-plugin` `./core`), `packages/shared/src/route-tiers.ts`, `packages/client/src/components/settings/ProviderAuthSection.tsx` (+ the sign-in dialog).
- **Depends on** `update-pi-core-1-0-adopt-apis` (archived: 1.0.0 floor, `subscription` flag) and `migrate-mcp-to-pi-builtin` (not yet built: pi-shape writer targeting `mcp.json`, `auth` validation, global-only `auth.provider`). The MCP-offer tasks cannot land before that change.
- Non-goals: dashboard model-proxy routing/refresh of a Radius OAuth credential (`oauth-facade.ts` keeps no Radius loader — pi sessions refresh their own credential); `/share` → Radius artifacts; custom-gateway Radius login.
- Risk: the browser sign-in method listens on the **server's** `127.0.0.1:1456`; a remote browser cannot complete it (Radius has no paste-code fallback). pi's own option label points such users at device code; the existing "callback port already bound" error covers a concurrent pi `/login`.
- Rollback: revert; no data migration (credentials live in pi's `auth.json`; an added `mcp.json` entry is an ordinary user-removable server).

## Discipline Skills

`security-hardening` (new OAuth provider; new write into the Pi-global `mcp.json` with a provider-auth reference) · `doubt-driven-review` (registry exclusion removal is user-visible; first server-core import of a plugin package) · `review-code`.
