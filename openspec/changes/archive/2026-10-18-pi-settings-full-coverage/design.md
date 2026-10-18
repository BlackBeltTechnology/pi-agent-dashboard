## Context

See proposal.md (Why). Current state:

- The typed-key schema is server-only. `TYPED_BLOCKS` and `TYPED_TOP` sit at `packages/server/src/pi-agent-settings.ts:330` and `:335`, with a copy on the client in the `FIELDS` array (`packages/client/src/components/settings/PiSettingsSection.tsx:56`). The two lists are maintained by hand. Managed default-model keys are rejected by `isManaged` (`pi-agent-settings.ts:343`, used in `checkPatchKey` at `:377`). The etag excludes those keys (`computePiSettingsEtag`, `:157`), so a Default-model mirror write by the config save never makes a pi-settings save stale.
- Raw validation reuses the typed sets. `validateRawKeys` (`pi-agent-settings.ts:529`) loops over `TYPED_BLOCKS`, `TYPED_TOP` and `RAW_KEY_RULES` (`:483`).
- `withPiSettingsLock` (`pi-agent-settings.ts:288`) takes a pure, synchronous callback. The auth.json `withLock` (`packages/server/src/auth/provider-auth-storage.ts:95`) also takes a synchronous callback. The two locks therefore cannot be nested, and neither file's write can happen inside the other's lock.
- `writeCredential` (`provider-auth-storage.ts:274`) refuses cross-type writes but silently overwrites a same-type `api_key`.
- `parseText` returns `JSON.parse`'s error message (`pi-agent-settings.ts:141-149`). Node quotes source text in that message, so a truncated file holding a key leaks part of it through `parseError`.
- Routes: `GET /api/pi-settings` (`packages/server/src/routes/pi-settings-routes.ts:101`), the typed `PUT` (`:110`), the raw `PUT` (`:124`) and `POST /api/pi-settings/sync-defaults` (`:148`), all behind `networkGuard`. The response types live in `packages/shared/src/rest-api.ts` (`PiSettingsReadResponse`).
- The UI is a section inside the Sessions branch of `SettingsPanel.tsx:2264`, wired to `dashboardDefaults`, `refreshKey` and `syncDefaults` for the drift banner. The rail is built from `navGroups` (`:1159`). `useSettingsDraftSource` takes only `{ id, page, isDirty, commit, reset }` (`packages/dashboard-plugin-runtime/src/settings-draft-context.tsx:113-132`) and has no validity gate.
- Theme resolution: `distributeResolved` (`packages/server/src/pi/pi-resource-scanner.ts:524-553`, called at `:636`) splits resolved themes into global, local and per-package buckets. `nameForResolved` (`:466-470`) uses the file basename, but pi identifies a theme by the `name` field in its file (pi `docs/themes.md`). `theme` also accepts a `light/dark` pair, and names cannot contain `/`.
- `GET /api/models?annotated=1` returns the full annotated catalogue (`packages/server/src/routes/models-introspection-routes.ts:80-85`).
- The extension filters session model lists by `enabledModels` (`packages/extension/src/session-sync.ts:75`): it strips `:<thinking>` suffixes, matches case-insensitively against `provider/id` and the bare id, and treats an empty list as all models.
- `writeApiKey` (`packages/electron/src/lib/wizard-state.ts:155`) has only test callers. Credential detection (`packages/shared/src/credential-detect.ts`) reads both files and is unchanged.
- `scan-legacy-provider-ids.ts` (`packages/server/src/auth/:24-25`) holds the single pi provider rename `azure-openai-responses` → `azure` as private constants. Only the session scanner is exported.
- pi appends the persisted default model to a non-empty `enabledModels` when it is missing (pi `dist/core/agent-session.js`, `_addPersistedDefaultToNonEmptyScope`). pi also migrates a settings.json `apiKeys` object into auth.json at startup (pi `dist/migrations.js`).
- `filterByEnabledModels` uses `minimatch`, which is a dependency of `packages/extension` only.

## Goals / Non-Goals

**Goals:**
- One shared key schema that drives server validation, client rendering, defaults and categories, so the two cannot drift.
- The cleanup never loses a credential. Masked values are the only form in which a key leaves the server through the legacy-credential paths.

**Non-Goals:**
- Redacting keys from JSON mode. JSON mode shows the file as stored, as today; the cleanup is how the keys leave the file.
- Editing object- or array-valued keys other than `enabledModels` and `thinkingBudgets` in the form.
- Project-level `<cwd>/.pi/settings.json` editing.
- Restricting roles or subagents by `enabledModels`.
- Editing TUI-only keys. `tuiMode`, the `fullscreen*` keys and `outputPad` stay JSON-only rows, because `pi-api-feature-detection` records them as no-ops with no dashboard surface. A MODIFIED delta of the 0.87–1.0 no-op record covers only the `quietStartup` and `theme` rows.

## Decisions

### D1: Shared schema module `packages/shared/src/pi-settings-schema.ts`
Each entry carries `{ key, kind: "bool" | "enum" | "mixed" | "int" | "string" | "stringArray", options?, min?, max?, def, category, label, hint }`. The server derives its leaf checks from it, and the client derives rows, defaults, ranges and categories. It lives next to the existing `pi-settings-keys.ts`. The schema **excludes** `PI_MANAGED_SETTINGS_KEYS`; `checkPatchKey` keeps its `isManaged` rejection first, and the raw restore of managed keys is unchanged. A regression test pins this.
- *Alternative:* two lists plus a parity test. Rejected: about 60 entries per side, and the parity test is just a second copy.
- Defaults and labels are display data only. The server never writes a default.

### D2: Raw mode keeps a frozen check list
`validateRawKeys` stops iterating the typed sets and instead uses a frozen `RAW_LEGACY_TYPED` list (the 10 pre-change keys) plus `RAW_KEY_RULES`. Rationale: the schema mirrors pi's docs at one point in time, and a strict raw check would block saving a file a newer pi accepts. The form stays strict because it only writes values it offers.

### D3: Generic leaf patch, block names derived from the schema
`checkPatchKey` and `applyBlockPatch` generalise to every dotted prefix in the schema (`compaction`, `branchSummary`, `codemode`, `terminal`, `images`, `markdown`, `warnings`, `thinkingBudgets`). `enabledModels` is the single whole-value key: the value must be an array whose every element is a non-empty string, otherwise `400` naming `enabledModels`. Merge-preserving and `null`-deletes semantics are unchanged.

### D4: Legacy-credential endpoint `POST /api/pi-settings/legacy-credentials`, two-phase
Body: `{ baseEtag, actions: [{ key, action: "move" | "remove" }] }`. Neither lock can be held across the other (see Context), so the endpoint runs in three phases with re-validation:

1. **Plan** (`withPiSettingsLock`, no write). Check the etag (`409` on mismatch). Read each key's value and resolve its provider (D5a). Compute each key's auth state (`none`, `same` or `different`) from a locked auth.json read (`readAuthJsonLocked`), comparing values with `crypto.timingSafeEqual` on equal-length buffers. The read also probes the pre-rename id. A corrupt or unreadable auth.json yields `different` for every key (fail safe: no move, no remove). Validate every action: the key is present, a move needs a provider and state `none`, a remove needs state `same`, and no two actions resolve to the same provider. Any failure returns `400` and writes nothing. Values stay in server memory.
2. **Credential writes** (one auth `withLock` per move, through a new `writeCredentialIfAbsent(provider, cred)`). The absence check and the write happen inside the same lock callback, which closes the race with a concurrent Providers save. If a credential appeared since the plan, that action is refused and the whole request stops: no settings.json delete happens, and the response is `409` with the refreshed legacy list. Moves already written stay; those keys now exist in both files, which is safe.
3. **Delete** (`withPiSettingsLock`, write). Re-check that the etag still equals `baseEtag`; if not, return `409` and delete nothing. The etag covers every non-managed key, so any change to a planned value also fails this gate, and it is the only guard needed. Otherwise delete the planned keys, prune empty `providers.<id>` and `providers`, and write. A value changed meanwhile stays, and the next read reports it as `different`.

The route registers with `preHandler: networkGuard` like its siblings. Sessions are then reloaded as for the other writes. Every response (success, `400`, `409`) carries the refreshed masked legacy list, plus the new state and etag on success. Values are never included. The client reconciles its queue against that list, so a retry never re-sends a completed move. `CredentialTypeConflictError` maps to `409` with a fixed message.
- *Alternative:* the client calls the provider-auth `PUT` and then a raw write. Rejected: the secret makes a client round trip, and the raw write could resurrect keys.

### D5a: Provider normalisation
Mapping: `anthropicApiKey` → `anthropic`, `openaiApiKey` → `openai`, `providers.<id>.apiKey` → `<id>`, `apiKey` → none. Each id then goes through `resolveAuthJsonKey` (`provider-auth-storage.ts:527`) and a new exported `PI_RENAMED_PROVIDER_IDS` map (`{ "azure-openai-responses": "azure" }`) in `scan-legacy-provider-ids.ts`. The scanner is refactored to read its constants from that map, so the rename has one source.

### D5b: Masking and leak-proof errors
`maskSecret(v)` returns `…` plus the last 4 characters when `v.length >= 32`, otherwise `••••`. `parseText` never returns `JSON.parse`'s message. Node's `SyntaxError` has no offset property, so it extracts `position N` and `line L column C` from the message with a regex when present and returns `Invalid JSON at line L, column C`; otherwise it returns a fixed `Invalid JSON`. A test covers the "Unexpected token" form, which quotes source text and carries no position. Leak test: a fixture key value, then assert on every legacy-list entry, move/remove response, error envelope, `parseError` and captured log line. The `raw` field is excluded by design (Non-Goals).

### D6: Themes in the read response
`GET /api/pi-settings` adds `themes: string[]`: the built-ins `system`, `dark` and `light`, plus the global and package theme resources from the scanner. For each theme file, the name is its JSON `name` field, falling back to the basename. Files that fail to read or parse are skipped, and so is a theme named `system` (reserved by pi). On a name collision the global theme wins over a package theme. Names containing `/` are dropped. Project-local themes are out of scope because this editor targets the global file. The list is de-duplicated and sorted. Scanner or parse failure → built-ins only; the read never fails because of it. The client select offers these names plus "Custom…" (free text, which allows the `light/dark` pair). An unknown stored value is rendered as an extra selected option.

### D7: Model scope editor
The catalogue comes from `GET /api/models?annotated=1`, fetched once when the page opens and grouped by provider. `parseScope(enabledModels, catalogue)` produces `{ wholeProviders, picks, patterns }`, keeping each entry's original string:
- `<p>/*`, optionally with a `:<level>` suffix (stripped before the check, kept on save) → whole provider;
- `<p>/<id>[:<level>]` whose `<p>/<id>` exists in the catalogue → pick (the suffix is kept);
- anything else → pattern.

`serializeScope` emits entries in their original relative order, with new entries appended in UI order. Dirty is a set comparison of entry strings, so a load-then-save without edits sends nothing. The in-scope count uses the same matcher as `filterByEnabledModels`: `stripThinkingLevel` and the minimatch match move into `packages/shared/src/enabled-models-match.ts`, the extension imports it, and `minimatch` becomes a `packages/shared` dependency (already in the install tree via the extension). Picks check the full id against the catalogue before stripping a suffix, so ids such as `openrouter/x:free` are not misread. Deselecting a model of a whole provider rewrites `<p>/*` into explicit picks of the remaining catalogue models. Because `*` does not match `/`, a provider whose catalogue ids contain `/` is saved as explicit picks instead of `<p>/*`, and `parseScope` decides "whole provider" with the shared matcher, not by prefix. The in-scope count is labelled as catalogue models: pi further limits scoped models to those with credentials. A stored `[]` loads as "All models". "Selected only" with an empty set makes `commit()` throw a field error (D11). If the catalogue fetch fails, the editor renders a notice and is excluded from the patch. pi's auto-append of the default model can change the file after a save; the editor states this, and the next load shows the added entry. A resulting `409` follows the existing reload-from-disk path.

### D8: Page placement and wiring
- The rail gets a group `pi` with item `pi-settings`, and a new `activeTab === "pi-settings"` render branch.
- The Sessions branch drops the section.
- `dashboardDefaults`, `refreshKey` and `syncDefaults` move with the component to the new branch, so drift repair keeps working.
- `useSettingsDraftSource({ id: "pi-settings", page: "pi-settings" })`.
- The component is renamed `PiSettingsPage` and keeps its `pi-settings-*` testids.
- `tests/e2e/pi-settings-editor.spec.ts` changes its navigation from the Sessions tab to the new rail item.
- The page keeps the existing notes banner: saving reloads running sessions, and a project `.pi/settings.json` may override the global values.

### D9: Save sequencing and partial failure
Order inside `commit()` (single source of truth):
1. Validate fields (D11). Any error throws and nothing is sent.
2. Compute the form patch from `form` vs `formBase` before any request.
3. Run the queued legacy actions (Form mode only).
4. Send the precomputed patch with the cleanup's etag.

On cleanup success the component rebases, never `adopt()`s: `formBase`, `jsonBase`, `jsonDraft`, `loaded` and the etag take the cleanup snapshot, and `form` keeps the user's values. The JSON baseline is therefore fresh and can't resurrect moved keys. Form patches never contain legacy keys, so the precomputed patch is still valid on the new base. If the cleanup fails, it throws before the patch. If the cleanup succeeds and the patch fails, it throws with the patch errors; the queue is already cleared, so a retry re-sends only the patch. Each successful request reloads sessions once, and the status line reports the sum of both counts. In JSON mode, the legacy warning shows no actions and says the cleanup runs from Form mode. Discard (including discard-on-mode-switch) also clears the queue.

### D10: Dead writer removal
Delete `writeApiKey` and its tests in `packages/electron/src/__tests__/wizard-state.test.ts`. Detection is unchanged.

### D11: Field errors without a runtime API change
`useSettingsDraftSource` has no validity gate, and adding one would change the plugin runtime API. Instead, field errors render inline as soon as they are typed. `commit()` validates first and throws, sending nothing, when any field error exists (including the empty scope from D7). The panel already keeps a source dirty and shows the failure when `commit` throws. The spec says "Save fails", not "Save disabled".

## Risks / Trade-offs

- [Schema drifts from pi docs on a pi bump] → Add a `docs/settings.md` re-check step to the project-memory skill `project:pi-agent-dashboard:bump-pi-version`. D2 keeps raw mode tolerant.
- [`shellPath`, `shellCommandPrefix`, `externalEditor` and `httpProxy` become one-click editable, and they execute commands or route traffic] → Accepted trade-off. Same routes, `networkGuard` and dashboard auth as the raw editor, which can already set them. Hints name the effect. No confirm step: the unified Save is already an explicit action, and the user can see every changed field before saving.
- [The secret is visible in JSON mode] → Accepted, unchanged from today (Non-Goals). The legacy-credential endpoint itself never carries values.
- [Strict-shape read-response tests break when `themes` and `legacyCredentials` are added] → Update them in the same change (tasks).
- [Mixed state after a phase-2/3 race] → The key exists in both files with an identical value (state `same`, Remove offered), or with differing values (state `different`, no automatic action). No path deletes the last copy of a value.
- [Large model catalogue (~170 rows)] → Providers are collapsed by default and the filter narrows them. No virtualisation needed at this size.

## Migration Plan

No forced data migration. Existing settings.json files load unchanged, and legacy keys stay until the user acts. A completed move or remove is user-initiated and not reverted by a code rollback: auth.json keeps the credential, and settings.json no longer holds the key. This is the intended end state.
