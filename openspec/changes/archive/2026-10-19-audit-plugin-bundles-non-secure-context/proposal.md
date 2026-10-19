## Why

`add-lan-knock-pairing` makes a plain-http LAN origin a first-class way to use the dashboard, so the SPA now runs in a non-secure browser context. That change audited and fixed `packages/client` and `packages/client-utils` (secure-context-only `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`) behind `randomUuid()` / `lib/util/clipboard.ts`, with a source-scan test. The plugin client bundles (for example `gmail-plugin`, `kb-plugin`) were explicitly out of scope and may still call those APIs bare.

## What Changes

- Audit every plugin client bundle (manifest-derived client roots: each plugin manifest's client-entry directory plus every `packages/*/src/client`; see design D3) for the secure-context-only APIs (`crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `navigator.mediaDevices`) and route each hit through a shared helper (hoist `randomUuid()` / `copyText()` into a package plugins may import without a client → plugin dependency cycle) or capability-check it.
- Extend the source-scan test (`secure-context-scan.test.ts`) to cover the plugin client roots with the same allowlist rule.
- Add a fourth secure-context-only API to the guard: `navigator.mediaDevices` (camera / microphone / screen capture). No scanned root uses it today; the planned `add-voice-assistant-dashboard-plugin` client will, so it must ship capability-checked.
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
