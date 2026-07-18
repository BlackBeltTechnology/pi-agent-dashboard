# csp.ts — index

Baseline Content-Security-Policy (defense in depth). `buildCsp()` (default-src/object-src none/frame-ancestors self/base-uri self/worker-src blob:/connect-src ws:wss:), `resolveCspMode(env)` (`report` default / `enforce` / `off`), `registerCsp(fastify, mode)` onSend hook. Report-only header by default; skips `/live/` proxied prefixes. Env `PI_DASHBOARD_CSP`. See change: improve-content-editor.
