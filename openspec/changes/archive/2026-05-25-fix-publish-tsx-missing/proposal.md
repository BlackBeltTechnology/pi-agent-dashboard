## Why

The `Bundle first-party recommended extensions` step in `.github/workflows/publish.yml` invokes:

```
node --import tsx/esm packages/electron/scripts/bundle-recommended-extensions.mjs
```

`tsx` is not declared in **any** `package.json` (root or workspace). On CI, `npm ci` therefore never installs it, and the bundle step fails with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from /…/pi-agent-dashboard/
```

This breaks the Electron build matrix (all 6 platform/arch combos) and gates the entire release pipeline.

`packages/electron/package.json` also has a `start:dev` script that uses `NODE_OPTIONS='--import tsx'`, so the missing-dep is a latent bug elsewhere too — anyone running `npm run start:dev` from a clean clone hits the same error.

## What Changes

- Add `tsx` as a **root** `devDependency` (pinned to a specific minor) so a single `npm ci` at the workspace root resolves it for every script that needs it.
- Regenerate `package-lock.json` to record the new dep (already handled by the existing `npm install --package-lock-only` step in the workflow's `prepare` job — no workflow changes needed).
- No production runtime impact — `tsx` is build-time/dev-only.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

_(none — this is a build/CI dependency hygiene fix; no behavior, API, or user-visible capability changes)_

## Impact

- **Code**: `package.json` (root) — one new line under `devDependencies`.
- **Lockfile**: `package-lock.json` — regenerated.
- **CI**: `.github/workflows/publish.yml` — no changes; the existing `npm ci` step now picks up `tsx`.
- **Migration / rollback**: trivial. Revert the two-file diff.
- **Risk**: minimal. `tsx` is widely used; pinning by minor avoids surprise breaking changes. No production bundle includes it.
- **Verification**: after merge, the failing `Bundle first-party recommended extensions` step succeeds on all 6 matrix entries; locally `npm run start:dev` from a clean clone works.
