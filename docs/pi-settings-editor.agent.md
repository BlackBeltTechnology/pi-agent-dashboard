# pi-settings-editor.md — pi settings editor index

Pull-only condensed map. Source: docs/pi-settings-editor.md. Edits pi global `settings.json` via Settings → pi → `pi settings` (`/settings/pi-settings`). Mirrors dashboard default model into pi. Moves plain-text API keys to `auth.json`. Change: pi-settings-full-coverage (D1–D11).

## Files
- `packages/server/src/pi-agent-settings.ts` — `readPiSettings`, `computePiSettingsEtag`, `withPiSettingsLock`, `applyPiSettingsPatch`, `validateRawKeys`, `writePiSettingsRaw`, `mirrorDefaultsToPi`, `describeParseFailure`
- `packages/server/src/routes/pi-settings-routes.ts` — REST; raw body limit 256 KiB
- `packages/server/src/auth/pi-legacy-credentials.ts` — `detectLegacyCredentials`, `maskSecret`, `applyLegacyCredentialActions`
- `packages/server/src/auth/provider-auth-storage.ts` — `writeCredentialIfAbsent`, `resolveAuthJsonKey`
- `packages/server/src/pi-settings-themes.ts` — `listPiThemes`, `BUILTIN_PI_THEMES`
- `packages/shared/src/pi-settings-schema.ts` — `PI_SETTINGS_SCHEMA` (49 keys), `checkPiSettingValue`
- `packages/shared/src/enabled-models-match.ts` — `stripThinkingLevel`, `matchesPattern`, `modelInScope`
- `packages/client/src/components/settings/PiSettingsPage.tsx` — page; `deriveMirror`; `useSettingsDraftSource`
- `packages/client/src/components/settings/ModelScopeEditor.tsx`, `PiLegacyCredentialsWarning.tsx`, `PiSettingsRows.tsx`
- `packages/client/src/lib/model-scope.ts` — `parseScope`, `serializeScope`, `countInScope`
- `packages/client/src/lib/api/pi-settings-api.ts` — `getPiSettings`, `patchPiSettings`, `putPiSettingsRaw`, `syncPiDefaults`, `migrateLegacyCredentials`
- `packages/extension/src/session-sync.ts` — `filterByEnabledModels`

Global file only. `<cwd>/.pi/settings.json` never read or written.

## Paths
- `agentDir` = `$PI_CODING_AGENT_DIR` else `~/.pi/agent`
- Settings `<agentDir>/settings.json`; auth `<agentDir>/auth.json`; lock `<settings.json>.lock`

## REST (behind `networkGuard`)
- `GET /api/pi-settings` → `{ settings, raw, etag, parseError?, themes, legacyCredentials }`
- `PUT /api/pi-settings` `{ patch, baseEtag }`; `PUT /api/pi-settings/raw` `{ raw, baseEtag }` → `{ ..., reloadedSessions, restoredKeys?, legacyCredentials }`
- `POST /api/pi-settings/sync-defaults` → `{ piMirror, settings, raw, etag }`; no reload
- `POST /api/pi-settings/legacy-credentials` `{ baseEtag, actions:[{ key, action:"move"|"remove" }] }`
- Status: `200` · `400` invalid / `parseError` · `409` `{ error:"stale" }` · `413` raw > 256 KiB · `503` `{ error:"busy" }` · `500` I/O
- `settings` omits legacy values; `raw` shows secrets in JSON mode

## Content token (etag)
- Strip BOM → parse → drop mirrored keys → sort keys recursively → `JSON.stringify` → sha256
- Absent → `"absent"`; unparseable → sha256 of raw bytes
- Re-checked under lock; mismatch → `409`, nothing written

## Lock + atomic write
- Validate before lock; `proper-lockfile` `stale:10_000`, `retries:10`, 20 ms backoff
- Re-read, etag compare, sync `fn(state)`
- Write `.<hex>.settings.tmp`; chmod to target mode; `rename`; release in `finally`
- `ELOCKED` → `503`; crashed holder reclaimed after 10 s; fs via injectable `FsDeps`; locks never nest

## Typed form (D3)
- Kinds: `bool`, `enum`, `mixed`, `int` (min/max), `string`, `stringArray`
- Blocks: `compaction`, `branchSummary`, `codemode`, `terminal`, `images`, `markdown`, `warnings`, `thinkingBudgets`
- Leaf patch; `null` leaf deletes; blocks not nullable
- Schema-miss, mirrored key, bad type/range → `400`; whole patch rejected
- Unparseable file → `400 { parseError }`; never patch over `{}`
- Parity test: `packages/server/src/__tests__/pi-settings-schema-parity.test.ts`
- JSON-edit rows: `modelThinkingLevels`, `compaction.modelOverrides`, `defaultTools`, `npmCommand`, `prompts`, `themes`, `tuiMode`, `fullscreen*`, `outputPad`
- Read-only: `dashboardPluginBridges`, `_dashboardManagedPackages`, `lastChangelogVersion`

### Model scope (`enabledModels`, D7)
- Catalogue `GET /api/models?annotated=1`; modes All (unset or `[]`) / Selected only
- `<p>/*` = provider toggle; ids with `/` → explicit picks (`*` skips `/`)
- Empty Selected → field error; catalogue fail → key excluded from patch
- pi appends default model when missing; does not restrict roles/subagents

### Themes
- `system`, `dark`, `light` + global and package theme files; name = JSON `name` or basename
- `system` reserved; names with `/` dropped; global beats package; project-local not listed

## Legacy plain-text API keys (D4, D5a, D5b)
- Sources: `anthropicApiKey`→`anthropic`; `openaiApiKey`→`openai`; `providers.<id>.apiKey`→`<id>`; top-level `apiKey`→none
- Auth state: `none` · `same` (timingSafeEqual) · `different` (OAuth, other key, corrupt auth.json)
- `maskSecret` → `…` + last 4 if len ≥32, else `••••`
- `same` → Remove; `none` → Move; `different`/providerless → manual; queued in Form mode, run on Save

### Apply: 3 phases (D4)
1. Plan (settings lock): `move` needs `none`; `remove` needs `same`; no duplicate providers. Else `400`
2. `writeCredentialIfAbsent` per move (auth.json `withLock`); appeared → `409`, stop
3. Re-check `baseEtag`; mismatch → `409`, nothing deleted; else delete keys, prune empty `providers`

Page save (D9): validate → patch → legacy actions → patch with cleanup etag. Cleanup rebases `formBase`, `jsonBase`, `loaded`, etag; `form` keeps user values; never `adopt()`.

## Raw editor (D6)
- BOM stripped; valid JSON object; `RAW_LEGACY_TYPED` checked; newer typed keys not checked
- Write `JSON.stringify(obj, null, 2)` + `\n`; unparseable file does not block (repair path)

## Default-model mirror (D1)
- Trigger: `PUT /api/config` with `defaultModel` / `defaultThinkingLevel`; runs after `writeConfigPartial`; never fails save
- `defaultModel` split on FIRST `/`; else `skipped:"no-provider-separator"`
- Empty value → pi key untouched; unparseable pi file → `{ok:false, error:"parse"}`
- Drift repair: `POST /api/pi-settings/sync-defaults`

## Reload (D7)
- Typed, raw, legacy writes → `reloadConnectedSessions()` on success only; mirror never reloads

## UI (D8, D11)
- Form (mirrored keys read-only) + JSON (Monaco); one draft; `commit()` throws on field errors
- `409` → conflict banner, "Reload from disk"; no auto-merge/retry
- `400` → per-field errors; `413`/`503` → failed commit, draft dirty

## Shared matcher (enabledModels)
- `stripThinkingLevel` drops trailing valid `:<level>`; `matchesPattern` minimatch case-insensitive on `provider/id` and bare `id`
- Used by `filterByEnabledModels` (`packages/extension/src/session-sync.ts`) and scope count
- Empty list = all models (pi semantics); `minimatch` dep in `packages/shared`

## Electron (D10)
- `writeApiKey` removed from `packages/electron/src/lib/wizard-state.ts`
- No path writes API keys to settings.json; `hasAnyProviderCredential` unchanged (reads both files)

## Known limits
- pi flush can overwrite its own field after dashboard write; reload narrows window
- Absent-file creation race: pi may replace dashboard-created file
- Dashboard writes drop whitespace, key order, BOM
- Code-executing keys (`packages`, `extensions`, `shellPath`, `shellCommandPrefix`, `npmCommand`, `externalEditor`, `httpProxy`) editable behind `networkGuard`
- Secrets visible in JSON mode
- Phase 2/3 race → key in both files or `different`; no path deletes last copy
- Schema mirrors pi docs at one time; re-check on pi bump
