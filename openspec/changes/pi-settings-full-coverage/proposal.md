## Why

pi's global `~/.pi/agent/settings.json` has 71 documented keys (pi `docs/settings.md`), but the dashboard's pi settings form edits only 10. Everything else, including `enabledModels` (which sets the models Ctrl+P cycles through and the models the dashboard picker lists), the pi terminal `theme`, and every terminal, network and telemetry knob, needs the raw JSON editor. The file also still holds plain-text API keys (`anthropicApiKey`, `openaiApiKey`) that the Electron first-run wizard wrote there. pi reads credentials from `auth.json`, so these keys are dead weight and a secret-hygiene risk. The wizard's writer (`writeApiKey`) has no callers any more, but it and its spec still describe settings.json as the credential target.

## What Changes

- Mockup: mockups/pi-settings-ui (in this change)
- **New Settings page `pi → pi settings`** in the settings rail. It replaces the "pi settings (global)" section on Settings → Sessions and keeps that section's Form/JSON modes, unified Save, conflict, drift and parse-error handling.
- **Typed form for every simple key** (boolean, enum, bounded integer, string), grouped into the categories of pi's `docs/settings.md`. Each row shows its label, the raw key, a control that displays pi's default, a "Changed" marker and a reset-to-default action.
  - Boolean keys and enums with ≤3 options use a tri-state `Default · value…` segmented control. Longer enums use a select.
  - Integers are range-checked inline, and a Save attempted with an error fails without writing anything.
- **Filter box, category jump chips and a "Set or changed only" toggle** over the page.
- **Link rows instead of duplicate editors** for keys that already have an editor: Default model, Retry (`retry.*`), Packages, Extensions and Skills. Object- or array-valued keys (`modelThinkingLevels`, `compaction.modelOverrides`, `defaultTools`, `npmCommand`, `prompts`, `themes`) and the TUI-only no-op keys (`tuiMode`, `fullscreen*`, `outputPad`) get an "Edit in JSON" row. `thinkingBudgets` gets four integer inputs.
- **Model cycling scope editor for `enabledModels`**: an "All models" / "Selected only" switch, a provider toggle that saves `provider/*`, per-model picks, free glob patterns, a live in-scope count and a preview of the saved JSON. It states that the setting does not restrict roles or subagents.
- **Terminal theme select**: pi's built-in themes plus the theme files pi resolves from its `themes` paths and packages.
- **Plain-text API-key cleanup**: a warning lists every legacy key in settings.json (`anthropicApiKey`, `openaiApiKey`, `apiKey`, `providers.<id>.apiKey`) with a masked value. Each key offers "Move to Providers" (writes `auth.json`, then deletes the settings.json key) when auth.json has nothing for that provider, or "Remove from settings.json" when auth.json already holds the identical key. A providerless key, or one whose stored credential differs, gets no automatic action, because removing it could delete the only copy. Actions run from Form mode on Save and can be undone until then.
- **Settings parse errors stop quoting file content**, so a truncated settings.json can't leak part of a key through `parseError`.
- **Remove the dead Electron writer** `writeApiKey`, which put keys into settings.json and has no callers. The spec stops requiring settings.json as a credential write target. Credential detection keeps reading both files, so existing installs are unaffected.
- Dashboard-managed keys (`dashboardPluginBridges`, `_dashboardManagedPackages`, `lastChangelogVersion`) show as a collapsed, read-only list.

## Capabilities

### New Capabilities
- `pi-settings-legacy-credentials`: detecting plain-text API keys in pi's settings.json and migrating them into `auth.json` (move or remove), including masking and the ordering of the auth.json and settings.json writes.

### Modified Capabilities
- `pi-agent-settings-editor`: the typed patch now covers every scalar key pi documents, plus `enabledModels`, `theme` and `thinkingBudgets` (replacing the 10-key set). The UI requirement moves from a Sessions section to a dedicated `pi settings` page with filter, categories, link rows and the model scope editor.
- `electron-settings-persistence`: API-key persistence into settings.json is removed. Only credential detection remains.
- `pi-api-feature-detection`: the 0.87–1.0 no-op record notes that the generic settings page may show `quietStartup` and `theme` as configuration rows, while `tuiMode` and the fullscreen keys stay JSON-only and the dashboard never overrides any of them.

## Impact

- Server: `packages/server/src/pi-agent-settings.ts` (typed key schema, parse-error sanitising), `packages/server/src/routes/pi-settings-routes.ts` (legacy-key endpoint), `packages/server/src/auth/provider-auth-storage.ts` (new `writeCredentialIfAbsent`), theme list via `packages/server/src/pi/pi-resource-scanner.ts`.
- Shared: new schema module for pi settings keys (types, defaults, ranges, categories), consumed by both server validation and the client form. `rest-api.ts` read-response type gains `themes` and `legacyCredentials`. The `enabledModels` matcher moves to shared so the extension and the scope editor agree.
- Client: `packages/client/src/components/settings/PiSettingsSection.tsx` (becomes `PiSettingsPage`), `SettingsPanel.tsx` (new rail item and render branch, section removed from Sessions), new model-scope editor component, `pi-settings-api.ts`, i18n keys, and the existing component tests (`PiSettingsSection.test.tsx`, `SettingsPanel.test.tsx`, `settings-page-composition.test.tsx`).
- E2E: `tests/e2e/pi-settings-editor.spec.ts` navigation moves from the Sessions tab to the new rail item.
- Electron: `packages/electron/src/lib/wizard-state.ts` (delete `writeApiKey` and its tests).
- Model catalogue for the scope editor comes from the existing `GET /api/models?annotated=1`.
- New dependency: `minimatch` in `packages/shared` (already installed via `packages/extension`), so the scope editor and the extension use one matcher.

## Discipline Skills

- `security-hardening`: the change reads, masks, moves and deletes API keys, and the endpoint receives secrets.
- `doubt-driven-review`: deleting secrets from settings.json and removing the wizard's credential writer are irreversible for the user's file.
- `review-code`: a non-trivial client + server + electron change before commit.
