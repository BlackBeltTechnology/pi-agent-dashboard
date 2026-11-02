# remote-registration-gate.ts — index

Pre-register D8 gate for REMOTE endpoints: `isRemoteEndpoint`, `gateRemoteRegistration` (input needs `env`; challenges the origin from `resolveDashboardHttpOrigin`; resolver failure refuses with cause `bad-http-url`/`no-http-origin`; `httpBaseUrlFor` removed) (local → skip; no pin at all → allow as `unpinned-legacy`; any pin exists → challenge or refuse, never pin on sight). Wired in `bridge.ts` before `connection.connect()`. See change: add-pi-gateway-transport-identity (tasks 7.2/7.3). See change: fix-remote-bridge-ticket-origin.

Runs TLS checks before sending any bearer. See change: prove-vault-bridge-tls.
