# invoicebot-plugin/src/server

Server entry, routes, session-linkage seam. Engine bindings under `engine/`.

| File | Purpose |
|------|---------|
| `index.ts` | `registerPlugin(ctx)`: `selectEngine()` (await; loader awaits before listen), build `createSessionLink` from ctx (spawnSession/emitEventToSession/getSession/listAll/onEvent — trust-gated first-party), `mountInvoiceBotRoutes`. Logs engine binding. |
| `routes.ts` | `mountInvoiceBotRoutes(fastify, {engine, dispatchFlow})`. 4 POST routes + `GET /blob`. `badCwd()` (existing dir, no NUL → 400). `normalize()` → `{ok,text,data,sessionId?,consequential?}`. `isConsequential()` per api-contract §10. Flow-triggering results (`.flow`) → `dispatchFlow` → attach `sessionId`. `GET /blob` streams a retained original via `resolveBlobPath`: `Content-Type` by ext, `inline`, `Accept-Ranges`, `nosniff`; `parseRange()` → 206/416; 400/403/404 on reject. See change: serve-invoice-original-blob. |
| `blob.ts` | `resolveBlobPath(cwd, handle)` → `{ok,abs}` \| typed reject (`invalid-input`\|`traversal`\|`not-found`). Two-stage containment under `<cwd>/.pi/flows/invoicebot-state/blobs/`: lexical (defeats `..`/absolute) + realpath (defeats symlink) + isFile. `contentTypeFor(ext)`: pdf/png/jpe?g, else octet-stream. See change: serve-invoice-original-blob. |
| `session-link.ts` | `createSessionLink(deps) → {dispatchFlow, resolveSessionId, links, dispose}`. Reuse a live cwd-matched invoicebot session via `emitEventToSession`, else spawn + correlate by stamped `automationRun.runId` (NEVER cwd — footgun); deliver-on-register. `isInvoicebotSession` gate (cwd match + `automationRun.name` starts `invoicebot`). `invoice_id ↔ sessionId` map. `resolveSessionId` → link, else `listAll` scan, else null. |
| `__tests__/engine.test.ts` | Fake per-selector `details` shapes + flow-vs-pure classification (§3.5). |
| `__tests__/routes.test.ts` | Forwarding, 400s (missing cwd/selector/bad dir), cwd isolation (concurrent A/B), flow dispatch + sessionId, consequential flags (§4.5, §5.5). Fastify `inject` + recording stub engine. |
| `__tests__/blob.test.ts` | Unit: `resolveBlobPath` happy path, `..`/absolute/symlink → traversal, missing file → not-found, blank cwd/handle + NUL → invalid-input; `contentTypeFor` mapping. See change: serve-invoice-original-blob. |
| `__tests__/blob-route.test.ts` | Route: PDF/PNG/octet-stream inline + nosniff + Accept-Ranges (3.1); `Range: bytes=0-99` → 206 + Content-Range, unsatisfiable → 416 (3.2); traversal/absolute/symlink → 403, absent → 404, missing params → 400 (3.3). See change: serve-invoice-original-blob. |
| `__tests__/session-link.test.ts` | Reuse; spawn+runId correlation (same-cwd decoy not mis-bound); stale/unrelated sessionId → spawn, never injected; bind-timeout → spawnToken; resolveSessionId link/scan/null (§5.5, §6.1). |
| guard | `session-link` marks its spawns `guard: true` (change: constrain-agent-tool-surface) → host disables built-in tools for the spawn AND registers the workspace cwd as guarded, so the client-spawned "Ask"/Kérdezz session there is guarded too (origin ∪ cwd). |
