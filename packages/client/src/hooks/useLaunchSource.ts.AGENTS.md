# useLaunchSource.ts — index

One-shot probe of `/api/health` `launchSource` field (`"electron" | "standalone" | "bridge"`). Module-level cached + deduped inflight. Returns `null` while in flight; consumers fail-open. Exports test-only `__resetLaunchSourceCacheForTests()`.
