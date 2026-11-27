# project-trust-live.ts — index

Bridge live-query transport. `createHttpLiveQuery` (local: fresh `X-Pi-Local-Proof`; remote: device bearer to the `resolveDashboardHttpOrigin` origin from `deps.env`, resolver failure → `{kind:"error"}` + one log per cause; `redirect:"error"`; caller's AbortSignal), `isRemoteBridge(endpoint,env)`. See change: mirror-dashboard-trust-live-remote, fix-remote-bridge-ticket-origin. Runs TLS checks before sending any bearer. See change: prove-vault-bridge-tls.
