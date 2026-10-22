# csp.ts — index

Baseline Content-Security-Policy (defense in depth). `buildCsp()` (default-src/object-src none/frame-ancestors self/base-uri self/worker-src blob:/connect-src ws:wss:), `resolveCspMode(env)` (`report` default / `enforce` / `off`), `registerCsp(fastify, mode)` onSend hook. Report-only header by default; skips `/live/` proxied prefixes. Env `PI_DASHBOARD_CSP`. See change: improve-content-editor.
`registerCsp` only adds an ABSENT header, so a `serveApp` response's own enforced `Content-Security-Policy` survives in `report` + `enforce` (report also gets baseline `-Report-Only`); `off` registers no hook and the mount sets its own. Doc-comment + tests only, no logic change. See change: add-plugin-capability-routes (D7).

`resolveTrustedTypesMode(raw, cspMode)` (`PI_DASHBOARD_TRUSTED_TYPES`; unset → off iff CSP off, else report); `registerCsp(fastify, mode, ttMode)` appends `require-trusted-types-for 'script'` to the baseline when modes match, else sets the other header kind with the directive alone; add-only-if-absent per kind; off+off → no hook. See change: harden-client-sinks.
