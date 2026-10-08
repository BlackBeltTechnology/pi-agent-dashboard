# remote-registration-gate.ts — index

Pre-register D8 gate for REMOTE endpoints: `isRemoteEndpoint`, `httpBaseUrlFor`, `gateRemoteRegistration` (local → skip; no pin at all → allow as `unpinned-legacy`; any pin exists → challenge or refuse, never pin on sight). Wired in `bridge.ts` before `connection.connect()`. See change: add-pi-gateway-transport-identity (tasks 7.2/7.3).
