# Harvest — subagents (`packages/subagents-plugin/src/client/SubagentsSettings.tsx`, 116 lines)

## Purpose
One producer setting `inheritContext` (fork parent context into every subagent) + Roles dependency disclaimer for `@fast`.

## Structure
1. Root `<div space-y-3>`; no self-header (comment `SubagentsSettings.tsx:59-61`).
2. Intro `<p>` 11px `--text-tertiary`: "Settings for the " + `<code>pi-dashboard-subagents</code>` + " producer." `:62-66`.
3. Roles notice `<div data-testid="subagents-settings-roles-dep">` 11px tertiary, `border-secondary` rounded, `bg-tertiary`, NO icon, no role `:77-92`: "Configure the `Roles` plugin so the bundled `Explore` agent can resolve `@fast`. If no model is assigned to `@fast`, agents using `@role` aliases report “not configured yet” when a session starts — Subagents still loads." (7 i18n fragments around `<code>`; `Roles` not a link).
4. Checkbox row `<label>` `:94-113`: checkbox + label (sm primary) + description (11px tertiary).
Other producer settings (`exposeInheritanceInTool`, `inheritance.*`) intentionally hidden (file-only) `:5-8` — not disclosed in UI.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Fork parent context into every subagent | native checkbox `mt-0.5` `:95-100` (wrapping label, no htmlFor) | `inheritContext` (dflt true) `:31`; mirrored server-side into `~/.pi/agent/extensions/pi-dashboard-subagents/config.json` | "When on, the subagent inherits a compressed copy of the parent's recent turns. When off, every subagent starts with an empty conversation (isolated)." 11px tertiary `:105-111` (not aria-describedby) | — | save failure throws "HTTP {status}: {detail}" to host bar `:46-50` |

## Status & read-only displays
None (Roles `@fast` resolution state not shown — static disclaimer regardless).

## Actions
None. (No link to Roles plugin settings.)

## Save model
Host Save bar: `useSettingsDraftSource({ id: "plugin:subagents", isDirty, commit, reset })` `:54`; commit `POST /api/config/plugins/subagents` `{ inheritContext }` `:39-52`. Re-adopts baseline while clean `:37`.

## States
- Single state; no loading. Save error → host bar shows "HTTP {status}: {detail}" (raw status + response body) `:49`.

## Protected
- testid: `subagents-settings-roles-dep` only (checkbox has none).
- draft source id `plugin:subagents`; endpoint `/api/config/plugins/subagents`.
- i18n ns `plugin.subagents.*` (`src/i18n.ts`): `saveError`, `producerSettingsPre/Post`, `rolesDepConfigurePre`, `rolesDepPluginResolve`, `rolesDepAgentResolve`, `rolesDepIfNoModel`, `rolesDepAgentsUsing`, `rolesDepAliasesReport`, `forkContextLabel`, `forkContextDescription`.
- aria: none.

## Off-contract
- Notice = grey box, no icon, no severity token, no role `:77-80` (should be `SettingsNotice tone="info"`).
- `--text-tertiary` for readable text: intro `:62`, notice `:79`, description `:105`.
- Native checkbox not via kit `:95`; no htmlFor; description not aria-describedby.
- Raw HTTP status/body as user error `:49`.
- 7-fragment sentence around `<code>` — translation-hostile `:81-91`.
- Intro exposes internal producer package name `pi-dashboard-subagents` (low user value).
- No hex/palette classes; no literal backticks.

## Kit mapping
- Intro → drop or intro text (custom, `--text-secondary`).
- Roles disclaimer → `SettingsNotice tone="info"` (icon), ideally w/ link to Roles plugin settings; single i18n string w/ placeholders.
- Checkbox → `ToggleField` label "Fork parent context into every subagent", hint = description, `keyLabel="inheritContext"` optional.
