# Harvest — mcp-client (`packages/mcp-client-plugin/src/client/McpSettings.tsx` 122 + `ServerList.tsx` 633 + `ServerEditor.tsx` 916)

## Purpose
Pi-global MCP server list: per-server enable switch, live state, add/edit via schema-driven modal editor. No global plugin options.

## Structure
1. `<section data-testid="mcp-settings" space-y-2>` `McpSettings.tsx:63`.
2. Toolbar row: `<h3>` "MCP servers" (text-sm semibold) `:65-67` (semi-duplicates host title "MCP client"); "Refresh" button `:68-76`; "Add server" button ml-auto `:77-84`.
3. Not-allowed `<p role=alert>` `:87-91`; other-error `<p role=alert>` `:93-101`.
4. `ServerList` `<ul data-testid="mcp-server-list">` `ServerList.tsx:572`:
   - broken-layer rows first (`mcp-layer-error`) `:573-580`.
   - server rows sorted by name `:556-558` (`ServerRow` `:105-484`), one-line flex-wrap: switch · name · description · transport `<code>` · exposure · authmode · provenance badge · optional "overrides Pi global" / "folder entry" / override badges / Reset · live text · sign-in hint · leftovers badge + Convert · action button (Edit / Remove / ⋯ Actions menu) `:201-430`.
   - sub-lines: pi error `:433-440`, pending note `:442-446`, legacy strip `:447-466`, inactive reason `:467-471`, row write error `:472-481`.
   - empty `<li data-testid="mcp-empty">` `:605-627`.
5. `ServerEditor` modal (when editing !== null) `McpSettings.tsx:114-119` → `ServerEditor.tsx:275-323`: backdrop button, dialog `<h2>` title, name field, summary error, skeleton, omitted warnings, OAuth warning, transport tabs (command|url), common FieldRows, `<details>` "Advanced", "Other fields (JSON)", footer Save/Close.
Global settings page renders only rows w/o folder props (no menu/reset/chips — those are folder page `FolderMcpPage.tsx`).

## Fields
Row (immediate write):
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| aria-label "Enable {name}" (no visible label) | native checkbox `role="switch"` w-4 h-4 `ServerList.tsx:203-219` | `mcpServers.<name>.enabled` via `setEnabled` | `title` only when disabled | — | refusal/ApiError → inline `mcp-server-error-{key}` `:472-481`, optimistic revert `:143-170` |
Editor (`ServerEditor.tsx`), label = raw schema key `field.name` `:519` (e.g. `command`, `args`, `env`, `oauth.clientSecret`), no hint/description text:
| Server name | native text input; visible `<span>` + `aria-label` (no htmlFor) `:376-394` | entry name | none | — | required / `isValidServerName` → `mcp-editor-name-error`; "Server name is required." `:227` |
| text widget | native input `:591-604` | schema path | none | — | per-field error `mcp-field-error-{name}` `:527-531` |
| secret text | native input masked + Show/Hide button `:606-631,:575-589` | x-secret / credential keys | none | — | same |
| number | native number `:633-653` | | none | — | same |
| boolean | native checkbox w-4 h-4 `:655-670` | | none | — | — |
| enum | native `<select>` w/ "(inherit)" `:672-695` | e.g. `exposure` | none | — | — |
| string-list | rows of inputs + "Remove row" ✕ + "+ Add" `:697-740` | `args` | none | — | — |
| record | key input + value input/select/textarea JSON + remove + "+ Add" `:742-847` | `env`, `headers`, `toolExposure` | none | — | — |
| json fallback | textarea `:849-873` | any unmapped | none | — | JSON parse error |
| Other fields (JSON) | textarea per unknown key `:875-915` | unknown keys | none | — | `mcp-unknown-field-error-{key}` |
Auth on project scope: replaced by text "provider auth is global-only: pi reads auth only from ~/.pi/agent/mcp.json, so a folder entry cannot set it." `:519-523`.

## Status & read-only displays (ServerList.tsx)
- transport `<code>` "command"/"url" 10px `--text-tertiary` `:229-231`.
- exposure word 10px tertiary `:232-234`.
- authmode "auth: {provider}" / "header" / "OAuth" 10px tertiary `:236-243`.
- provenance pill "Pi global"/"Pi folder" 10px border-secondary text-secondary `:245-250`.
- "overrides Pi global" pill 10px `border/text-[var(--accent-primary,#60a5fa)]` `:252-258`.
- live: "{state} · {n} tools" / "not checked by pi" / "state unknown" 10px tertiary `:299-303`; state raw enum word (e.g. `needs-auth`).
- sign-in hint "sign in: /mcp login {name}" 10px secondary `:304-311`.
- leftovers pill "ignored by pi: a, b" 10px `border-amber-500 text-amber-500` `:313-320`.
- pi error / layer error / row error: 11px `--status-error,#f87171` `:437,:577,:478`. Layer: "`<path>`: {message} — pi skips this file."
- inactive: "project not trusted" / "auth is global-only" / "name collision" 11px secondary `:49-61,:467-471`.
- Editor: OAuth warning + omitted warnings 11px `text-amber-500 border-amber-500` box `ServerEditor.tsx:305-316,:344-362`; summary error box `#f87171` + raw "{field}: {message}" lines `:397-418`.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Refresh | secondary 11px, `title` tooltip | reload config + `/live` `McpSettings.tsx:68-76` | no |
| Add server | secondary 11px (not primary) | open editor add | no |
| Edit (row) | secondary 11px | open editor `ServerList.tsx:419-428` | no |
| Convert (leftovers) | secondary 10px | `convertServer` `:322-331` | no |
| Add server (empty) | secondary | open editor `:612-619` | no |
| MCP configuration docs | link, `--accent-primary` text, external github `:620-627` | — | — |
| tabs command / url | segmented, active = accent border/text `ServerEditor.tsx:434-458` | switch transport, clears other keys | no |
| Show/Hide | secondary toggle `aria-pressed` | reveal secret | no |
| + Add / ✕ Remove row | secondary | list/record edit | no |
| Save | "primary" = accent outline only `:70,:474-481` | `saveServer` | no |
| Close / backdrop / Esc | secondary | `attemptClose` | `window.confirm("Discard unsaved changes?")` if dirty `:212` |
No delete-server action on global page.

## Save model
Mixed: row switch = immediate per-control write (optimistic) `ServerList.tsx:139-171`; editor = explicit modal Save `ServerEditor.tsx:474-481`. No `useSettingsDraftSource` — host Save bar unused.

## States
- Loading: `mcp-list-skeleton` 3 pulse bars `ServerList.tsx:487-499`; editor schema loading `mcp-editor-loading`.
- Not-allowed: "This folder is not tracked by the dashboard." (11px, no colour) `McpSettings.tsx:88-90`.
- Load error: "Could not load MCP configuration: {message}" `:99`.
- Empty: "No MCP servers configured." + Add server + docs link `ServerList.tsx:605-627`.
- Live loading: live span hidden; live absent → "state unknown".
- Row busy: switch `aria-busy`, disabled.
- Editor invalid: "Fix the errors before saving." `ServerEditor.tsx:237`.

## Protected
testids: `mcp-settings`, `mcp-refresh`, `mcp-add-server`, `mcp-not-allowed`, `mcp-error`, `mcp-server-list`, `mcp-layer-error`, `mcp-list-skeleton`, `mcp-empty`, `mcp-empty-add`, `mcp-docs-link`, `mcp-server-row-{name}`, `mcp-server-toggle-{key}`, `mcp-server-description-{key}`, `mcp-transport-{key}`, `mcp-exposure-{key}`, `mcp-authmode-{key}`, `mcp-badge-{key}-{Pi global|Pi folder}`, `mcp-badge-{key}-overrides Pi global`, `mcp-live-{key}`, `mcp-signin-hint-{key}`, `mcp-leftovers-{key}`, `mcp-convert-{key}`, `mcp-server-action-{name}`, `mcp-pi-error-{key}`, `mcp-inactive-{key}`, `mcp-server-error-{key}`; folder-only: `mcp-folder-*` (row, action, menu, menu-pop, project-settings, reset, convert, override-chip, chip-remove, pending, legacy-strip), `mcp-override-badge-{key}-{k}`. Editor: `mcp-editor-dialog`/`mcp-folder-editor`, `mcp-editor-backdrop`, `mcp-field-name`, `mcp-editor-name`, `mcp-editor-name-error`, `mcp-summary-error`, `mcp-editor-loading`, `mcp-omitted-warnings`, `mcp-omitted-{dotted}`, `mcp-oauth-warning`, `mcp-tab-{command|url}`, `mcp-field-{name}`, `mcp-field-input-{name}`, `mcp-field-error-{name}`, `mcp-global-only-auth`, `mcp-reveal-{name}`, `mcp-list-input/remove/add-*`, `mcp-record-*`, `mcp-advanced`, `mcp-unknown-fields`, `mcp-unknown-field-input/error-{key}`, `mcp-editor-footer`, `mcp-save`, `mcp-editor-close`.
aria: switch `role=switch aria-label aria-busy`; dialog `role=dialog aria-modal aria-label`; tablist/tab `aria-selected`; menu/menuitem `aria-haspopup aria-expanded`; Esc closes dialog + menu.
i18n ns `plugin.mcp-client.*` via `useT` fallbacks only — no catalog file found; many strings hard-coded English (`ServerList.tsx` row vocabulary, "Add server" empty, "Edit", "Convert").

## Off-contract
- Palette Tailwind `amber-500` text/border: `ServerList.tsx:316`, `ServerEditor.tsx:308,:348`.
- Hex fallbacks `#60a5fa` `ServerList.tsx:254,262,282,293,624`, `ServerEditor.tsx:67,70,452`; `#f87171` `McpSettings.tsx:97`, `ServerList.tsx:437,478,577`, `ServerEditor.tsx:71,408`; `#27272a` `ServerList.tsx:493`, `ServerEditor.tsx:426`.
- `--accent-primary` used as TEXT colour: badges `ServerList.tsx:254,262,282`, docs link `:624`, primary btn + active tab `ServerEditor.tsx:70,452`.
- `--status-error` not severity token (`--severity-error-fg`).
- 10px text: `ServerList.tsx:229,232,236,247,254,262,300,307,316,327`.
- `--text-tertiary` for readable status (transport/exposure/live) `:229-300`.
- Native checkbox w-4 h-4 as switch `:203-219`, `ServerEditor.tsx:660`; native `<select>` `:680,:772`; all inputs custom `INPUT_CLS`, no kit.
- No `htmlFor`; labels are `<span>` + `aria-label` `ServerEditor.tsx:377-383,:519`; no hints / `aria-describedby`; errors not linked to inputs.
- Field labels = raw schema keys (`oauth.clientSecret`), no humanised label/description.
- Raw enum words shown to users: live state (`needs-auth`), exposure, `{field}: {message}` summary lines.
- Row = 10+ inline items in one flex-wrap line → dense wrap on narrow.
- `<h3>` "MCP servers" near-duplicate of host title.
- Primary actions (Add server, Save) not visually primary.

## Kit mapping
- Heading → drop; toolbar → custom (needs recipe: list toolbar w/ secondary Refresh + primary Add).
- Errors / not-allowed / layer error → `SettingsNotice tone=error|info`; OAuth/omitted warnings → `SettingsNotice tone=warning`; legacy strip → `SettingsNotice tone=info` + action.
- Server list → custom (needs recipe: entity row — switch + name/desc + status pill + meta chips + overflow actions; two-line layout). Switch → `ToggleField`-style switch control (no label row) — needs kit switch primitive.
- Status words → status pill recipe (severity tokens: ok/needs-auth/failed).
- Editor modal → custom dialog recipe; inside: name → `TextField`; text/secret → `TextField` (+reveal, custom); number → `NumberField`; boolean → `ToggleField`; enum → `SelectField`; json/unknown → `TextAreaField`; string-list/record → custom (needs recipe: key-value repeater); Advanced → `SettingsGroup defaultOpen={false}`; nested-group → `SettingsGroup`.
- Empty → custom empty-state recipe.
