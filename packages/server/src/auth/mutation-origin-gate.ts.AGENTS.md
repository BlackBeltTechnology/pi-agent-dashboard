# mutation-origin-gate.ts — index

Cross-site MUTATION gate (issue #625). `createMutationOriginGate(getOpts)` → Fastify `onRequest` hook: gates `/api/*` + `POST /auth/logout`, skips GET/HEAD/OPTIONS, refuses `403 {error:"untrusted origin"}` when `isMutationOriginTrusted` denies, logs one sanitized `[csrf-gate]` line. Matches on `req.routeOptions.url` (post-routing route PATTERN) — NEVER raw `req.url`, which path tricks defeat. Registered in `server.ts` after the CORS plugin. A factory, not an inline hook, so the rule is `fastify.inject`-testable. See change: fix-ws-origin-cswsh (D4).
