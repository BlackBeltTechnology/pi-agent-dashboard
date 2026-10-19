# Harvest — automation (`AutomationSettings.tsx`, 178 lines)

## Purpose
Global defaults for automation-plugin: default run visibility, run retention, which scopes scanned (folder/global), fallback model for unresolved `@role`.

## Structure
Claim: `settings-section`, `tab:"general"`. Root `<div className="space-y-3">` `:106`. No self-header (comment `:105` "host owns identity") — OK.
1. Intro `<p>` `:107` "Plugin settings apply globally across all repos."
2. Default run visibility — label + select `:109-120`.
3. Run retention — label + number input `:122-132`.
4. Scan per-folder checkbox `:134-142`.
5. Scan global checkbox `:144-152`.
6. Default model — caption + ModelSelector primitive + clear (×) button `:154-175`.
No groups, no notices, no footer.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Default run visibility | native `<select>` `:111` | `defaultVisibility` (default `hidden`) | none (option labels carry explanation: "hidden (off the board, watch in Automations)" / "shown (render as a normal board card)" `:117-118`) | — | n/a |
| Run retention (keep last N per automation) | native `<input type=number min=1>` `:124` w-24 | `retentionPerAutomation` (default 100) | none | runs (in label) | clamp `Math.max(1, Number(v) \|\| 100)` `:128` — clearing field snaps to 100 silently; no error |
| Scan per-folder automations (`<repo>/.pi/automation/`) | native checkbox `:135` | `scanFolderScope` (default true) | none; path in inline `<code>` inside label | — | — |
| Scan global automations (`~/.pi/automation/`) | native checkbox `:145` | `scanGlobalScope` (default true) | none; path in `<code>` | — | — |
| Default model (fallback for unresolved `@role`) | custom: `ModelSelector` UI primitive `:159` + clear `<button>` mdiClose `:165` | `defaultModel` (default "") | none; placeholder "Select a model…" | — | none |

Label for Default model is a `<span>`, not `<label>` — deliberately sibling (comment `:156-157`); no programmatic association to picker.
Label text split: `t("defaultModelLabel")` = "Default model (fallback for unresolved" + `<code>@role</code>` + literal ")" `:155` — i18n string broken mid-phrase.

## Status & read-only displays
None.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| (× icon) aria "Clear default model" | icon button, `text-[var(--text-tertiary)] hover:text-[var(--text-primary)]` `:165-173` | `setDefaultModel("")` (draft only) | no; always enabled even when empty |

## Save model
Host Save bar via `useSettingsDraftSource({id:"plugin:automation", isDirty, commit, reset})` `:102`. `commit` sends `plugin_config_write` with all 5 keys `:80-93`. `reset` restores baseline `:94-101`. Local state seeded once from config `:52-60` (no re-sync on late hydration — base values recompute but draft doesn't).

## States
- Only one state: form. No loading/error/empty.
- Model catalogue empty (roles config not hydrated) → picker shows placeholder "Select a model…" with empty list; no notice.
- Commit failure → handled by host Save bar (component shows nothing).

## Protected
data-testid: `automation-plugin-settings`, `automation-default-visibility`, `automation-retention`, `automation-scan-folder`, `automation-scan-global`, `automation-default-model`, `automation-default-model-clear`.
aria: `aria-label` on clear button `:168`. Keyboard: none custom.
i18n namespace `plugin.automation.*` (catalog `src/i18n.ts`): `settingsGlobalNote`, `defaultVisibilityLabel`, `visibilityHiddenOption`, `visibilityShownOption`, `retentionLabel`, `scanFolderLabel`, `scanGlobalLabel`, `defaultModelLabel`, `defaultModelPlaceholder`, `defaultModelClear`.
Draft source id `plugin:automation`.

## Off-contract
- Native `<select>` not via kit `:111-119` (`bg-[var(--bg-primary)]`, kit uses `--bg-tertiary`, no focus-ring).
- Native `<input type=number>` not via kit `:124-131`.
- Native `<input type=checkbox>` ×2 not via kit `:135,:145`.
- Labels are wrapping `<label>` (no `htmlFor`); no hints, no `aria-describedby` anywhere.
- Default-model caption is `<span>` with no `id`/`aria-labelledby` link to picker `:155`.
- Inline `<code>` path fragments glued into checkbox labels `:141,:151` and `<code>@role</code>` splitting i18n string `:155` (translation can't reorder; literal ")" outside `t`).
- Explanatory text crammed into `<option>` labels `:117-118` instead of hint.
- Retention silent clamp/snap-to-default on invalid `:128` — no validation message.
- Clear button `text-[var(--text-tertiary)]` icon, ~10px hit target (size 0.6) `:169,:172`.
- All controls `text-xs` (12px) — OK size; no font < 11px.
- No raw hex / palette classes. No duplicated header.

## Kit mapping
- Intro → keep `<p>` text-secondary, or `SettingsNotice tone="info"`.
- Default run visibility → `SelectField` (options "Hidden" / "Shown"; move explanation to `hint`).
- Run retention → `NumberField` (min 1, unit "runs", error instead of clamp).
- Scan folder / scan global → `ToggleField` ×2 with path as `hint` (mono). Optionally wrap both in `SettingsGroup title="Scan scopes"`.
- Default model → `FieldShell` with custom control (ModelSelector primitive + clear button) — custom (needs recipe): kit has no model-picker field; FieldShell `control` render-prop supplies `id`/`describedBy`.
