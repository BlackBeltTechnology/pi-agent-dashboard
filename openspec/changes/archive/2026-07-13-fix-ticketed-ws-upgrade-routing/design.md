## Context

The WS upgrade handler in `packages/server/src/server.ts`
(`fastify.server.on("upgrade", …)`) authorizes the upgrade, then dispatches to a
gateway by URL:

```js
const scope = routeScopeForUrl(request.url);   // strips query → "browser" for /ws?ticket=…
// … auth check (validateWsUpgrade / no-auth branch) …
if (request.url === "/ws") {                    // BUG: exact match, includes query string
  browserGateway.wss.handleUpgrade(...)
} else if (request.url?.startsWith("/ws/terminal/")) { ... }
} else { socket.destroy(); }                    // ticketed /ws?ticket=… lands here
```

Paired devices append a single-use ticket (`/ws?ticket=<t>`) because the durable
bearer must never ride the socket (F6). `request.url` is then `"/ws?ticket=…"`,
which is not `=== "/ws"`, so the authorized upgrade falls through to
`socket.destroy()`. The sibling routes already use `startsWith` and are immune;
only the browser route uses exact equality. `scope` is already computed one line
above via `routeScopeForUrl()`, which strips the query — so the correct routing
key already exists in scope.

## Goals / Non-Goals

**Goals:**
- A validated ticketed `/ws?ticket=<t>` upgrade routes to the browser gateway and
  returns `101`, identical to a bare `/ws`.
- Preserve every existing refusal path unchanged (no-ticket, reused/expired
  ticket, wrong-scope ticket, tunnel-as-loopback, no-auth branch).
- Add a server-level regression test so this cannot silently regress again.

**Non-Goals:**
- Any client change (`useWebSocket` already appends `?ticket=` correctly).
- The zrok reserved-share churn (CLI ↔ API version mismatch) — separate issue.
- Reworking the ticket/scope model; only the post-auth routing key changes.

## Decisions

- **Route on `scope`, not the raw URL.** Replace the `request.url === "/ws"` /
  `request.url?.startsWith(...)` chain with a switch on the already-computed
  `scope` (`"browser" | "terminal" | "editor" | "live"`) from
  `routeScopeForUrl(request.url)`. This is the single source of truth for "which
  gateway", is query-string-safe by construction, and keeps auth-scope and
  routing-scope from drifting. Fallback form if preferred:
  `const pathOnly = request.url?.split("?")[0]`.
- **No behavior change for the sibling routes.** They already tolerate the query;
  routing them through `scope` yields identical dispatch.
- **Test at the HTTP-upgrade layer.** Mint a real browser-scope ticket via
  `/api/ws-ticket`, then assert `/ws?ticket=<t>` upgrades to `101`; assert a
  ticketless remote-shaped upgrade is still refused. Covers both the
  `authConfig.secret` branch and the no-auth branch.

## Risks / Trade-offs

- **Scope/route divergence:** if a future WS path is added to the upgrade switch
  but not to `routeScopeForUrl`, `scope` is `null` and it would fall through to
  the default `socket.destroy()`. Mitigation: the two live in the same module;
  add both together. This is strictly safer than today (an unknown path is
  refused, not mis-routed).
- **Low blast radius:** one routing condition; sibling routes and all auth gates
  are untouched. The regression test locks the contract.
