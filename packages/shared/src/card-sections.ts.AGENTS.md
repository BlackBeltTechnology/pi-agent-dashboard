# card-sections.ts — index

Session-card section visibility model. `CARD_SECTION_IDS` (openspec/git/process/kb/status/flows/memory/tags/spawn), `CardSectionPrefs {global?, folders?}` (sparse), `isValidSectionId` (`/^[a-z0-9-]{1,64}$/`), `isValidFolderPath` (absolute only — blocks `__proto__` keys), `cardSectionFolderKey` (`pathKey` fold, never realpath), `folderKeyForSession` (worktree → `gitWorktree.mainPath`), `resolveCardSectionVisible` (folder → global → visible), `getFolderOverride`/`getGlobalValue` (`null` = inherit), `countFolderOverrides`, caps `CARD_SECTIONS_MAX_FOLDERS`=1000 / `_MAX_KEYS`=64. See change: configurable-session-card-sections.

## add-focus-mode-and-card-block-toggles

- `CARD_SECTION_IDS` gains `openspec-badge`, `folder-git`, `folder-banner`, `folder-openspec`, `folder-create`, `folder-ended`, `fx-status-animation`, `fx-selected-glow`.
- `pluginSectionId(kind, pluginId)` builds a per-plugin id — kind `badge`|`actionbar`|`pill` → `badge-<id>`/`actionbar-<id>`/`pill-<id>`; returns `null` for an invalid kind or pluginId.
- `parentOf(id)` names a block's inheriting parent: `openspec-badge` → `openspec`, `badge-*` → `status`. Else `null`.
- `CardSectionPrefs.focus?: FocusState {enabled?, profile?}`; `FocusProfile {sections?: Record<string, boolean>, folderListMode?: FolderListMode}`; `FolderListMode` = `"classic" | "accordion"`.
- `resolveCardSectionVisible` order: focus profile (consulted ONLY while `focus.enabled`) → folder override → global → legacy parent (parent's folder, then global) → visible. `fx-*` ids ignore folder overrides — card effects are global-only.
- `DEFAULT_FOCUS_PROFILE` + `defaultFocusValue(id)` = built-in profile: explicit hide list plus a prefix rule hiding every `badge-*`/`actionbar-*`/`pill-*`; `process` deliberately untouched; `folderListMode` `accordion`.
- `resolveFolderListMode(prefs, configDefault)` resolves the effective list mode. `builtinProfileFor(offeredIds)` materializes the built-in profile over the offered ids. `captureFocusProfile(...)` snapshots current visibility as a custom profile.
- `validateFocusProfile(raw)` is STRICT (write path, returns `null` on any violation) and caps sections at `FOCUS_PROFILE_MAX_KEYS` = 256. `sanitizeFocusProfile(raw)` is LENIENT (load path, drops bad entries) — a corrupt on-disk profile must not wedge startup.
- `isPluginSectionVisible(prefs, kind, pluginId, folderKey)` resolves one per-plugin block.
- See change: add-focus-mode-and-card-block-toggles.
