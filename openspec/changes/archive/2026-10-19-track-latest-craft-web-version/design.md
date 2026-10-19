## Context

`provisionWeb` resolves `<APP>_WEB_DIR` → `<APP>_WEB_VERSION` → registry `webVersion` and never uses latest (see change: edit-office-in-pane-with-craft-web, D2). The CLI path (`provision`) already tracks latest, with a 24 h `latest.json` cache and a fallback to the newest installed version.

## Decisions

### D1 Channel selection
- `ProvisionWebOptions.channel?: "pinned" | "latest"`, default `pinned`.
- Env `<APP>_WEB_VERSION=latest` (trimmed, case-insensitive) → latest. Any other value → explicit pin, as before.
- Precedence: `<APP>_WEB_DIR` > explicit `<APP>_WEB_VERSION` > latest (env or `channel`) > registry `webVersion`.
- `CRAFT_SOURCE=launcher` without `WEB_DIR` still fails closed before any network.
- Plugin: `apps.<app>.version: "pinned" | "latest"`, read live, passed as `channel`.

### D2 Latest resolution
- Cache: `<web root>/<app>-web/latest.json` `{tag, checkedAt}`; TTL 24 h; reuses `readLatestCache`. Separate from the CLI cache.
- Lookup: `GET /repos/<repo>/releases/latest`. Accepted only when the release has the asset `<app>-web-<ver>.zip`; only then is it cached.
- On a hit the fetched release object is reused for the install (no second `releases/tags` call).
- Fallback (lookup error or no web asset):
  1. newest installed tree `<ver>-s<shimVersion>` (semver-sorted, valid `index.html`) → `fallback-installed`;
  2. registry `webVersion` → `registry`;
  3. none → `ProvisionWebError` (`offline` for a network failure, else `not-verified`).
- `latestWebVersion(app, {root, ...deps})` returns the cached or fetched version, or `undefined`. Metadata only.

### D3 Plugin status in latest mode
- `status()` stays synchronous. In latest mode it fires `latestWebVersion` in the background (single-flight per app, 24 h cache bounds the GitHub calls). That is a metadata GET, never a build download, so the "a static request never provisions" rule still holds.
- Known latest (sync cache read) ≠ prepared version and no recorded prepare failure → `not-prepared` with `version` = latest. The existing Download gate becomes the update action.
- Prepared build valid + prepare failure recorded → `ok` (the old build stays usable). A failure without a prepared build stays blocking, as today.
- Status row adds `channel`; `installedVersion` = prepared build version (any status); `latestVersion` = known latest (latest channel only).

### D4 Settings section
- Claim `settings-section` `CraftWebSettings` (`module: ./src/client/CraftWebSettings.tsx`, lazy). Kit only; no own card/header.
- One `SettingsGroup` per claimed app (`CRAFT_WEB_APPS` ∩ status apps): `ToggleField` enable, `SelectField` version (`pinned` "Verified (recommended)" / `latest` "Latest release").
- Dirty compares effective values (absent key ≡ default enabled / pinned).
- Draft → host Save Bar (`useSettingsDraftSource({id:"plugin:craft-web"})`); commit sends the full config (unknown keys round-trip) via `plugin_config_write`.
- Status block: `SettingsStatusPill` (Installed / Update available / Not downloaded / Disabled / Restart required / failure reason) + installed / latest versions.
- Action button: shown when status is preparable; label "Update to <v>" when a build is installed, else "Download"; immediate `prepareCraftApp`; disabled while the draft is dirty (prepare uses the SAVED channel) or running; status refetched after.
- Status fetched once per mount and after prepare / save (`plugin_config_update` changes config → refetch).

### D5 Trust
Latest builds are not shim-verified. `postInstall` throws on an unexpected bootstrap shape → `extract-failed`; `current` is not moved. SHA256SUMS, the zip guard, `assertTreeSafe`, the sandbox and the CSP are unchanged.

## Risks / Trade-offs
- A new release may break save/drop interception at runtime without failing install. Mitigation: opt-in only; switch back with `version: "pinned"`.
- Unauthenticated GitHub API rate limit (60/h): bounded by the 24 h cache; `GITHUB_TOKEN` is honored.
