# Harvest — host chrome + activation index + contract + lint hooks

Read-only. Paths relative to repo root. `PSP` = `packages/client/src/components/settings/PluginSettingsPage.tsx`,
`PRP` = `packages/client/src/components/packages/plugin-row-parts.tsx`, `PS` = `.../packages/PluginsSection.tsx`.

## 1. Host chrome (`PSP`, 352 lines)

Mount: `SettingsPanel.tsx:2528-2547` — `activeTab==="plugins"` + row has settings → `<PluginSettingsPage row toggle onLeaveGuard onNavigate=requestRailNavigate promotion>`; else `PluginNotFoundNotice` (if id) + `PluginsSection`.
- Root `space-y-4`, testid `plugin-settings-page-<id>` (PSP:140). `toggle.cascadeDialog` mounted first (PSP:144).
- Chrome card `border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)]`, testid `plugin-page-chrome` (PSP:147-150). Radius `rounded` (contract: card root = `rounded-xl`, panels = `rounded-lg`).
- Two variants: `promotion ? compact : full` (PSP:151).
### Full header (PSP:222-265)
- Row `flex items-center gap-2 px-3 py-2.5`.
- Icon `mdiPackageVariantClosed` size 0.8, `text-[var(--text-muted)]`.
- Title h2 `text-base font-semibold text-[var(--text-primary)] truncate`, testid `plugin-page-title`; shows `row.displayName` (NOT stripped of Cc/Cf here; compact variant strips, PSP:175).
- Subline id `text-[10px] text-[var(--text-muted)] truncate` — 10px + muted carries info (contract: below 11px = non-essential; muted = decoration only).
- `StatusPill` (PRP:41-79): `px-1.5 py-0.5 text-[10px] rounded` + state: unknown (`bg-tertiary`/`text-tertiary`), error (ERR red color-mix, `title=error`), disabled (`bg-tertiary`/`text-muted`), not loaded (WARN), enabled (OK green). Words hard-coded English except "not loaded". No testid on full-variant pill.
- Enable toggle: native `<input type=checkbox className="accent-blue-500">` (Tailwind palette class — contract forbids) + `<span text-[10px] text-[var(--text-secondary)]>enable</span>` (lowercase, not i18n). testid `plugin-page-toggle-<id>`. `disabled={toggle.isToggling(id)}`. No min target size.
- Chips row `px-3 pb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5` (PSP:248): `depends on:` (`plugin-page-depends-on`), `claims:` (`plugin-page-slots`, value = sorted unique `row.claims[].slot` joined ", ", PSP:132). Full variant shows NO `required by:`.
- `Chip` (PSP:91-100): `inline-flex items-center gap-1 text-[10px]`; label `text-[var(--text-muted)]`; value `<code px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]>`.
### Compact header (promoted page, PSP:151-220)
- `px-3 py-2.5 space-y-1.5`, testid `plugin-page-compact-header`. Title = `promotion.label`; `CompactHealthPill` only when unhealthy (testid `plugin-page-pill`; `requirements` WARN pill when enabled+loaded+no error but missing reqs, PSP:72-89).
- Lede `text-xs text-[var(--text-secondary)]`, testid `plugin-page-lede`.
- Provenance `flex items-center gap-2 text-[11px] text-[var(--text-muted)]`, testid `plugin-page-provenance`: icon 0.55 + "Provided by the {name} plugin" + same checkbox toggle.
- `<details data-testid="plugin-page-details" className="text-[10px]">` summary `cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]` "Plugin details"; body chips `id:`, `depends on:`, `required by:` (`plugin-page-dependents`), `claims:`.
### Banners inside chrome card (PSP:267-282)
- toggle error → `CopyableErrorBlock` testid `plugin-toggle-error-<id>`; status error → `plugin-status-error-<id>`; each wrapped `px-3 pb-2.5`.
- `CopyableErrorBlock` (PRP:81-110): `flex items-start gap-2 px-3 py-2 rounded` ERR bg/fg/border `text-xs`; `mdiAlert` 0.6; `<pre font-mono text-[11px] leading-snug>`; Copy btn `px-1.5 py-0.5 rounded text-[10px] border` testid `<testId>-copy`.
- `MissingRequirementsBlock` (PRP:112-223) always wrapped `px-3 pb-2.5` (empty padding div when nothing missing). Root `mt-2 space-y-1.5`. Each line `flex items-center gap-2 text-[11px] ${WARN_FG}` + `mdiAlert` 0.5 + text + `<code bg-tertiary text-primary>`:
  - `requires pi extension` (`missing-piExtension-<n>`) + Install btn (LINK blue, `install-piExtension-<n>`) or "Install via Packages tab" → `/settings/add-ons` (`install-piExtension-link-<n>`), both `px-2 py-0.5 rounded text-[10px]`.
  - `requires binary on PATH:` (`missing-binary-<n>`), `requires service:` (`missing-service-<n>`), `requires file:` (`missing-path-<n>`, PRP:206-219; non-actionable, no button).
- Colour fragments PRP:25-38: `WARN_FG = text-[var(--accent-yellow)]`, `WARN_BG = color-mix(--accent-yellow 12%)`, `WARN_BORDER = 40%`; ERR (`--accent-red`), OK (`--accent-green` 15%), LINK (`--accent-blue`). All paint FILL accent as text → contract wants `--severity-*` / `--accent-<hue>-text`.
### Below chrome
- Restart-required banner (PSP:286-309) testid `plugin-page-restart-required`: `flex items-center gap-2 px-3 py-2 rounded` WARN `text-sm` + `mdiRestart` 0.6 + btn `px-2 py-1 rounded text-xs` WARN `plugin-page-restart-now-btn` ("Restarting…"/"Restart now", not i18n).
- Body (PSP:312-317): enabled → `<div data-testid="plugin-page-body-<id>"><PluginSettingsPageProvider pluginId><SettingsSectionByPluginSlot pluginId/></…></div>` — no wrapper styling; plugin owns all body layout.
- Disabled notice (PSP:318-339) testid `plugin-page-disabled-notice`, same WARN banner recipe, text "This plugin is disabled. Its settings are not available until you enable it." + `plugin-page-reenable-btn` "Enable".
- Back link (PSP:342-350) `<button text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]>← Plugins` testid `plugin-page-back-to-index`; sits at page BOTTOM; muted text = info violation; no target size.
- `PluginNotFoundNotice` (PSP:52-62) WARN banner `text-sm` + `<code>` id, testid `plugin-not-found-notice`.
### Developer-mode gate for `claims:` chip
- No `developerMode` / `devMode` / `showDev` flag anywhere in `packages/client/src` (grep empty; only `isDev` prop in `PackageRow.tsx:38`).
- Developer is a settings PAGE: rail id `developer` (`SettingsPanel.tsx:1235`, group `advanced`), body at `SettingsPanel.tsx:2628-2656` (`devBuildOnReload`, `keeperLog.capturePiOutput`, Diagnostics/PiRuntime/Node/Tools/SpawnFailures/CanvasTypes). Neither is a "show dev info" toggle.
- Closest existing gate: `displayPrefs.debugTools` ("Debug events", `SettingsPanel.tsx:3021`; `ChatViewMenu.tsx:207`) read via `useDisplayPrefs(sessionId).debugTools` (`hooks/useDebugToolsVisible.ts` deprecated wrapper). Scoped to chat raw-protocol events, per-session overridable — semantic stretch for gating `claims:`.
- Precedent for hiding dev metadata: compact variant puts `claims:` behind `<details>` (PSP:191-219).

## 2. Activation index row (`PS`, 239 lines; mounted `SettingsPanel.tsx:2546`)
- Root `space-y-3` testid `plugins-section`; list `space-y-1.5` (PS:84,107). Restart banner `plugins-restart-required-banner` / `plugins-restart-now-btn` (PS:88-100), same WARN recipe. Empty state dashed border `plugins-empty-state` (PS:110-111).
- Row card `border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)]` testid `plugin-row-<id>` (PS:134-137).
- Head `flex items-center gap-2 px-3 py-2` (PS:139): icon 0.6 muted; name `text-sm text-[var(--text-primary)] font-medium truncate`; id `text-[10px] text-[var(--text-muted)] truncate`; `StatusPill`; when disabled note `text-[10px] text-[var(--text-tertiary)]` "shown in Models" / "not in Settings nav" (`plugin-disabled-note-<id>`); checkbox `accent-blue-500` + `enable` 10px (`plugin-toggle-<id>`, no leave guard); cog btn `p-1.5 rounded transition-colors` `mdiCogOutline` 0.65 → `/settings/plugins/<id>`, disabled `text-tertiary opacity-40 cursor-not-allowed`, `aria-label`/`title` "Open plugin settings"/"No settings for this plugin", testid `plugin-expand-<id>` (PS:170-180). Cog ≈ 28px box — under 44/32 floor.
- Deps row `px-3 pb-2 flex flex-wrap items-center gap-1.5 text-[10px]` (PS:183): `depends on:` + one `<code>` per dep (`plugin-depends-on-<id>-<d>`), `required by:` `ml-2` (`plugin-required-by-<id>-<d>`). No `claims:` on index.
- Then toggle/status error blocks + `MissingRequirementsBlock`, each `px-3 pb-2` (PS:213-232).
- Index = whole row clickable? No — only cog navigates.

## 3. `ui-contract.md` (271 lines) — verbatim
- L78-86 accent rule: "a new surface uses a *severity* or *tint* token, not `--accent-red` directly and never a Tailwind palette class (`text-green-400`, `bg-blue-500/10`, …) or a hex/`rgba(` literal. … When text must be coloured by hue, use `--accent-<hue>-text`, never `--accent-<hue>` (a fill with no contrast guarantee — 80 of 108 sit below the 4.5:1 text floor on `--bg-surface`), and back the hue with a word, icon or shape … `scripts/theme-token-guard.mjs` (arm `accentText`) fails any NEW fill-accent text paint; existing ones are baselined debt."
- L60 severity token row: `--severity-{error,warning,success,info,neutral}-{bg,fg,border}` — "any state message, badge, or callout".
- L110-114: "`--text-muted` is decoration only … Headings, labels and help text use `--text-primary` / `--text-secondary`; timestamps and counts are information → `--text-secondary`."
- L122: "**Target floor:** `tap-target` = min-height 44px, 32px from `sm:` up."
- L133-149 Type scale: micro `text-[9px]` telemetry only · chip `text-[10px]` badge/pill · meta `text-[11px]` · body-dense `text-[12px]`/`text-xs` · body `text-sm` forms/dialogs/prose · title `text-lg` page+dialog titles. L145: "**Floor:** anything below `text-[11px]` must be non-essential — never the only carrier of a state, an error, or an action label."
- L188 severity callout: "`rounded-md border bg-[var(--severity-X-bg)] border-[var(--severity-X-border)] text-[var(--severity-X-fg)]`".
- L191 primary button: "`focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` — `--accent-solid` is theme-invariant …; `--accent-primary` is NOT a white-text fill (3.68:1)". L192 secondary: "`focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px]`".
- L193 section heading `text-[12px] font-semibold text-[var(--text-secondary)]`; L194 field label `text-[12px] font-semibold text-[var(--text-primary)]`.
- L195 settings field: "the runtime field family (`dashboard-plugin-runtime/src/settings-fields.tsx`): label row (`text-xs font-semibold text-[var(--text-primary)]`, `htmlFor`, unit chip inside the label) + optional key chip + state pill → control → hint (`text-xs text-[var(--text-secondary)]`, `aria-describedby`) → error (`text-xs text-[var(--severity-error-fg)]`, `role="alert"`, `aria-invalid`). **Exception to the `input` row's "label above":** settings rows keep the label beside the control (stacked only for text inputs). The 12 px unit chip inside a settings `<label>` is an exception to the 11 px chip step (text inside a `<label>` meets the 12 px interactive floor)."
- L210-213 a11y #2: "Interactive targets ≥ 24×24 px; primary actions ≥ 44×44 px (Fitts's Law). On the aligned action surfaces: every button ≥ 44×44 below `sm`, and ≥ 32 px … `sm:min-h-[36px]`, icon-only `min-w-[44px] sm:min-w-[32px]`)." L246-250: open contradiction #2 vs recipe; recipe ships.
- L238-243 #7: "`--severity-X-fg` is text-safe on `--severity-X-bg` (a pill or callout), not on `--bg-surface`".
- L267: "One focal point per view (Von Restorff); exactly one visually-primary action."
- Radius L161-163: `rounded` chips/inputs · `rounded-md` buttons/small panels · `rounded-lg` panels · `rounded-xl` card root.

## 4. Runtime exports + lint patterns
- `packages/dashboard-plugin-runtime/src/index.ts:115-130` from `./settings-fields.js`: types `FieldContract, FieldControlProps, SettingsFieldState, SettingsFieldTestIds, SettingsNoticeTone`; values `FieldShell, NumberField, SelectField, SettingsGroup, SettingsNotice, TextAreaField, TextField, ToggleField`. L108-113: `PluginSettingsPageProvider, SettingsDraftProvider, usePluginSettingsPageId, useSettingsDraftSource` (`settings-draft-context.js`).
- `packages/shared/src/__tests__/plugin-activation-contracts.test.ts` (77 lines): `REPO_ROOT = path.resolve(__dirname,"../../../..")`; each `it` does `fs.readFileSync(path.join(REPO_ROOT,"<fixed file>"))` then string/regex assert (e.g. `panel.includes("SettingsSectionSlot")===false`, L24-34; regex on `system-routes.ts`, L67-75). Fixed file list, NO directory walk, NO baseline. Tagged `@structural-pin` JSDoc (L20-22).
- `scripts/theme-token-guard.mjs` (386 lines): 3 ratchet arms `fallback`, `undeclared`, `accentText` (L5-21). `SCAN_ROOTS` (L50-55) = `packages/client/src`, `packages/automation-plugin/src/client`, `packages/flows-plugin/src/client`, `packages/gmail-plugin/src/client` ONLY — every other plugin client tree unscanned. `walk()` recursive `.tsx?` (L126-140; accentText arm also `.css`). Baseline `scripts/theme-token-baseline.json`, per-`file→count` map per arm; `ratchet(found, baseline)` fails on new key or higher count, lists `repaired` (L198-210); baseline only shrinks; `--write` refresh, `--write --bootstrap-arm accentText` one-time arm add (L37-38, L249-260). Exports `scan({root,roots,css})`, `ratchet`, `loadBaseline`, `main`, `SCAN_ROOTS`, `NON_TEXT_PAINT_FILES`; tested by `scripts/__tests__/theme-token-guard.test.mjs` (fixture roots via `scan({root,roots})`). → template for a kit-adoption ratchet lint.

## 5. `packages/client/src/index.css` `@source` (L16-31; comment L6-15: star glob does NOT expand, one line per plugin REQUIRED)
| plugin | client tree | `@source` |
|---|---|---|
| apple-tools | `src/client` | ABSENT |
| automation-plugin | `src/client` | present |
| blackhole-plugin | `src/client` | ABSENT |
| browser-plugin | `src/client` | ABSENT |
| chat-gateway | `src/client` | ABSENT |
| cost-estimator | `src/client` | ABSENT |
| flows-anthropic-bridge-plugin | no `src/client`; `src/client.tsx`, `src/FlowsAnthropicBridgeSettings.tsx` | ABSENT |
| grammar-plugin | no `src/client`; `src/GrammarSettings.tsx` etc. | ABSENT |
| quota-plugin | no `src/client`; `src/QuotaSettings.tsx`, `src/client.tsx` | ABSENT |
| mcp-client-plugin, system-one-plugin, obs-studio-plugin, goal-plugin, flows-plugin, subagents-plugin | `src/client` | present |
Also present: `client-utils/src`, `dashboard-plugin-runtime/src`, gmail, context-mode-settings, hermes-memory, kb, team, skill-atlas, web-access.
Absent ⇒ classes used only in those plugins get purged unless also used elsewhere (likely cause of some "badly designed" pages).
