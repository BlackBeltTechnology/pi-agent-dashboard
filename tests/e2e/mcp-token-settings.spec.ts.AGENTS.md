# mcp-token-settings.spec.ts — index

L3 spec for the Settings → Paired Devices MCP-client token flow (change: mcp-legacy-clients-and-token-issuance, test-plan F1/F2/F3). F1: mint via the UI, assert the `claude mcp add` snippet shape + host equals the page origin + the token element matches the snippet bearer. F2: dismiss → token unrecoverable from the DOM, row listed with a `manual` badge, real registry row `source: "manual"`. F3: the minted bearer authenticates on `POST /mcp` (legacy era, header 2025-06-18), revoke drains all `claude-code` rows, bearer then 401s.

The harness browser is docker-gateway-sourced (never loopback), so the D5 operator guard admits it ONLY via a login session: the spec narrows the seeded config (`trustedNetworks: []`, `bypassUrls: ["/v1/"]` — the seed's trust-any `bypassHosts` otherwise returns from the auth hook BEFORE the cookie branch, so `authVia` never lands), arms a session cookie signed with the KNOWN e2e secret seeded by `docker/test-entrypoint.sh` (PI_E2E_OAUTH=1), attaches the cookie to both the browser context and every `request` call, and restores the seed values in `afterAll`. Safe against racing: `workers: 1`. F1/F2 mint `claude-code` rows that F3 drains (no registry reset exists in the helpers).

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 for the Settings → Paired Devices MCP-client token flow (change:
