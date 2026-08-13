# DOX — packages/server/src/auth

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `auth-plugin.ts` | Fastify plugin registers OAuth routes + `onRequest` JWT gate. → see `auth-plugin.ts.AGENTS.md` |
| `auth.ts` | OAuth2 core: providers (GitHub, Google, Keycloak, generic OIDC via `.well-known` discovery), JWT sign/verify,… → see `auth.ts.AGENTS.md` |
| `bearer-auth.ts` | Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook… → see `bearer-auth.ts.AGENTS.md` |
| `bind-reachability-service.ts` | Server inputs to the shared reachability predicate. `initBindReachability({resolvedBindHost, hostFlag})` freezes the boot value; `computeBindReachability(loadConfig)` re-resolves `pendingBindHost` against the CURRENT config; `getLastBindReachability()` backs the WS connect-replay; `formatBindReachabilityWarning` emits the `[bind-reachability]` startup line. Deliberately NOT on `/api/health` (no preHandler; this is network topology). See change: warn-unreachable-trusted-networks. |
| `cors-origin.ts` | Pure CORS origin allow-decision extracted from the `@fastify/cors` callback in `server.ts` so it is… → see `cors-origin.ts.AGENTS.md` |
| `csp.ts` | Baseline Content-Security-Policy (defense in depth). `buildCsp()` (default-src/object-src… → see `csp.ts.AGENTS.md` |
| `identity.ts` | Persistent Ed25519 server identity (D2, TOFU pinning). `ensureServerIdentity(path?)` generates/loads keypair… → see `identity.ts.AGENTS.md` |
| `local-token.ts` | Local-IPC allowlist token (D10, narrowed). `ensureLocalToken(dir?)` writes high-entropy secret to… → see `local-token.ts.AGENTS.md` |
| `localhost-guard.ts` | Network access guard: `createNetworkGuard(trustedNetworks, {localToken?})`… → see `localhost-guard.ts.AGENTS.md` `isLoopback`/`LOOPBACK_ADDRESSES` now live in `auth/loopback.ts` (imported, NOT re-exported — a re-export keeps the cycle edge). See change: cleanup-import-cycles. Guard semantics UNCHANGED by the reachability advisory — it never consults the predicate. See change: warn-unreachable-trusted-networks. |
| `loopback.ts` | Import-free leaf: `LOOPBACK_ADDRESSES` set + `isLoopback(ip)`. Extracted from `localhost-guard.ts` so it and `tunnel/tunnel-block-events.ts` depend on this leaf instead of each other (broke the 2-edge cycle). Keep import-free — an import back into either former side re-forms the cycle. See change: cleanup-import-cycles. |
| `node-guard.ts` | Re-exports `isAffectedNode`/`isOutOfEnginesRange` from shared `node-version.ts` (public API unchanged). → see `node-guard.ts.AGENTS.md` |
| `oauth-callback-server.ts` | Temporary HTTP callback server for OAuth auth-code flows. → see `oauth-callback-server.ts.AGENTS.md` |
| `provider-auth-handlers.ts` | OAuth provider handlers for browser-based provider auth. Exports `AuthCodeHandler`, `DeviceCodeHandler`,… → see `provider-auth-handlers.ts.AGENTS.md` |
| `provider-auth-storage.ts` | Reads/writes `~/.pi/agent/auth.json` for pi provider credentials via `proper-lockfile` + atomic write. → see `provider-auth-storage.ts.AGENTS.md` |
| `spawn-token.ts` | Spawn correlation token. Exports `mintSpawnToken()` (UUIDv4), `SPAWN_TOKEN_ENV_VAR =… → see `spawn-token.ts.AGENTS.md` |
| `test-env-guard.ts` | Exports `isUnsafeTestHomeScan()` — defense-in-depth against destructive PID-registry sweeps during vitest… → see `test-env-guard.ts.AGENTS.md` |
| `ws-ticket.ts` | Single-use WS upgrade tickets (D11/F4/F6). `WsTicketStore(now?)`: `mint(scope)` high-entropy in-memory ticket… → see `ws-ticket.ts.AGENTS.md` |
