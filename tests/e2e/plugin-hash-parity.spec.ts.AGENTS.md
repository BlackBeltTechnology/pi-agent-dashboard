# plugin-hash-parity.spec.ts — index

L3 for served-client build coherence (test-plan F3). The harness serves a client built from the same checkout, so `/api/health.clientBuild.status` must be `matched` with a hex `pluginRegistryHash` equal to the runtime `bundleHash`, and the `plugin-staleness-banner` testid must NEVER appear (before this change it appeared permanently, because the runtime hash counted the client-less `mcp-server` plugin the build dropped). Reads the harness through the fixtures' baseURL — port from `.pi-test-harness.json#dashboardPort`, never hardcoded. See change: add-served-build-coherence-and-hash-parity (design D4).

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 F3: clientBuild matched; banner hidden.
