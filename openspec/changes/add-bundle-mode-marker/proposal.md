# Stamp the bundle with its install mode + surface honest error on missing deps

## Why

The companion change `fix-ci-electron-runnable-bundles` flips `source_only_bundle` to `false` for CI dispatches and adds a CI-side assertion that the runnable-bundle invariant holds. That assertion lives inside the workflow, which means:

1. A future PR can accidentally remove the assertion (a single deleted YAML step) and silently re-ship source-only artefacts as if they were runnable installers.
2. A locally-run `bundle-server.mjs --source-only` followed by a manual `forge package` produces the same broken artefact, completely outside CI's reach.
3. The runtime-side error message (`BundledServerMissingError: Bundled dashboard server not found at "…\cli.ts". The installation may be corrupted; reinstall the application.`) is misleading whenever the cause is a source-only build rather than corruption. Users have no path forward.

We want **defence in depth**: a build-time stamp embedded in the bundle that records its install mode, plus runtime logic that reads the stamp and produces a precise, actionable error when the bundle is missing dependencies by design.

## What Changes

- **Build-time stamp**: `bundle-server.mjs` SHALL write `resources/server/.bundle-mode.json` at the end of its run, containing `{ mode: "full" | "source-only", bundledAt: <ISO-8601>, npmInstallSucceeded: <bool>, bundleScriptCommit: <git sha if available, else null> }`. Always written, regardless of mode.
- **Runtime read path**: `getBundledCliPath()` callers (specifically `probeBundled()` in `packages/electron/src/lib/launch-source.ts`) SHALL read `.bundle-mode.json` when `cli.ts` is absent. If mode is `"source-only"`, throw a new typed error `SourceOnlyBundleError` instead of `BundledServerMissingError`.
- **New typed error**: `SourceOnlyBundleError` carries `{ bundledAt, mode }` and the message text:
  > *"This Electron build was packaged with `--source-only` (CI dev artefact, packaged at <ISO>). It does not include the npm dependencies needed to launch the dashboard. Download a release from <repo-releases-URL>, or trigger a runnable CI build via the `ci-electron` workflow with `source_only_bundle: false`."*
- **Dialog updates**: `packages/electron/src/main.ts` catches `SourceOnlyBundleError` separately from `BundledServerMissingError` and shows a distinct dialog titled "PI Dashboard — Source-Only Build" with the message above and an "Open Releases Page" button that calls `shell.openExternal` to the GitHub releases URL.
- **Tests**: unit tests for the new error path in `packages/electron/src/lib/__tests__/launch-source.test.ts` cover three cases: stamp present + mode=source-only → `SourceOnlyBundleError`; stamp present + mode=full + cli.ts missing → `BundledServerMissingError` (existing path); stamp absent + cli.ts missing → `BundledServerMissingError` (legacy bundles, conservative fallback).
- **No coupling on CI**: this change does not depend on `fix-ci-electron-runnable-bundles` landing first. The stamp is benign — for full-mode bundles it just provides forensic telemetry; for source-only it provides the friendly error. Either change is independently shippable, but landing them together is the cleanest user-visible story.

## Capabilities

### Modified Capabilities

- `electron-build-pipeline`: adds the `.bundle-mode.json` stamp Requirement.
- `electron-launch-source`: adds the `SourceOnlyBundleError` Requirement and modifies the `BundledServerMissingError` Requirement to differentiate the two failure modes.

## Impact

- **No behavioural change for runnable bundles**: full-mode releases and CI runnable dispatches both ship a `.bundle-mode.json` with `mode: "full"`; the stamp is read only on the failure path. Happy-path latency unchanged.
- **Source-only artefacts**: now produce a clear, actionable dialog instead of a "may be corrupted" red herring. Lift to next phase.
- **Forensic value**: the stamp also helps future bug reports — a user can include the contents of `.bundle-mode.json` to disambiguate "I downloaded the wrong artefact" from "the artefact is corrupted" from "the bundle was tampered with".
- **Code impact**: ~80 LOC added across `bundle-server.mjs` (write stamp), `launch-source.ts` (read stamp + new error), `main.ts` (catch + dialog), unit tests. No new runtime dependencies.
- **Backwards compatibility**: bundles produced before this change have no `.bundle-mode.json`. The runtime treats a missing stamp + missing cli.ts as `BundledServerMissingError` (the current behaviour) so no regression.
- **Out of scope**: extending the stamp to record git SHA of the source tree, embedding signatures, expiration, or any anti-tamper mechanism. The stamp is a hint to the user, not a security boundary.
