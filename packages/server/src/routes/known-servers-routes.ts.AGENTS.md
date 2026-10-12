# known-servers-routes.ts — index

Known-servers config + mDNS discovery routes. Exports `registerKnownServersRoutes(fastify, deps)`, `enqueueKnownServersWrite`.
- `GET /api/known-servers` (networkGuard): `{data: entries(+fingerprint, +movedTo), canManage}`; `canManage` = side-effect-free run of the operator guard.
- Mutations + probe: `preHandler: [networkGuard, operatorGuard]` (login / local proof / local token / genuinely-local). Network-trusted + paired-device callers refused 401, no outbound call, no write.
- `POST /api/known-servers {host,port,label?,fingerprint?}`: challenge (`proveServerIdentity`, 2 s, bounded) OUTSIDE the queue; pins only a PROVEN fingerprint (body hint never stored); `409 identity_changed {expected,proven}`; `409 already_known {host,port}` when holder still proves; dead holder → updated in place `{data:{updated:true}}` (label only if non-empty, `addedAt` kept). Existing pin never cleared.
- `DELETE /api/known-servers`; `POST /api/known-servers/accept-move {host,port}` re-verifies stored fails + suggested proves, then rewrites host/port (label/fp/`addedAt` kept), logs `[known-servers] moved fp=<16 chars> old -> new`.
- `POST /api/known-servers/probe {host,port}`: persisted entries only (else 403); `dns.lookup` (3 s) → `name-not-resolved|timeout`; `GET /api/health` `redirect:manual` 2 s → `reachable|refused|timeout|error`; one in-flight per `normalizeHostKey` entry; `reachable` on an unpinned entry triggers backfill (merge duplicate holder).
- `POST /api/discover-servers`: peers + `fingerprint`/`name`.
- ONE module-level serialized write queue; every write re-reads config and aborts if its target (present at snapshot time) was deleted meanwhile.
Deps seams: `prove`, `lookup`, `fetchImpl`, `moves`, `timeouts`, `log`. See change: stabilize-mdns-server-identity.
