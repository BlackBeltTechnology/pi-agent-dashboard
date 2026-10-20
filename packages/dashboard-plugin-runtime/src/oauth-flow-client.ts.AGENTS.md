# oauth-flow-client.ts — index

`createOAuthFlowClient(fetch?)` / `oauthFlowClient` — `status(flowId)` / `input(flowId,value)` / `cancel(flowId)` over `/api/provider-auth/flow/:flowId`; non-2xx rejects with the server `error`. Pair with `ui:oauth-flow`. Exported from the main barrel. See change: expose-plugin-credential-and-oauth-seams.
