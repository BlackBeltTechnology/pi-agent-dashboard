# DOX — packages/extension/src/__tests__/helpers

Test helpers (excluded from coverage). One row per file.

| File | Purpose |
|------|---------|
| `bridge-instance-stub.ts` | `makeStubPi`, `makeStubConnection`, `makeStubInstance(overrides, {generation, shared, pi})`. Stub `pi` records `pi.on` handlers in `handlers`. Unset instance fields stay `undefined` so an unexpected read fails loudly. See change: test-trust-audit. |
| `bridge-source.ts` | `readBridgeSource(file)` reads `bridge.ts` / `bridge-handlers/*.ts` with the `inst.` prefix stripped. Source-text guards pin closure names, not access paths. See change: test-trust-audit. |
| `settle-prompts.ts` | Settle helper for deliberately in-flight `PromptBus.request` calls in tests (no reject path, so floating requests are safe). |
