# helpers/__tests__/playwright-config.test.ts — index

Unit tests (vitest `tests` project) for the ROOT `playwright.config.ts`, imported by absolute file URL (config sits outside this project's `tests/` root). Asserts no `globalTimeout` (#450: committed whole-run budget removed; per-test `timeout` 60s still bounds), `globalTeardown` wired, and the CI-only `blob` reporter (present when `CI` set, absent locally alongside `list` + `html`) — the sharded CI workflow merges per-shard blobs. See change: stabilize-browser-e2e.
