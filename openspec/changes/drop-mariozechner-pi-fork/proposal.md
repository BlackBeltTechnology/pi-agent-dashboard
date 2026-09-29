## Why

> **Status: draft.** Proposal only. Specs, design and tasks still need a planning pass (`plan-proposal`); this change was split out of `update-pi-core-0-99-adopt-apis` during its doubt review because the fork is woven through ~17 capabilities.

The dashboard still recognises the legacy `@mariozechner/pi-coding-agent` fork everywhere it handles pi:
- peers and ambient type declarations;
- pi binary/runtime resolution;
- managed-install discovery, display names and updates;
- pi.dev version checks;
- changelog fetching;
- the Packages UI.

It is a second supported identity for one product. With the 0.99.1 floor, every consumer is on `@earendil-works`, so all fork handling is duplication.

## What Changes

- **BREAKING:** remove `@mariozechner/pi-coding-agent` / `pi-ai` / `pi-tui` recognition:
  - peers and `peerDependenciesMeta` (root + `packages/*`);
  - `packages/extension/src/pi-env.d.ts` ambient blocks;
  - extension: `model-tracker.ts` name lists;
  - server: `pi-core-checker.ts` (whitelist, display name, alias intake), `pi-version-skew.ts`, `changelog-parser.ts`, `bin/pi-dashboard.mjs`;
  - shared: `pi-installs/candidates.ts`, `platform/binary-lookup.ts` pi candidates, `server-launcher.ts` messages, `tool-registry/definitions.ts`, `browser-protocol.ts`;
  - electron: `update-checker.ts` and install scripts;
  - client: `usePackageOperations.ts` and the package classifier/queue.

  A machine whose only pi is the fork can no longer spawn sessions.
- **Keep** `@mariozechner/jiti` (`binary-lookup.ts` `JITI_PACKAGES`): a different package, mandated by `jiti-loader`, `server-launch` and `bridge-extension`.
- Fix the latent pi.dev bug: `PI_DEV_PACKAGE` is the fork name, so `@earendil-works/pi-coding-agent` (in `CORE_PACKAGE_NAMES`, never aliased) never takes the pi.dev path. Decide during planning between pointing pi.dev at the earendil package (latest-vs-npm-installable divergence must then be specified) and removing the pi.dev path.
- `POST /api/pi-core/update` rejects the fork.

## Capabilities

### Modified Capabilities (to be written in the planning pass)
`pi-core-version-check` (core package discovery, display name mapping, core package update execution, pi.dev version check, the lockstep scenario naming both forks), `pi-core-version-ui`, `packaging`, `package-management`, `package-install`, `tool-registry`, `server-launch`, `bridge-extension` (jiti error message naming both forks), `bootstrap-install`, `dependency-installer`, `electron-shell`, `pi-changelog-display`, `provider-auth-bridge`, `pi-image-fit`, `server-session-reader`, `dashboard-server`, `dependency-auto-update`, `electron-qa-coverage`. Enumerate with `rg -l mariozechner openspec/specs`, excluding `@mariozechner/jiti` references.

## Impact

- **Code:** listed above.
- **Tests:** `pi-core-checker`, `binary-lookup`, `spawn-runtime`, `node-spawn`, `no-direct-child-process`, `changelog-types`, `tool-registry-definitions`, `usePiChangelog`, `package-classifier`, `package-queue-pi-core`.
- **Verification:** `rg -n 'mariozechner/pi-' packages scripts --glob '!**/node_modules/**' --glob '!**/*.md' --glob '!scripts/ab-context/**'` returns nothing; the `@mariozechner/jiti` hits stay.
- **Depends on** `update-pi-core-0-99-adopt-apis`.
- **Risk:** fork-only users must install `@earendil-works/pi-coding-agent`; needs a **BREAKING** CHANGELOG entry.

## Discipline Skills

`doubt-driven-review` (irreversible for fork-only users) · `code-simplification` · `review-code`.
