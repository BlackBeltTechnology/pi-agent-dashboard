# Tasks

## 1. Build-time stamp

- [ ] 1.1 In `packages/electron/scripts/bundle-server.mjs`, after the synthetic `package.json` is written but before the source-only short-circuit, define `bundleStartedAt = new Date().toISOString()`.
- [ ] 1.2 Add helper `writeBundleModeStamp({ mode, npmInstallSucceeded })` that writes `<SERVER_BUNDLE>/.bundle-mode.json` containing `{ mode, bundledAt: bundleStartedAt, npmInstallSucceeded, bundleScriptCommit: <best-effort git sha or null> }`. `git rev-parse HEAD` via `spawnSync`; on failure, emit `null` and continue.
- [ ] 1.3 Call `writeBundleModeStamp({ mode: "source-only", npmInstallSucceeded: false })` immediately before the `process.exit(0)` in the `SOURCE_ONLY` branch.
- [ ] 1.4 Call `writeBundleModeStamp({ mode: "full", npmInstallSucceeded: <result of npmInstall.status === 0> })` at the very end of the full-mode path, after all materialisation steps complete.
- [ ] 1.5 Unit test the helper: given a tmp dir as `SERVER_BUNDLE`, call helper, parse the written JSON, assert all four fields are present and well-typed.

## 2. Shared types

- [ ] 2.1 Add `BundleMode` type alias and `BundleModeStamp` interface to `packages/shared/src/launch-source-types.ts` (the same module that exports `LaunchSource` / `SourceKind`). Keep the shape minimal — `{ mode: "full" | "source-only"; bundledAt: string; npmInstallSucceeded: boolean; bundleScriptCommit: string | null }`.
- [ ] 2.2 Add a pure helper `readBundleModeStamp(serverDir: string): BundleModeStamp | null` in `packages/shared/src/bundle-mode-stamp.ts` that does `fs.readFileSync` + `JSON.parse` inside a try-catch, returning `null` on any failure (missing file, malformed JSON, wrong shape). The helper SHALL validate the parsed shape against a tiny shape-guard to refuse stamps from a future schema.
- [ ] 2.3 Unit test the helper: covers happy path, missing file, malformed JSON, unknown `mode` value, missing required field — all four failure modes return `null` without throwing.

## 3. New typed error

- [ ] 3.1 In `packages/electron/src/lib/launch-source.ts`, add `export class SourceOnlyBundleError extends Error` alongside `BundledServerMissingError`. Constructor accepts `{ bundledAt: string; releasesUrl: string }` and composes the message verbatim per the proposal.
- [ ] 3.2 Export `SOURCE_ONLY_RELEASES_URL` constant from the same module (default `"https://github.com/blackbelt-technology/pi-agent-dashboard/releases"`; centralised so tests can override).

## 4. Runtime gating in `probeBundled` + `selectLaunchSource`

- [ ] 4.1 In `selectLaunchSource()`, when both `devMonorepo` and `bundled` probes return null and we are about to throw `BundledServerMissingError`, first call `readBundleModeStamp(<resourcesPath>/server)`.
- [ ] 4.2 If the stamp is non-null and `mode === "source-only"`, throw `SourceOnlyBundleError({ bundledAt: stamp.bundledAt, releasesUrl: SOURCE_ONLY_RELEASES_URL })` instead of `BundledServerMissingError`.
- [ ] 4.3 Otherwise (stamp missing, mode === "full", or stamp malformed), throw `BundledServerMissingError(getBundledCliPath(...))` as today.
- [ ] 4.4 Do NOT read the stamp inside `probeBundled()` itself — keep the probe pure (existsSync only). Stamp interpretation lives in the orchestrator. Reason: probe is reused in unit tests with synthetic filesystems; loading semantic interpretation into it would force tests to also stub stamp behaviour.

## 5. Dialog wiring in `main.ts`

- [ ] 5.1 In `packages/electron/src/main.ts`, locate the existing `if (err instanceof BundledServerMissingError)` arm and add a sibling `else if (err instanceof SourceOnlyBundleError)` arm above it (more specific first).
- [ ] 5.2 The new arm calls `dialog.showMessageBox` with: title `"PI Dashboard — Source-Only Build"`, message from `err.message`, buttons `["Open Releases Page", "OK"]`, `defaultId: 0`. On `response === 0`, call `shell.openExternal(SOURCE_ONLY_RELEASES_URL)`.
- [ ] 5.3 After the dialog dismisses, `app.quit()` — the bundle cannot launch.

## 6. Tests

- [ ] 6.1 Add `launch-source-source-only-error.test.ts` in `packages/electron/src/lib/__tests__/`. Use the injectable probe layer to stub `existsSync` (cli.ts absent) and `readBundleModeStamp` (three cases per § 1.5 of the proposal). Assert the correct error class is thrown each time.
- [ ] 6.2 Update existing `launch-source.test.ts`: any test that previously asserted `BundledServerMissingError` on a bundled-mode missing-cli.ts path SHALL be reviewed. If it implicitly relied on no stamp file → still passes. If it explicitly created a `mode: "source-only"` stamp → switch the assertion to `SourceOnlyBundleError`.
- [ ] 6.3 Add a `bundle-mode-stamp.test.ts` in `packages/shared/src/__tests__/` covering the shape guard cases listed in § 2.3.
- [ ] 6.4 Integration test (optional, gated on existing harness availability): run `bundle-server.mjs --source-only` against a tmp dir, assert `.bundle-mode.json` is present with `mode: "source-only"`. Skip if the test would add a hard `npm install` to test setup — covered by 1.5 + 2.3 already.

## 7. Documentation

- [ ] 7.1 Delegate `docs/file-index-electron.md` update to a general-purpose subagent (per AGENTS.md Documentation Update Protocol): add row for `packages/shared/src/bundle-mode-stamp.ts` (pure helper).
- [ ] 7.2 Same subagent updates `docs/file-index-electron.md` row for `launch-source.ts` to mention the `SourceOnlyBundleError` path.
- [ ] 7.3 No `docs/architecture.md` changes — the architecture is unchanged; this is a defence-in-depth refinement.

## 8. Validation

- [ ] 8.1 Run the full test suite. All passes including the new tests.
- [ ] 8.2 Manually exercise the source-only path: run `node packages/electron/scripts/bundle-server.mjs --source-only` locally, then `npm run electron:make`, then launch the .app/.exe. The new dialog SHALL appear. Click "Open Releases Page" — verify the browser opens to the releases URL.
- [ ] 8.3 Manually exercise the full path: cut a normal release (or trigger a `ci-electron` dispatch with `source_only_bundle: false` once `fix-ci-electron-runnable-bundles` lands). Verify the dashboard launches normally — the stamp is silently present at `resources/server/.bundle-mode.json` with `mode: "full"`.
