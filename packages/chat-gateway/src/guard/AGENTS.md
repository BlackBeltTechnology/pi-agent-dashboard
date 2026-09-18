# DOX — packages/chat-gateway/src/guard

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `policy.ts` | The PURE L3 decision engine. `decideToolCall(toolName, policy)` — DENY-FIRST: explicit `allow` > explicit `approval` > `defaultAction` (default `"deny"`). An unrecognised tool name is denied, so the default fails closed; an empty/non-string name is denied rather than matching loosely. Deliberately NOT gamalan's prompt-injection guard — that shape is arguable out of a decision by model output, whereas pi's `tool_call` return is a hard gate. |
| `index.ts` | The companion pi extension loaded into gateway-SPAWNED sessions ONLY (attached sessions are owner-trusted and never handed it). `createToolCallGuard` returns the `tool_call` handler: allow ⇒ `undefined`, deny ⇒ `{block:true, reason}`, approval ⇒ `ctx.ui.confirm(...)` (which the bridge routes PromptBus → gateway → Discord yes/no). FAIL CLOSED (C3): an unanswered approval, a throwing confirm, or a timer expiry all resolve to BLOCK — never auto-allow. Timers are injectable for tests. Default export is the pi extension entrypoint; `policyFromEnv()` reads the host-projected `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` (pi passes the factory one arg, so the env — not `options` — is the real channel) and defaults to `{defaultAction:"deny"}` when absent/unparseable. |
| `__tests__/policy.test.ts` | L1 (task 12.7): the deny-first table — unlisted ⇒ deny, allow list, approval list, allow-wins-over-approval, `defaultAction` widening, empty/non-string name denied. |
| `__tests__/guard.test.ts` | L1 (X2, X3, X4): denied tool blocked BEFORE execution and never prompts; allowed tool proceeds silently; approval allow/deny; unanswered approval blocks (fail closed); throwing confirm blocks; approvable-by-default still prompts and still fails closed. |
