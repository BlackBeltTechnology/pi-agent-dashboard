# DOX — packages/client/src/lib/boot

Client boot sequence. One row per source file.

| File | Purpose |
|------|---------|
| `client-boot.ts` | `bootClient(mount)` — `installTrustedTypes()`, `startViolationReporter()`, link-blocked notice text, service worker via `trustedWorkerUrl("/sw.js")`, then `loadCatalog` and `mount`. Order is the contract (policies before first render). See change: harden-client-sinks. |
