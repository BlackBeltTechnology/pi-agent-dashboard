## REMOVED Requirements

### Requirement: Temporary callback server for OAuth redirects

**Reason**: The dashboard no longer runs its own callback server. The pi runtime's OAuth flow opens its own loopback listener on the provider-registered port, receives the code, exchanges it, and returns the credential; the dashboard only persists the result. Port-in-use, timeout, and concurrent-flow behaviour are now specified under `provider-auth-server` ("Flow start", "Flow cancel", "Flow lifetime and pruning").

**Migration**: None for clients. The port-occupied case surfaces as HTTP 500 from `POST /api/provider-auth/start`; the no-callback case is covered by the `manual_code` paste prompt and the flow lifetime.

### Requirement: Auth-code handlers declare registered redirect URI

**Reason**: There are no dashboard-side auth-code handlers. The redirect URI is owned by the runtime's flow for each provider.

**Migration**: None.

### Requirement: Authorize endpoint opens system browser

**Reason**: `POST /api/provider-auth/authorize` is removed. `POST /api/provider-auth/start` opens the authorization URL the runtime's flow publishes (`provider-auth-server` › "Flow start"). The Gemini CLI and Antigravity scenarios described providers pi removed in 0.71.

**Migration**: Clients call `POST /api/provider-auth/start`.

### Requirement: Browser client detects auth completion

**Reason**: Completion is observed per flow via `GET /api/provider-auth/flow/:flowId` (`provider-auth-ui` › "OAuth popup login flow"), not by polling the aggregate status endpoint.

**Migration**: Clients poll the flow endpoint returned by `start`.

### Requirement: Popup relay mechanism removed

**Reason**: Historical requirement recording the removal of a relay page. The success/error HTML is now served by the runtime flow's own listener, not by dashboard code; there is nothing left for this requirement to constrain.

**Migration**: None.
