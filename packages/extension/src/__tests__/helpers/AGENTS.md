# DOX — packages/extension/src/__tests__/helpers

Test helpers (excluded from coverage). One row per file.

| File | Purpose |
|------|---------|
| `bridge-inbound-peaks.ts` | Recorded peak inbound load per bridge connection (3 prompts/s, burst 8, 1 concurrent bash, /reload fan-out 40). Defaults in `inbound-limits.ts` must stay ≥ 3× these; BP1 asserts it. See change: harden-bridge-inbound-and-discovery (task 2.1). |
| `bridge-instance-stub.ts` | `makeStubPi`, `makeStubConnection`, `makeStubInstance(overrides, {generation, shared, pi})`. Stub `pi` records `pi.on` handlers in `handlers`. Unset instance fields stay `undefined` so an unexpected read fails loudly. See change: test-trust-audit. `makeStubInstance` supplies a real default `inboundLimits` (`createInboundLimits()`). See change: harden-bridge-inbound-and-discovery. |
| `bridge-source.ts` | `readBridgeSource(file)` reads `bridge.ts` / `bridge-handlers/*.ts` with the `inst.` prefix stripped. Source-text guards pin closure names, not access paths. See change: test-trust-audit. |
| `bridge-tls-child.ts` | Child-process harness for bridge TLS trust-store tests. See change: prove-vault-bridge-tls. |
| `event-bus-host.ts` | `makeHost()` = one shared `EventEmitter` + two independent `events` facades (`bridgeEvents`, `foreignEvents`), pi's real topology. `makeDeps(over)` = `EventBusForwardingDeps` recording `sent` / `buffered` / `marked`. See change: skip-rpc-probes-in-event-forwarder. |
| `fixture-leaf.ts` | Fixture leaf cert helper for bridge TLS tests. See change: prove-vault-bridge-tls. |
| `settle-prompts.ts` | Settle helper for deliberately in-flight `PromptBus.request` calls in tests (no reject path, so floating requests are safe). |
