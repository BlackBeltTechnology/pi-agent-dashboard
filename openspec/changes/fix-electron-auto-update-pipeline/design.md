## Context

The Electron app embeds `electron-updater` and runs a 60s + 24h check loop (`packages/electron/src/lib/app-updater.ts`, wired in `packages/electron/src/main.ts:377`). The runtime path is fully implemented: dialog flow for `update-available` and `update-downloaded`, `quitAndInstall()` plumbing, dev-mode skip via `process.env.ELECTRON_DEV` / missing `resourcesPath`. Yet no user has ever observed a prompt.

Investigation traced the failure to four pipeline gaps:

1. **No update metadata in releases.** `electron-updater` resolves updates by GETting `latest.yml` (Windows), `latest-mac.yml` / `latest-mac-arm64.yml` (macOS), `latest-linux.yml` (Linux) from the release. These YAML files carry `version`, `path`, `sha512`, `releaseDate`, `files[]`. They are emitted natively by `electron-builder` but NOT by `@electron-forge/maker-*`. Our pipeline (`.github/workflows/publish.yml`) uses Forge for DMG/DEB/NSIS and a hand-rolled `softprops/action-gh-release` upload — no metadata is generated or attached.

2. **Releases are drafts.** `release-cut` skill leaves the GitHub Release as a draft (`publish.yml:706` `draft: true`). The default `electron-updater` GitHub provider queries `/releases/latest` which excludes drafts and pre-releases.

3. **macOS unsigned.** Squirrel.Mac requires a Developer-ID-signed, notarised `.app` to apply an in-place update. Unsigned updates are silently rejected at the staging step. Our DMGs are unsigned (per `docs/research/electron-app.md` D12 placeholder for Windows; macOS signing was never wired despite being technically required for updates).

4. **Errors swallowed.** `app-updater.ts:48` `onError` is `() => {}`. Every 404, parse error, signature error, network error vanishes. The user sees no signal; we get no telemetry. This is the reason gap #1-3 went unnoticed for so long.

Current release artifacts on GitHub (per `forge.config.ts` makers): `*.dmg` (mac, both arches), `*.deb` (linux), `*.AppImage` (linux), `*.exe` NSIS (win), portable `.exe` (win), and source tarballs. None ship with `latest*.yml`.

Stakeholders: end users (silently stuck on old versions), maintainers (manual upgrade comms), security (CVEs cannot reach users). No external API consumers — auto-update is purely client-side.

## Goals / Non-Goals

**Goals:**
- A user running version `N` SHALL receive an in-app prompt within 24 h of version `N+1` being released, on macOS (signed) and Linux AppImage and Windows NSIS.
- Update failures SHALL be observable in `~/.pi/dashboard/electron.log` (or platform equivalent) — never silently swallowed.
- Users SHALL be able to trigger an update check on demand from the app menu without restarting.
- The publish pipeline SHALL be the single source of truth: one workflow run produces both binaries and the metadata `electron-updater` reads.
- macOS builds SHALL be Developer-ID-signed and notarised so Squirrel.Mac accepts updates.

**Non-Goals:**
- Differential / delta / block-map updates. We ship full-size updates; the `blockmap` files `electron-builder` produces are a free side-effect, not a goal.
- In-app release-notes UI. The native dialog stays text-only; release notes remain on GitHub.
- Windows Authenticode signing. NSIS auto-update works unsigned (UAC prompt is acceptable for now). D12 stands.
- Auto-update for the standalone npm `pi-dashboard` install. That path is `npm i -g` driven and out of scope.
- Self-update of pi/openspec/tsx in `~/.pi-dashboard/`. Owned by `PiCoreUpdater`, untouched.
- Channels (alpha/beta/stable). Single `latest` channel is enough; pre-release tags stay drafts.

## Decisions

### D1: Generate `latest*.yml` via `electron-builder publish=never`, not Forge

**Decision:** Replace the relevant Forge makers with `electron-builder` invocations producing artifacts AND `latest*.yml` metadata in the same step. Keep `electron-builder --publish never` so the workflow stays in control of the actual upload (we already have `softprops/action-gh-release` doing it).

**Why:** Forge has no built-in `latest*.yml` emitter. The closest path is `electron-forge publish` plugins, but our workflow already uploads via a custom action and parallel-builds across a 6-platform matrix. Switching the upload step is a bigger refactor than swapping makers. `electron-builder` is already a transitive dep (used today for the Windows portable build per `scripts/build-windows-zip.sh:192`), so adding it to mac/linux/NSIS is incremental.

**Alternatives considered:**
- *Forge publishers (`@electron-forge/publisher-github`)*: would cover upload but still doesn't emit `latest*.yml`. Forge would need a custom plugin. Rejected — same problem, larger refactor.
- *Hand-write `latest*.yml` from a Node script after Forge runs*: feasible (compute sha512, write YAML) but duplicates `electron-builder` logic and risks divergence in the YAML schema as `electron-updater` evolves. Rejected.
- *Switch fully off Forge*: too large; Forge config and makers are fine for everything except metadata.

**Consequence:** `forge.config.ts` shrinks for mac/linux; an `electron-builder.yml` (or inline config) is added. The matrix step calls `electron-builder` instead of `electron-forge make` for those targets. Windows NSIS likewise via electron-builder.

### D2: Publish provider = GitHub, owner/repo hardcoded, default channel only

**Decision:** Configure `publish: { provider: 'github', owner: 'blackbelt-technology', repo: 'pi-agent-dashboard' }` in the electron-builder config. `electron-updater` reads the same config from `app-update.yml` (auto-generated by electron-builder into the packaged app).

**Why:** Single source of truth. The app and the build both point at the same release stream. No env-var indirection at runtime.

**Alternative considered:** `provider: generic` pointing at a custom CDN. Rejected — adds infra; GitHub Releases is already the distribution channel.

### D3: Production tags publish (not draft); pre-release tags stay drafts

**Decision:** `.github/workflows/publish.yml` SHALL detect tag shape (`v\d+\.\d+\.\d+` → published; `v\d+\.\d+\.\d+-(alpha|beta|rc)` → draft). The `softprops/action-gh-release` step's `draft:` input becomes a workflow expression instead of the literal `true`.

**Why:** Drafts are intentional for staging real cuts (lets a maintainer eyeball artifacts, edit notes, then publish manually). For production tags this gates `electron-updater` indefinitely. Pre-release tags drafting preserves the staging affordance for risky cuts; pre-releases are also invisible to `electron-updater`'s default "latest" query, so they harmlessly stay hidden.

**Alternative considered:** Always publish; rely on `prerelease: true` for non-prod tags. Acceptable, but loses the "let me eyeball before users see it" affordance the team uses today. Rejected.

**Migration note:** `release-cut` skill needs an update — production cuts will stop creating a draft to edit.

### D4: macOS Developer-ID + notarytool notarisation in CI

**Decision:** CI signs and notarises macOS DMGs via electron-builder's built-in flow:
- Secrets: `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- electron-builder reads these env vars natively and runs `notarytool` post-sign.

**Why:** Squirrel.Mac (the macOS arm of `electron-updater`) verifies the new `.app`'s code signature against the running app's signature before applying. Unsigned → reject.

**Alternative considered:** Ad-hoc signing. Rejected — Squirrel.Mac requires a Developer-ID, not ad-hoc.

**Cost:** Apple Developer Program membership ($99/yr). One-time secret setup.

### D5: Surface `onError` to log file with severity tiers

**Decision:** `onError` SHALL write to the same Electron log file used by `console`/main-process logs (resolve via `app.getPath('logs')` → `electron-main.log`). Errors classified into:
- `update-not-available` ⇒ debug (very chatty, do not pollute info log)
- network errors ⇒ warn
- signature/parse errors ⇒ error (these indicate publish-pipeline regressions, the most valuable signal we missed)

Add a `Help → View update log` menu item revealing the file in OS file manager.

**Why:** We need a way to detect future regressions without re-investigating from scratch. Logging is the cheapest signal.

**Alternative considered:** Telemetry to a server. Rejected — no telemetry infra, privacy cost outweighs value at our scale.

### D6: Manual "Check for updates…" menu item

**Decision:** Add a menu item under the app's main menu (`packages/electron/src/lib/app-menu.ts`) that calls `autoUpdater.checkForUpdates()`. On result, show one of three native dialogs: "You're up to date (vX.Y.Z)", "Update available (vN→vM) — Download?", "Update check failed: <message>".

**Why:** Users currently wait up to 24 h for the next scheduled check. Manual trigger costs ~30 lines and is a strong UX win — particularly after the first release that ships the fix, when users want to confirm the updater works.

**Alternative considered:** A settings-panel UI inside the dashboard web client. Rejected — adds cross-process IPC, dashboard-server-vs-Electron coupling, and dashboards rendered in browsers (not Electron) shouldn't see the entry. Native menu is the right shell affordance.

### D7: Keep `autoDownload = false`; make the user-facing dialog gate the download

**Decision:** Preserve current `autoDownload = false`. The `update-available` dialog's "Download & Restart" button SHALL call `autoUpdater.downloadUpdate()` first, then on `update-downloaded` show the second dialog and call `quitAndInstall()`.

**Why:** Today's `main.ts:387` calls `quitAndInstall()` straight from `update-available`, which is a bug — the binary isn't downloaded yet. With `autoInstallOnAppQuit = true` it accidentally works on the user's NEXT quit, but the dialog wording promises "Restart" right now. Fix the call order so the wording matches behaviour.

**Alternative considered:** Set `autoDownload = true` and only show one dialog (after download). Rejected — bandwidth-respect: users on cellular/metered should consent before a ~150MB download.

## Risks / Trade-offs

- **Risk: Apple ID 2FA expires / notarisation password rotated** → notarisation step fails silently in CI, no DMG ships, and only macOS users notice (eventually). **Mitigation:** treat notarisation failure as a workflow failure (non-zero exit), gate the release on it, document refresh procedure in `docs/release.md`.

- **Risk: `latest*.yml` and binary sha512 drift** if metadata is regenerated post-upload. **Mitigation:** `electron-builder` writes both atomically per platform. Workflow uploads them in the same `softprops/action-gh-release` step (multi-file glob), no second-stage edits.

- **Risk: User on old `app-updater.ts` (the "swallow errors" version) misses the first fixed release**, and so never receives this fix or any future fix. **Mitigation:** users installed from a release prior to the fix WILL receive the new metadata via the still-running update check (the channel works one-way; even broken-error-handling clients can still resolve `latest.yml`). The check itself isn't broken — only error logging and the `quitAndInstall` ordering are. So users on old versions DO receive the first metadata-bearing release; they will see the bugged dialog flow once, then be on the fixed version. Acceptable.

- **Risk: Downgrading binary size due to signing/notarisation pushing per-release size up.** **Mitigation:** none needed — signed DMGs are within ~5% of unsigned size; immaterial.

- **Risk: Pre-release tag matcher false-negatives a production tag** (e.g. `v1.2.3-hotfix` mistakenly drafted). **Mitigation:** tag matcher is `^v\d+\.\d+\.\d+$` (anchored, exact). Anything else → draft. Document the convention in `release-cut` skill.

- **Risk: Forge → electron-builder partial migration creates drift between the two configs (e.g. icon paths, file globs).** **Mitigation:** electron-builder config inherits from one shared resources dir; both tools point at the same `packages/electron/resources/icon.{icns,ico,png}`. Add a `__tests__/build-config-parity.test.ts` lint asserting both configs declare the same `appId` / executable name / version source.

- **Trade-off: 6-platform matrix gets a few minutes longer** because notarisation is a synchronous wait on Apple's servers (5-15 min typical). **Acceptable** — releases are infrequent and gating on notarisation is mandatory anyway.

## Migration Plan

1. **Land in stages**: D5 (error logging) + D6 (manual check) + D7 (dialog ordering) ship first as a no-pipeline-change PR — they're pure runtime fixes and validate against any future metadata-bearing release.
2. **Pipeline changes**: D1 + D2 + D3 land in a second PR. The first release after this PR ships `latest*.yml` for the first time. Test by manually downloading a previous version and observing the prompt.
3. **macOS signing (D4)**: lands in a third PR (or concurrent if secrets are already in place). Until D4 lands, mac users get no auto-update; Linux + Windows do.
4. **Rollback**: each PR is independent. If D1 breaks builds, revert it; D5/D6/D7 stay landed (improvements regardless). If D3 misclassifies tags, restore `draft: true` and re-cut.

## Open Questions

- Do we want to ship `pi-dashboard` (server) and Electron app on the same version line, or decouple? Currently they're locked. Auto-update of the Electron app upgrades the bundled server in lockstep — assumed correct, but if we later split, this design assumes the lockstep continues. Out of scope for this change but worth flagging.
- Should the manual "Check for updates…" item be hidden in dev mode (when `ELECTRON_DEV` is set)? **Tentative**: yes, to match the existing dev-mode no-op of the auto-updater. Confirm during implementation.
- macOS arm64 vs x64 update routing: `electron-updater` reads `latest-mac.yml` for both today (single file lists both files via `files[]`). Confirm electron-builder produces this single-file form, not split `latest-mac-arm64.yml`. **Tentative**: single-file is the default; verify in tasks.
