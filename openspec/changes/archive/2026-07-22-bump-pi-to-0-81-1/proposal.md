## Why

pi (`@earendil-works/pi-coding-agent`) released 0.81.1 (0.81.0 + 0.81.1). The dashboard's runtime dependency, Docker global install, and release-deps floor were pinned at 0.80.10. Bumping keeps the bridge on the current pi runtime and picks up the 0.81.1 fix that restores the default stream fallback for extensions using the pre-0.81 agent-core API (the bridge's compatibility path).

## What Changes

- Bump the pinned pi runtime `0.80.10 → 0.81.1` across the three source-of-truth pins that must move together:
  - `packages/server/package.json` dependency `@earendil-works/pi-coding-agent` `^0.80.10 → ^0.81.1` (the real runtime pin).
  - `docker/Dockerfile` global `npm install -g @earendil-works/pi-coding-agent@0.80.10 → @0.81.1`.
  - `scripts/verify-release-deps.mjs` pi rule `minVersion "0.80.10" → "0.81.1"` (+ refreshed evidence note).
- `piCompatibility.recommended` `0.78.0 → 0.81.1` to track the current upstream line (the `pi-core-version-check` spec requires `recommended` be no more than one minor behind the latest published pi). `piCompatibility.minimum` **stays `0.78.0`** — the hard support floor is deliberately broad; older-pi users (`0.78.x`–`0.80.x`) get a soft `upgradeRecommended` hint, not a blocking error. Bundled-extension peer-deps (`>=0.75.0`) and the Electron bundled-Node floor are untouched (they track `minimum`).
- Re-resolve `pnpm-lock.yaml`; record `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` so pnpm's release-age gate installs the fresh 0.81.x pi packages.
- Docs: update the `@earendil-works/pi-coding-agent@…` pin in `docker/AGENTS.md`; add a `## [Unreleased]` CHANGELOG entry.
- No bridge code changes: the 0.81.0 Qwen Token Plan providers auto-surface through the derived provider catalogue (`provider-register.ts::_buildProviderCatalogue`), and the 0.80.10→0.81.1 range carries **no** `Breaking Changes` entries.

## Capabilities

### New Capabilities

None — routine dependency bump.

- `pi-core-version-check`: the `piCompatibility block tracks current upstream pi-coding-agent` requirement — `recommended` now tracks the pinned runtime (`0.81.1`) while `minimum` stays at the broad floor (`0.78.0`). The runtime dependency pin and `verify-release-deps` floor themselves track the installed version (an implementation detail), not a behavioral requirement.

## Impact

- **Dependencies**: `@earendil-works/pi-coding-agent` `0.80.10 → 0.81.1` (server runtime pin + Docker global install + release-deps floor); `pnpm-lock.yaml` re-resolved; `pnpm-workspace.yaml` release-age exclusions.
- **Runtime**: bridge extension (`packages/extension/`) runs against pi 0.81.1; verified via clean headless activate (no pi-ai symbol break). New Qwen providers surface with no code change.
- **CI/release**: `verify-release-deps.mjs` floor moves in lockstep with the dependency pin (both must match or the gate fails).
- **Compatibility**: `piCompatibility.recommended` → `0.81.1` (soft upgrade hint); `minimum` stays `0.78.0`.
- **Not impacted**: `piCompatibility.minimum` hard floor, bundled-extension peer-deps (`>=0.75.0`), Electron bundled-Node floor (pi `engines.node` unchanged at `>=22.19.0`).

## Discipline Skills

- `review-code`: non-trivial multi-file pin change verified green before commit (full suite + `verify-release-deps` + key pi suites + real-spawn smoke).
