# Design — Dynamic PWA Manifest Naming

## Context

`public/manifest.json` is served as a static asset by fastify-static. Every PWA install across origins shows the same launcher label `"PI Dash"`. The fix is to make the manifest origin-aware and user-overridable.

## Goals

- One server, many origins → distinct PWA labels.
- Zero-config default that "just works" (auto-derives from hostname).
- Optional user override for cases where the auto-derived name is ugly or ambiguous.
- No change to icons, colors, scope, service worker.

## Non-Goals

- Per-user PWA naming (the override is server-wide, not per-browser).
- Auto-renaming existing PWA installs (OS-controlled; out of scope).
- Multi-language localisation of the name.

## Name Resolution

```
                      GET /manifest.json
                              │
                              ▼
              ┌───────────────────────────────┐
              │ resolveManifestName(req,cfg)  │
              └───────────────┬───────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
  cfg.dashboardName     stripPort(                os.hostname()
  ?.trim()              req.headers.host)         (e.g. "macbook-pro")
       │                      │                      │
       │ truthy ───────────┐  │ truthy ───────────┐  │ always ───┐
       ▼                   │  ▼                   │  ▼           │
   use as-is               │ use as-is            │ use as-is    │ fallback
                           │                      │              │ "Pi-Dash"
                           └──────────┬───────────┘              │
                                      ▼                          ▼
                              ┌─────────────────────────────────┐
                              │ source = first non-empty result │
                              └────────────────┬────────────────┘
                                               ▼
                              name       = `Pi-Dash · ${source}`
                              short_name = source.slice(0, 12)
                              id         = "/"
```

### Why Host header before os.hostname()?

Two installs on the same physical box should be distinct:

- LAN: `mybox.local:8000` → label `Pi-Dash · mybox.local`
- Tunnel: `abc123.share.zrok.io` → label `Pi-Dash · abc123.share.zrok.io`
- Local: `localhost:8000` → label `Pi-Dash · localhost`

If we used `os.hostname()` first, all three installs from one box would share a label — defeating the purpose.

### Short-name truncation

PWA `short_name` is meant for ≤12 chars (home-screen label). We slice rather than ellipsise to keep it grep-friendly. Examples:

| source                          | short_name      |
|---------------------------------|-----------------|
| `mybox.local`                   | `mybox.local`   |
| `abc123.share.zrok.io`          | `abc123.share`  |
| `Home NAS` (override)           | `Home NAS`      |
| `192.168.1.20`                  | `192.168.1.2`   |

The truncation is uglier for IPs than for hostnames, but users with IP-only access can supply an override.

## Route Wiring

```
Fastify registration order (existing → new):

  1. fastify-static (serves public/, dist/client/)
  2. API routes (/api/*)
  3. WebSocket upgrades
  4. notFoundHandler (SPA fallback)

We need /manifest.json to win over fastify-static. Two options:

  (a) Register GET /manifest.json BEFORE fastify-static.
      Fastify's reply.sendFile only fires on no-match, so an
      explicit route always wins.

  (b) Set fastify-static's `decorateReply: false` + custom
      preHandler. Overkill.

→ Pick (a). Add the route inline near the other top-level routes
  before fastify-static is registered, OR use onRequest hook with
  a path guard. Simplest: explicit fastify.get("/manifest.json",
  handler) registered before the static plugin in setupRoutes().
```

## Manifest Body

Spread the static fields (icons, theme, background, display, start_url) from the existing `public/manifest.json` so changes there propagate. The route only overrides `name`, `short_name`, and adds `id`.

```ts
{
  ...staticManifest,           // icons, colors, display, start_url
  id: "/",
  name: `Pi-Dash · ${source}`,
  short_name: source.slice(0, 12),
}
```

Read `staticManifest` once at module load (fs.readFileSync) — it's tiny and immutable per build.

## Config Field

```ts
// packages/shared/src/config.ts
export interface DashboardConfig {
  // ...existing fields...
  /** Display name used in the PWA manifest. Blank → auto from Host/hostname. */
  dashboardName?: string;
}
```

No default in the schema — absence means "auto". Settings panel sends `null`/empty string to clear.

## Dev Mode

In `--dev`, Vite serves `public/manifest.json` directly when proxying. The dynamic route only kicks in for requests that reach Fastify. For dev users who install the dashboard as a PWA (rare), they get the static name — acceptable. Document this as a known limitation.

If someone really wants dynamic naming in dev, they can hit the production manifest via `curl http://localhost:8000/manifest.json` and confirm it works. Vite's static-asset precedence is a Vite concern; not worth a workaround.

## Caching Headers

```
Cache-Control: no-cache, must-revalidate
```

Browsers re-fetch the manifest on each PWA-install attempt and periodically thereafter. We want updates (e.g. user changes override in Settings) to land quickly. The body is <1 KB; revalidation cost is negligible.

## Risks & Trade-offs

| Risk | Mitigation |
|------|------------|
| User sets ugly override (empty spaces, emoji) | Trim + collapse whitespace; reject empty after trim. Don't sanitise emoji — user choice. |
| Host header spoofing | Only affects the spoofer's own install; no security boundary crossed. Ignore. |
| iOS install frozen at old name | Documented; user uninstalls + reinstalls. |
| Multiple proxies between client and server rewriting Host | Falls through to `os.hostname()`. User can override. |
| Same hostname on two machines (e.g. two `localhost`) | User must override; documented. |
| Short_name truncation cutting mid-word | Accepted; user can supply override that fits. |

## Alternatives Considered

1. **Static fixed name "Pi-Dash"** (current). Rejected — doesn't solve the multi-install problem.
2. **Suffix only os.hostname()**. Rejected — same-box-different-origin installs collide.
3. **Client-side JS rewrites the manifest before registration**. Rejected — manifest must be a real file at install time; browsers fetch it themselves.
4. **Per-browser cookie-based naming**. Rejected — over-engineered; the server-wide override covers the real use cases.

## Open Questions

- Should the override field live under a `pwa: { ... }` namespace in config for future expansion (theme color, etc.)? **Decision: no.** YAGNI; flat `dashboardName` is fine; can refactor later if `pwaTheme` etc. arrive.
- Should we also emit `description` field with the source? **Decision: no.** Most launchers ignore `description`; not worth the noise.
