# SUPERSEDED — 2026-07-13

Superseded by: **`fix-pi-flows-end-to-end`** (archived `2026-05-13-fix-pi-flows-end-to-end`).

Reason: the broader end-to-end change delivered every task group of this narrower slice, and landed 2 days *before* this proposal was authored (2026-05-15). This appears to have been an earlier, unlanded slice of the larger fix.

Task-group mapping (this change → delivered by `fix-pi-flows-end-to-end`):
- 1 pi-package `main`/`exports` fixes → its task 4 (added to `pi-flows` + `@pi/anthropic-messages`).
- 2 peer-probe fallback → `packages/flows-anthropic-bridge-plugin/src/peer-probe.ts` two-tier resolution (`createRequire.resolve` → `resolvePiPackage`).
- 3 dual-write to `packages[]` → `plugin-bridge-register.ts` (`ensurePackageEntry`, `reconcilePluginBridgePackages`, `classifyBridgeSource`).
- 4 health surfacing → `BridgeLoadSource` + `bridgeLoadedFrom` in `/api/health.plugins[]`.
- 5/7 spec + docs → its task 7.

Not carried over (intentionally): this change's `bridgeStatus` runtime-enum (the superseding change used the simpler `bridgeLoadedFrom` field); manual E2E verification stayed deferred (`[~]`) in both. Original artifacts preserved below for history.
