## Why

Two of the recommended extensions are first-party BlackBelt repos that
the dashboard is built around:

1. **`pi-anthropic-messages`** is the only entry flagged `required` — without
   it, Claude-family tool calls silently fall back to a broken `bash_ide`
   sandbox path whenever a provider uses `api: "anthropic-messages"` (direct
   Anthropic OAuth/API key, 9Router `cc/claude-*`, pi-model-proxy, any Claude
   Code proxy).
2. **`pi-flows`** powers the dashboard's Flow view, role aliases, and the
   `/flows*` + `/roles` slash commands. Without it, visible UI features
   (Flow dashboard, `@planning`/`@coding` roles, subagent/flow tools) are
   unreachable — a confusing first-run experience.

Today, the Electron installer ships with Node + npm + the dashboard server,
but both extensions are only fetched from GitHub on first run via pi's
`DefaultPackageManager`. On slow/offline/locked-down networks this
produces a broken first-run: the wizard completes, the user picks an
Anthropic provider and opens the Flow view, and neither works.

Bundling these two (both small, first-party, no native deps) gives a
guaranteed working out-of-the-box state for the dashboard's headline
features. Third-party / heavy extensions (pi-subagents, pi-web-access,
pi-agent-browser) stay dynamic — they're licensed externally or pull
huge deps like Playwright.

## What Changes

- **New**: build-time bundling step that clones each bundled extension
  (`pi-anthropic-messages`, `pi-flows`) into
  `packages/electron/resources/bundled-extensions/<id>/` (source only — pi
  re-runs install on copy to avoid shipping native deps). The list of
  bundled ids is declared in a single manifest (`BUNDLED_EXTENSION_IDS`)
  derived from `RECOMMENDED_EXTENSIONS`.
- **New**: `installBundledExtensions()` in
  `packages/electron/src/lib/dependency-installer.ts` that, on first run,
  copies bundled extensions to `~/.pi/agent/packages/` and activates them
  via pi's `SettingsManager` by appending the declared source to
  `~/.pi/agent/settings.json` `packages[]`.
- **Modified**: `installStandalone()` auto-adds bundled extension ids to
  its `skipPackages` set so the normal install path does not redownload.
- **Modified**: first-run wizard shows a "bundled" badge for entries
  already pre-installed from `resources/`.
- **Modified**: CI pipeline (`.github/workflows/publish.yml`) runs the
  new bundling step before `bundle-server.sh`.
- **Non-goals**: third-party / heavy extensions (pi-subagents,
  pi-web-access, pi-agent-browser) are **not** bundled; no change to how
  updates work (pi's update path continues to refetch from git).

## Capabilities

### New Capabilities

- `bundled-recommended-extensions`: Build-time bundling and first-run
  activation of a curated, first-party subset of recommended pi
  extensions (`pi-anthropic-messages`, `pi-flows`) shipped inside the
  Electron app, copied to `~/.pi/agent/packages/` on first launch and
  activated via pi's `SettingsManager`. Designed to be extensible by
  adding ids to the bundle manifest — not to replace dynamic install
  for the general case.

### Modified Capabilities

- `dependency-installer`: gains `installBundledExtensions()` which runs
  before `installRecommendedExtensions()` and contributes ids to
  `skipPackages`.
- `first-run-wizard`: surfaces bundled status ("Bundled ✓") for entries
  that came from the installer rather than npm.
- `electron-build-pipeline`: CI must invoke the bundling script before
  `bundle-server.sh` and the bundled payload must land under
  `resources/bundled-extensions/` as declared in `extraResource`.

## Impact

- **Code**:
  - new `packages/electron/scripts/bundle-recommended-extensions.sh`
  - new `installBundledExtensions()` in `dependency-installer.ts`
  - new entry in `packages/electron/forge.config.ts` `extraResource`
  - new wizard UI state for "bundled"
- **Installer size**: +~5–12 MB per platform for the two extensions combined
  (source only, no compiled native deps). Exact size measured in CI and
  reported in the design doc.
- **Network**: first-run no longer requires GitHub reachability for the
  required path; all other recommended extensions still do.
- **Updates**: no change — pi's `DefaultPackageManager` continues to own
  update resolution. The bundled copy becomes inert after the first
  successful update.
- **Licensing**: both bundled extensions are first-party BlackBelt repos,
  so redistribution inside the installer is pre-cleared. Adding any
  third-party extension to the bundle in the future requires a license
  review — this proposal explicitly limits the bundle to first-party.
- **Rollback**: guarded by `BUNDLE_RECOMMENDED_EXTENSIONS=1` env in CI.
  Flipping it off reverts to today's pure-dynamic behavior without code
  changes.
- **Migration**: none — users who already have the extension installed
  will have their existing install detected by pi and the bundled copy
  silently skipped.
