# architecture.md — history index

Overflow of `architecture.md.AGENTS.md`. Change-history facts moved from the `docs/AGENTS.md` `architecture.md` row. Lossless.

- Question stack §: open prompts → global list, claim latch, ask-timeout override. See change: add-pending-question-stack.
- See change: add-acp-session-driver, update-pi-core-1-0-adopt-apis, migrate-mcp-to-pi-builtin, fix-empty-status-subcard.
- host-gate default `enforce`. Pairing revoke/approve operator-only. See change: harden-server-request-surfaces.
- `requireLocalProof` strict mode + proof bootstrap. Marker-less relay. Device cookie. OAuth state. Config `0600`. See change: harden-trust-and-credential-boundaries.
- Plugin-config partial write keeps omitted keys (validation clones body). See change: fix-plugin-config-partial-write.
- Pi trust mirror §. MCP Trust + Host trust updated. See change: mirror-dashboard-trust-to-pi.
- Pi trust mirror § gains "Live trust query": `POST /api/pi-trust/query`, local identity proof + remote salted digest (`trustResourceManifest`), `liveQueryTimeoutMs`, 18 reason codes, rate limits, `/api/health` `piTrustMirror.live`, rollback levers. See change: mirror-dashboard-trust-live-remote.
