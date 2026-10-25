# live-server-proxy.ts — index

Reverse proxy for live-server targets on MAIN origin `/live/:id/*` (mirrors editor-proxy). `registerLiveServerProxy` self-registers `@fastify/reply-from` (sole `from`-decorator consumer since editor-proxy deleted), proxies to `http://127.0.0.1:<port>`, only forwards manager-registered=validated targets, unregistered→404) + `handleLiveServerUpgrade` (raw TCP WS pipe for HMR). See change: improve-content-editor, fix-live-server-proxy-reply-from.

Capability prefix stripped from upstream path + Referer; redirects stay in prefix. `Referrer-Policy: no-referrer` added when absent (capability requests only). `stripDashboardCredentials` drops `pi_dash_*` cookies + device-bearer `Authorization` on HTTP and WS upgrade. Upstream `Set-Cookie pi_dash_*` dropped. See change: retire-trusted-networks-bypass.

Static branch via `serveStatic` (capability required). Browser-originated (`Origin: null`/`Sec-Fetch-*`) without capability → 404 (HTTP + WS). Every capability response gets `buildLiveCsp` (appended to upstream CSP). `X-Forwarded-For` set on every upstream HTTP + WS request. Deps: `staticGate(cwd,abs)` (per-request raw-read gate), `grantedOrigins(grant)` (`<G>`), `reservedHandler` (reserved `/__pi/*` under a capability prefix; hook for csp-report). See change: improve-canvas-html-and-url-ux.


New deps wired by the server: `onStaticHtmlServed(grant, realPath)` (HTML served under a token → lazy origin scan), `grantedOrigins` = `previewEgress.grantedFor` (project grants read live per response), `reservedHandler` = `createReservedHandler` (csp-report; the proxy registers the `application/csp-report` + `application/reports+json` parsers when it is set). See change: improve-canvas-html-and-url-ux.

`isDeviceBearer(token, req)` takes the request; new `isKnownBearer` strips every registry-known bearer upstream. See change: prove-vault-bridge-tls.
