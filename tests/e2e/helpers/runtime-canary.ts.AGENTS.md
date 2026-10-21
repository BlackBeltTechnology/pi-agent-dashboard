# runtime-canary.ts — index

Harness helpers for runtime-canary specs: `CANARY_ID`, `VARIANT_IDS`, `containerSh`/`localFetch` (docker exec curl on 127.0.0.1; container resolved via `docker ps` publish filter, never by name), `pluginRow`, `runtimeListing`, `trustPlugin` (current sha), `revokePlugin`, `ensureCanaryState`, `variantsStaged`, `forwardTrustThroughContainer`, `collectConsoleErrors`, `countLoads`, `waitForCanaryEntry`. See change: decouple-plugins-from-core.
