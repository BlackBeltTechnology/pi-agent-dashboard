# Harvest — apple-tools (`AppleToolsSettings.tsx`, 212 lines)

## Purpose
Provisioning surface for iMCP (Apple tools MCP server): shows checker state, offers Run installer + `imcpServerPath` override, links to mcp-client for enable/exposure. No per-service toggles (TCC menu-bar only).

## Structure
Claim: `settings-section`, no `tab` → renders under own row in Plugins tab. Single `<section>` w/ inline style border box `:116-124`.
1. Header row `:125-128` — `<h3>` "Apple Tools (iMCP)" + `<span>` "apple-tools". **DUPLICATES host title + id.**
2. Missing-dep banner (if `missingDeps.length>0`) `:130-138` — "Missing dependency: `<code>mcp-client</code>`. Provisioning needs it. [Enable it in Plugins] first."
3. Status line `:140-145` — monospace `status.state` or "…".
4. Status message `:146-148` — `status.message` (server copy) grey.
5. Fetch error `:149-156` — "Could not read provisioning status: {fetchError}".
6. Branch `!isMac` `:158-161` → "iMCP is macOS-only. Nothing to provision on this platform." (ends).
7. Else (mac) `:163-208`:
   - missingDeps → nothing; `!status.appPresent` → needs-CLI notice `:169-175` "iMCP is not installed. Run `<code>pi-apple-tools-install</code>` in a terminal to install it, then reload this panel."; else [Run installer] button `:177-183`.
   - Path field `:186-195`.
   - Manage link para `:197-202` "Manage MCP servers — enable/disable iMCP and pick its direct tools there."
   - Footer note `:204-207` "Apple service permissions (Calendar, Contacts, …) are granted only in the iMCP menu-bar app and cannot be automated. This panel does not toggle individual services."

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| imcp-server path override | native `<input>` (text) wrapped in `<label>` `:186-195` | `imcpServerPath` (default `/Applications/iMCP.app/Contents/MacOS/imcp-server` `:21`) | none | none | none; saved on blur, no error surfaced; empty string saves as-is |

## Status & read-only displays
- `status.state` raw word (e.g. checker terminal state) `:144` — 12px monospace, no colour, no pill. Placeholder "…".
- `status.message` `:147` — 11px `#a1a1aa`.
- missing-deps text `:133` — 11px `#fbbf24` (amber).
- needs-CLI / unsupported notices `:159,:171` — 11px `#fbbf24`.
- error `:152` — 11px `#f87171`.
- id span `:127` — 10px `#71717a`.
- `resolvedPath`, `imcpServerPath` from StatusReadout fetched but NOT rendered.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Run installer | unstyled native button (11px, padding 3px 10px) `:177-183` | `plugin_action` `run-installer`, then `refresh()` after 500 ms `:110-113` | no; no busy/result feedback |
| Enable it in Plugins | link `href=/settings/plugins` `:136` | full-page nav (plain `<a>`) | — |
| Manage MCP servers | link `href=/settings/plugins/mcp-client` `:198` | full-page nav | — |

## Save model
Immediate per-control: `onBlur` → `saveConfig` → `send({type:"plugin_config_write", id, config:{...config,...partial}})` `:105-107,:192`. NO `useSettingsDraftSource`; host Save bar unaware. No saved/failed feedback.

## States
- loading: status line "…" `:144`; isMac defaults true `:103` so controls render before status.
- load-error: "Could not read provisioning status: status request failed (404)" (raw HTTP code `:88`) or exception message.
- non-mac: "iMCP is macOS-only. Nothing to provision on this platform."
- not-installed (`appPresent:false`): needs-CLI notice, Run installer hidden.
- missing dep: banner; Run installer + needs-CLI both hidden `:164`.
- configured/ok: state word + message + Run installer.
- busy after Run installer: none (silent 500 ms refetch).
- missingDeps fetch failure → silently empty `:60-62`.

## Protected
data-testid: `apple-tools-settings`, `apple-tools-missing-deps`, `apple-tools-status`, `apple-tools-error`, `apple-tools-unsupported`, `apple-tools-needs-cli`, `apple-tools-run-installer`, `apple-tools-path`, `apple-tools-manage-mcp`.
aria: none. Keyboard: none. i18n: NONE — no `useT`, no catalog (manifest has no `i18nCatalog`); all strings hard-coded English.
Tests: `src/client/__tests__/AppleToolsSettings.test.tsx` (83 lines).

## Off-contract
- Whole component inline `style={}` instead of tokens/Tailwind `:118-207`.
- Raw rgba border `rgba(82, 82, 91, 0.5)` `:120`.
- Raw hex: `#71717a` `:127,:204`; `#fbbf24` `:133,:159,:171`; `#a1a1aa` `:147`; `#f87171` `:152`.
- Font sizes < 11px: `10px` id `:127`, footer note `10px` `:204`.
- Duplicated title/id heading `:125-128` (host chrome owns).
- Own bordered card box `:119-122` nested in host row (double chrome).
- Label without `htmlFor` (wrapping label, OK-ish) `:186`; no hint/aria-describedby; input has no default/reset affordance.
- Raw error code shown: "status request failed (404)" `:88`.
- Raw server state token shown as-is (`status.state`) `:144` — no human label / severity pill.
- Notices are plain `<p>` with colour only — no icon, no `role="status"/"alert"`.
- Run installer: unstyled native button, no busy/disabled state, no success/failure feedback.
- Links are plain `<a href>` (full reload, not router).
- No i18n.

## Kit mapping
- Header `:125-128` → DELETE (host chrome).
- Missing-dep banner → `SettingsNotice tone="warning"` (with link child).
- Status state + message → custom (needs recipe): status row w/ severity pill + message; no kit element for status readout.
- Fetch error → `SettingsNotice tone="error" role="alert"`.
- Non-mac → `SettingsNotice tone="info"` (or warning).
- Needs-CLI → `SettingsNotice tone="warning"` w/ `<code>` command (copyable recipe).
- Run installer → custom (needs recipe): kit has no button; use host secondary-button classes + busy state.
- Path override → `TextField mono` (+ hint: default path; save model must move to `useSettingsDraftSource`).
- Manage link → custom link row (or `SettingsNotice tone="info"`).
- Footer note → `SettingsNotice tone="info"` or hint text in `--text-secondary`.
