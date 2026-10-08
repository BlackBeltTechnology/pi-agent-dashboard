## Why

> Split out of `update-pi-core-1-0-adopt-apis` during its doubt review because the fork is woven through ~17 capabilities.

The dashboard still recognises the legacy `@mariozechner/pi-coding-agent` fork everywhere it handles pi:
- peers and ambient type declarations;
- pi binary/runtime resolution;
- managed-install discovery, display names and updates;
- pi.dev version checks;
- changelog fetching;
- the Packages UI.

It is a second supported identity for one product. With the 1.0.0 floor, every consumer is on `@earendil-works`, so all fork handling is duplication.

## What Changes

- **BREAKING:** remove `@mariozechner/pi-coding-agent` / `pi-ai` / `pi-tui` recognition:
  - peers and `peerDependenciesMeta` (root + `packages/*`);
  - `tsconfig.base.json` `paths` entries and `packages/extension/src/pi-env.d.ts` ambient blocks;
  - extension: `model-tracker.ts` name lists;
  - server: `pi-core-checker.ts` (whitelist, display name, alias intake), `pi-version-skew.ts`, `changelog-parser.ts` (comment);
  - shared: `pi-installs/candidates.ts`, `platform/binary-lookup.ts` pi candidates, `server-launcher.ts` messages, `tool-registry/definitions.ts`, `browser-protocol.ts`;
  - electron: `update-checker.ts` and the comments in the install-test scripts; `qa/tests/07-electron-bootstrap-v2.ps1`;
  - client: `UnifiedPackagesSection.tsx` (`PI_CORE_PKG_LEGACY`), the `usePackageOperations.ts` comment, and test fixtures.

  The fork disappears from discovery, the Packages UI, version and update checks, and module resolution. A fork `pi` binary on PATH can still be found by the generic `which("pi")` step and spawned. It is no longer recognised as a pi package. Manifest-name tests become scope-agnostic (`isPiCodingAgentName`: nearest `*/pi-coding-agent` manifest, also used for the spawn `engines.node` floor), so the session still reports its real version and the dependency change's advisory below-floor flag fires (the fork never reached 1.0).
- **Keep** `@mariozechner/jiti` (`JITI_PACKAGES` in `shared/platform/binary-lookup.ts` and `packages/server/bin/pi-dashboard.mjs`): a different package, mandated by `jiti-loader`, `server-launch` and `bridge-extension`.
- **Remove the pi.dev latest-version path** and pi.dev alias intake (owner decision). `PI_DEV_PACKAGE` was the fork name; `@earendil-works/pi-coding-agent` reached pi.dev only through an alias learned from a fork lookup. The npm registry becomes the only latest-version source, so the effective source for earendil-only machines is unchanged.
- `POST /api/pi-core/update` rejects the fork (400 unknown package).
- No fork-detection or identity-check code (owner decision). Install hints and loader errors name only `@earendil-works/pi-coding-agent`. When the fork is the only pi, module resolution fails with the generic "pi-coding-agent is not installed" error.

## Capabilities

### Modified Capabilities
`pi-core-version-check` (discovery, update execution, display names; pi.dev version check REMOVED; lockstep requirement from the dependency change), `pi-core-version-ui`, `packaging`, `package-management`, `package-install`, `tool-registry`, `server-launch`, `bridge-extension`, `pi-changelog-display`, `provider-auth-bridge`, `pi-image-fit`, `server-session-reader`, `dependency-auto-update`, `dashboard-server` (one REMOVED requirement). `pi-core-version-check` also re-adds the dependency's lockstep requirement without the fork scenario and adds a "running legacy fork is flagged" scenario to its below-floor requirement.

Not touched:
- `command-routing`: the dependency already removes the old-pi gate.
- `electron-qa-coverage` / `jiti-loader`: `@mariozechner/jiti` only.
- **Stale specs (follow-up drift, not this change):** these requirements name the fork but describe code that `eliminate-electron-runtime-install` already deleted (`bootstrapInstall`, `installStandalone`, `dependency-installer.ts`, power-user install, the offline cache, `offline-packages.json`, `resolveJitiFromPi`). That covers `bootstrap-install`, `dependency-installer`, `dashboard-server` "Bootstrap install lists exclude tsx", `electron-shell` (tsx launch, power-user install, and the `shouldUrlWrapEntry` contract, whose 0.70.x pin and `offline-packages.json` test are superseded although the function is live) and `electron-build-pipeline` ("excludes pi-coding-agent", superseded now that pi is bundled). Re-asserting obsolete contracts with a renamed package would be wrong; they need a dedicated stale-spec cleanup change.
- `dashboard-server` "Resolver supports upstream jiti package name" is the exception: it contradicts the new loader error, so it is REMOVED here.

## Impact

- **Code:** listed above.
- **Tests:** every file the verification gate flags. Known: `pi-core-checker`, `pi-dev-version-check` (deleted), `pi-changelog-routes`, `pi-core-updater-managed-path`, `pi-version-skew`, `package-manager-wrapper-resolve`, `binary-lookup-resolveJiti`, `spawn-runtime`, `no-direct-child-process`, `changelog-types`, `tool-registry-definitions`, `pi-ai-registration`, `pi-version-tracker`, `usePiChangelog`, `usePackageOperations-pi-core`, `package-classifier`, `package-queue-pi-core`, `UnifiedPackagesSection*`, `PackageRow*`, `WhatsNewDialog`, `dependency-declarations`.
- **Verification (canonical gate):** `rg -nP 'mariozechner(?![\\/]jiti)' packages scripts qa tsconfig.base.json package.json --glob '!**/node_modules/**' --glob '!**/out/**' --glob '!**/dist/**' --glob '!**/*.md' --glob '!scripts/ab-context/**'`. It matches per token and also catches bare `mariozechner` mentions and split path fixtures such as `"@mariozechner", "pi-coding-agent"`; `@mariozechner/jiti` and `@mariozechner\jiti` are excluded. Allowed remaining hits: the historical baseline comment in `shared/platform/node-spawn.ts`, negative assertions (`not.toContain("@mariozechner")`), and the forbidden-name assertions that task 2.1 adds to `scripts/__tests__/dependency-declarations.test.mjs` / `scripts/verify-release-deps.mjs`. The existing allowance loop at `dependency-declarations.test.mjs:180` drops the fork.
- **Depends on** `update-pi-core-1-0-adopt-apis`.
- **Risk:** fork users lose package-manager integration, version/update checks and the Packages UI entry, and get only the advisory below-floor flag. They must install `@earendil-works/pi-coding-agent`. Needs a **BREAKING** CHANGELOG entry.

## Discipline Skills

`doubt-driven-review` (irreversible for fork-only users) · `code-simplification` · `review-code`.
