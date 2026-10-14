## Why

`add-lan-knock-pairing` makes a plain-http LAN origin a first-class way to use the dashboard, so the SPA now runs in a non-secure browser context. That change audited and fixed `packages/client` and `packages/client-utils` (secure-context-only `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`) behind `randomUuid()` / `lib/util/clipboard.ts`, with a source-scan test. The plugin client bundles (for example `gmail-plugin`, `kb-plugin`, `deck3d`) were explicitly out of scope and may still call those APIs bare.

## What Changes

- Audit every plugin client bundle (`packages/*-plugin/src/client`, `packages/*/src/client`) for the three secure-context-only APIs and route each hit through a shared helper (hoist `randomUuid()` / `copyText()` into a package plugins may import without a client → plugin dependency cycle) or capability-check it.
- Extend the source-scan test (`secure-context-scan.test.ts`) to cover the plugin client roots with the same allowlist rule.
- No behaviour change in a secure context.

## Capabilities

### Modified Capabilities
- `lan-knock-pairing`: the "Dashboard works from a non-secure LAN origin" requirement widens from `packages/client` + `packages/client-utils` to plugin client bundles.

## Discipline Skills

- `review-code` — before commit.
- None of the other `eng-disciplines` checkpoints apply: no auth, secrets, latency budget, new endpoint, or irreversible step.

## Impact

- Plugin client sources; a shared helper location; the scan test's roots.
- Rollback: revert; browsers in a secure context are unaffected.
