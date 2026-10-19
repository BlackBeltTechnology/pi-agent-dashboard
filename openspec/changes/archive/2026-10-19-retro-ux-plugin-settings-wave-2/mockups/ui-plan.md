# UI plan — retro-ux-plugin-settings-wave-2

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`. Method: change `retro-ux-plugin-settings-forms` (wave 1) — same field anatomy, same probes.
Board: `plugin-settings-wave-2.html` (16 surfaces, 44 states, 89 findings). As-built = live captures `asbuilt/<id>.{light,dark}.png` (2026-10-18, :8000). Proposed = HTML on `tokens.css` (GENERATED from `packages/client/src/index.css` + nord from wave 1; regenerate, do not hand-edit).
Harvest (source facts, line refs, protected testids): `harvest/<id>.md`, one per surface + `harvest/host-chrome.md`.

## Scope

Every plugin settings page body NOT yet on the runtime field kit, plus the host chrome around all of them.

| Verdict | Surfaces |
|---|---|
| Host | `PluginSettingsPage.tsx` chrome (+ `PluginsSection` index row tokens) |
| Redesign | apple-tools · browser · chat-gateway · flows-anthropic-bridge · automation · blackhole · cost-estimator · grammar · quota |
| Polish | obs-studio · mcp-client · system-one · goal · flows · subagents |
| Out (already on kit, wave 1) | context-mode-settings · hermes-memory · gmail |

## Cross-cutting findings → rule → decision

| # | As-built | Rule broken | Proposed |
|---|---|---|---|
| X1 | 12 of 15 bodies use native `<input type=checkbox>` / `<select>` / bare inputs, own label/hint anatomy | Nielsen #4 consistency; `ui-contract.md:195` settings-field recipe | every field through the runtime kit (`ToggleField`, `SelectField`, `NumberField`, `TextField`, `TextAreaField`, `FieldShell` for custom controls) |
| X2 | 6 bodies repeat the plugin title and/or id the host chrome already shows (apple-tools, flows-anthropic-bridge, grammar, quota, system-one, mcp-client near-dup) | Nielsen #8 minimalist design; D3 | body never repeats identity; lint enforces |
| X3 | 8 plugin trees have no `@source` line in `index.css` (apple-tools, blackhole, browser, chat-gateway, cost-estimator, flows-anthropic-bridge, grammar, quota) → Tailwind drops their classes (grammar padding, chat-gateway grid) | `client-build-config` (one `@source` per client-bearing plugin) | add the 8 lines (D6) |
| X4 | Hard-coded hex / rgba / zinc (apple-tools, flows-anthropic-bridge, quota), `--accent-<hue>` as text (blackhole, mcp-client, host chrome), palette classes (`amber-500`, `accent-blue-500`) | `ui-contract.md:78-86` | severity / tint tokens only; `theme-token-guard` scans every plugin tree (D7) |
| X5 | Status as 10 px words or raw enums (`OS_TOO_OLD`, `waiting_peers`, `needs-auth`, `stopped`) | type floor `ui-contract.md:145`; Nielsen #2 | NEW kit `SettingsStatusPill`: tone + icon + human word |
| X6 | Raw error codes / `err.message` / `HTTP 500: {body}` shown to users | Nielsen #9 | human sentence + Try again; raw detail behind “Copy details” |
| X7 | In-body “Enabled” switches that look like the host Enabled switch (browser, chat-gateway, grammar, quota) | Nielsen #4; WCAG 2.4.6 descriptive labels | rename to what they do (“Relay connections”, “Answer Discord messages”, “Check grammar in the composer”, “Check quotas”) |
| X8 | Four save models: host Save bar, own mid-page Save (chat-gateway, flows-anthropic-bridge), per-keystroke write (cost-estimator), blur write (apple-tools path) | Nielsen #4 + #3 (user control) | config fields → host Save bar; immediate only for side-effect actions (D4 table) |
| X9 | Kit `SettingsGroup` summary meta is `text-[11px]` inside an interactive `<summary>` | 12 px interactive floor (probe `sizeFailures`) | meta → 12 px (kit fix, found while probing — audit B1) |

## Save model per surface (D4)

| Surface | As-built | Proposed |
|---|---|---|
| automation, blackhole, grammar, quota, flows, subagents, system-one (draft part) | host Save bar | unchanged |
| chat-gateway | own Save button | host Save bar (`plugin:chat-gateway`) |
| flows-anthropic-bridge | own Save button | host Save bar (`plugin:flows-anthropic-bridge`) |
| cost-estimator | write per keystroke | host Save bar (`plugin:cost-estimator`) |
| apple-tools path | write on blur | host Save bar (`plugin:apple-tools`) |
| browser (token, zero-dialog, domains, connect) | immediate REST, no feedback | immediate (side-effect actions), + per-profile error notice |
| mcp-client (row switch, editor Save) | immediate / modal Save | unchanged (modal owns its form) |
| goal | localStorage, immediate | unchanged; “This browser” pill says so |
| system-one keys, Start/Stop, calibration | immediate | unchanged |

## NEW kit members (D2)

`SettingsStatusPill` (tone + icon + word) · `SettingsItem` (repeatable entity card: title, sub, status pills, actions, collapsible body) · `SettingsFacts` (read-only `<dl>`) · `SettingsTable` (read-only table, horizontal scroll). Mirrors in the board: `pill()`, `item()`, `facts()`, `table()` in `board-lib.js`.

## Protected (preserve)

Every `data-testid` listed under `## Protected` in `harvest/<id>.md` (and `harvest/host-chrome.md`), all i18n keys, settings keys and file formats, `useSettingsDraftSource` ids already in use (`plugin:automation`, `plugin:blackhole`, `plugin:grammar`, `plugin:quota`, `plugin:flows`, `plugin:subagents`, `plugin:system-one`), routes `/settings/plugins/<id>`, REST routes. Renamed visible labels keep their testids.

## Findings by surface

### Host chrome (every plugin page) — redesign

States: `full · enabled`, `missing requirement (apple-tools)`, `disabled`, `load failed + developer internals`.

| # | As-built → proposed |
|---|---|
| H1 | `claims:` chip = developer data on an end-user page → hidden; shown under “Plugin internals” only when Developer ▸ Show plugin internals is on. |
| H2 | Status pill + id + `enable` label at 10 px, id in `--text-muted` → 11/12 px `--text-secondary`; status pill only when unhealthy (compact-header precedent), human words: Off · Needs setup · Not loaded · Failed to load. |
| H3 | Native checkbox `accent-blue-500` + lowercase `enable` → kit switch with label “Enabled”. |
| H4 | WARN/ERR/OK/LINK paint `--accent-*` fill as text → severity tokens (`SettingsNotice` recipe for banners). |
| H5 | “← Plugins” sits at the page bottom in muted 12 px → breadcrumb above the chrome card, `--text-secondary`, 32 px target. |
| H6 | Card `rounded` → `rounded-xl` card root; title `text-base` → `text-lg` (contract title step). |
| H7 | Body has no host wrapper → host wraps body in `grid gap-3` so every plugin gets the same vertical rhythm; rule + lint: body never repeats title/id (design D3). |

### Apple Tools — redesign

States: `macOS too old (live)`, `not installed`, `installed`, `status unavailable`.

| # | As-built → proposed |
|---|---|
| AT1 | Second header “Apple Tools (iMCP)” + id repeats host chrome → removed (D3). |
| AT2 | Raw state `OS_TOO_OLD` in mono → status pill with a human word + a callout that names the fix. |
| AT3 | Amber `#fbbf24`/red `#f87171`/`#a1a1aa` inline hex, 10–11 px → severity notices, 12 px. |
| AT4 | Path is a bare `<label>`+input saved on blur, no feedback → kit `TextField` (stacked, mono, Default pill + Reset) on the host Save bar (D4). |
| AT5 | “Run installer” unstyled, no busy/result → primary button with busy state + result notice. |
| AT6 | Raw `status request failed (404)` → human error + retry; code kept behind “Copy details”. |

### Browser Relay — redesign

States: `profiles (live)`, `paired + connected`, `relay off`, `write failed`.

| # | As-built → proposed |
|---|---|
| BR1 | “Enabled” checkbox collides with the host Enabled switch → “Relay connections” switch with a hint that says what it blocks. |
| BR2 | Status column = three 10 px tertiary words → status pills (word + icon) in the card header. |
| BR3 | Every profile fully expanded (page ≈ 5 000 px) → collapsible profile cards; profiles with the extension open, others grouped and collapsed. |
| BR4 | Token input has no label; zero-dialog disabled with no reason → kit fields with labels; disabled hint says “Pair this profile first”. |
| BR5 | Default blue underlined link → contract `p-link`; Connect as secondary; Revoke (This computer) as danger. |
| BR6 | Write failures are unhandled rejections; any toggle failure blanks the page → per-profile error notice + Try again; page-level error keeps the form. |
| BR7 | AUDIT 10 px caption, raw `kind` → collapsed “Activity” group, human event words. |

### Chat Gateway — redesign

States: `not set up (live)`, `running`, `invalid before save`, `team disarmed`.

| # | As-built → proposed |
|---|---|
| CG1 | No grouping → 4 groups: Discord connection · Where sessions run · Who can use it · Behaviour; read-only blocks after. |
| CG2 | Jargon in labels (`allowedRoots`, L1/L2/L4, `channelKey`) → plain labels; the term moves into the hint. |
| CG3 | “Enabled” duplicates the host switch → “Answer Discord messages”. |
| CG4 | Own Save button mid-page, notice shows raw `err.message` → host Save bar (D4); errors per field. |
| CG5 | Empty allowed folders give no warning; malformed map lines silently dropped → warning notice (non-blocking) + map-line field error before save. |
| CG6 | No status → header pill: Not set up / Running / Paused. |
| CG7 | Team controls “armed / ceiling observe” words, raw outcome → status pills; Re-arm next to the Disarmed pill. |
| CG8 | Missing `@source` line → `sm:grid-cols-3`, `max-w-*`, `--danger-text` (undeclared token) never render (D6). |

### Anthropic Messages Bridge — redesign

States: `no sessions (live)`, `active`, `degraded + changed gate`.

| # | As-built → proposed |
|---|---|
| FAB1 | Status bar `rgba(63,63,70,.5)` + `#a1a1aa` → `SettingsNotice` by tone (info / success / warning) with Refresh. |
| FAB2 | Repeats title + 10 px id inside a nested card → removed (D3). |
| FAB3 | Two checkboxes can both be on (force + disable = contradiction) → one 3-way “Bridge gate” control; env var in the hint. |
| FAB4 | Own Save, no busy/feedback, invisible to host Save bar → host Save bar (D4). |
| FAB5 | Table: raw enums (`waiting_peers`), ✓/✗ glyphs, literal “PID” → status pills + words. |
| FAB6 | No loading state (shows “no sessions” while fetching) → “Checking sessions…” notice. |

### OBS Studio — polish

States: `none provisioned (live)`, `provisioned + warnings`, `load error`.

| # | As-built → proposed |
|---|---|
| OB1 | Literal `` `pi-obs provision` `` backticks → `<code>` + Copy command. |
| OB2 | Raw state (`stopped`, `stop-failed`) without label → status pill with a human word. |
| OB3 | Exposure + recovery warnings are coloured `<p>` → `SettingsNotice` warning. |
| OB4 | Instance = bold div + dl → `SettingsItem` (title, status pill, facts, Open panel). |
| OB5 | Load error `Request failed: {code}` → human error + Try again; `Suspense fallback={null}` → “Loading…”. |

### MCP Client — polish

States: `empty (live)`, `populated`.

| # | As-built → proposed |
|---|---|
| MC1 | Two “Add server” buttons (toolbar + empty state), neither primary → one primary per state; toolbar keeps Refresh. |
| MC2 | Row metadata = 10 px tertiary words, raw live enum (`needs-auth`) → neutral pills for transport/exposure + a live status pill. |
| MC3 | `--accent-primary` / `amber-500` text (badge, docs link, warnings) → `p-link`, severity pills/notices. |
| MC4 | Editor labels = raw schema keys (`oauth.clientSecret`), no hints → kit fields with human labels + key chip (follow-up, editor only re-skinned here). |
| MC5 | “MCP servers” h3 near-repeats the host title → section heading recipe 12 px. |

### Automations — redesign

States: `populated (live)`, `no models available`.

| # | As-built → proposed |
|---|---|
| AU1 | Native select / number / checkboxes, no hints, no `aria-describedby` → kit fields with hints. |
| AU2 | Explanations crammed into option labels (“hidden (off the board, watch in Automations)”) → short options + hint. |
| AU3 | Paths in labels as `<code>`, i18n string split mid-phrase “(fallback for unresolved @role)” → label + hint. |
| AU4 | Retention silently snaps to 100 on bad input → field error “Enter 1 or more.” |
| AU5 | Model label is a `<span>` not tied to the picker → `FieldShell` custom control. |

### Blackhole — redesign

States: `populated (live)`, `group open + invalid value`, `file can't be parsed`, `not installed`.

| # | As-built → proposed |
|---|---|
| BH1 | Group summaries flush on the border, no chevron → kit `SettingsGroup` (padding, chevron, 44 px). |
| BH2 | 20 fields with own `FieldRow` (`<span>` label, 11.5 px help, 10 px DEFAULT) → kit fields with key chip + Default pill + Reset. |
| BH3 | `--accent-green` path chip, `--accent-red` errors/✕, `--accent-blue` staged notice → neutral chip, severity tokens, danger-ghost icon button. |
| BH4 | Apply note box has no icon/severity → `SettingsNotice` info. |
| BH5 | Retry button inside a `<summary>`; ✕ / ⚠️ glyphs as icons → actions moved into the notice; mdi icons. |
| BH6 | Raw `503`, parser message in red `<pre>`, raw save error → human text + Copy details. |
| BH7 | Chain rows: 10 px PRIMARY, ✕ in accent red → 11 px neutral pill; 32 px icon buttons with names. |

### Cost — redesign

States: `plan (live)`, `custom plan, invalid`.

| # | As-built → proposed |
|---|---|
| CO1 | Borderless native select/number (preflight `border:0`) → kit controls; inputs look editable. |
| CO2 | Intro at `opacity:.65` 11 px → lead 12 px `--text-secondary`. |
| CO3 | No hints; “Break threshold” unexplained → hint “Idle gaps longer than this don't count as active time.” |
| CO4 | Writes `plugin_config_write` per keystroke, clearing writes 0 (below min) → host Save bar draft + field errors (D4). |
| CO5 | Fallback `?? anthropic-max-20x` shows a plan that isn't stored → show the stored value; unset = Metered (default pill). |

### Grammar & Spelling — redesign

States: `populated (live)`, `no model`, `invalid advanced value`, `load error`.

| # | As-built → proposed |
|---|---|
| GR1 | Repeats title + `grammar` id (10 px muted) → removed (D3). |
| GR2 | Group content flush on the border (missing `@source`), static ▸ caret → kit `SettingsGroup` (D6). |
| GR3 | “Enabled” duplicates the host switch → “Check grammar in the composer”. |
| GR4 | Native controls, no hints; “Model” `<span>` unlinked → kit fields. |
| GR5 | 9.5–10.5 px text in the recommended list, `--text-muted` help → table at 12 px, severity pill. |
| GR6 | No min < max check; load error swallowed; raw “grammar config save failed (500)” → field error, load-error notice, human save error. |

### Provider Quota — redesign

States: `populated (live)`, `retries on`.

| # | As-built → proposed |
|---|---|
| QU1 | Repeats title + id inside a bordered card → removed (D3). |
| QU2 | “Enable quota tracking” duplicates the host switch → “Check quotas” with a hint. |
| QU3 | ToS warning = 10 px `#fbbf24` “⚠ Warning”, body only in `title` (keyboard/touch can't read it) → visible warning notice above the provider list. |
| QU4 | Provider reasons 10 px muted → status pills (Signed in · Not signed in · Refused · No quota). |
| QU5 | Native checkboxes + inline-styled number inputs, ms in label text → kit switches + `NumberField` with unit chips + ranges in hints. |
| QU6 | Schedule preview 10 px muted → info notice, 12 px. |

### Decision models (System 1) — polish

States: `populated (live)`, `load error`, `changed on disk`.

| # | As-built → proposed |
|---|---|
| S1-1 | `<h3>` “Decision models (System 1)” repeats the host title → removed; lead + file chip stay (D3). |
| S1-2 | Four elevated cards inside the host card → kit `SettingsGroup`s (no nested shadows). |
| S1-3 | Every button same `smBtn` → hierarchy: Remove backend = danger-ghost, Run test = primary inside its group only. |
| S1-4 | Raw codes: “Could not load the System-1 config (E_PARSE)”, key-save `ApiError.code`, literal “error” → human text + Copy details. |
| S1-5 | Bad backend id/URL sets `aria-invalid` with no message → field error text. |
| S1-6 | Native select “No more backends” + “Add to chain” → keep, kit `SelectField` styling. |

### Goal — polish

States: `default (live)`.

| # | As-built → proposed |
|---|---|
| GO1 | Native checkbox, label/hint inside one `<label>` → kit `ToggleField`. |
| GO2 | Install hint in `--text-muted` → lead in `--text-secondary`. |
| GO3 | Setting lives in localStorage but the UI doesn't say so → “This browser only” pill; stays immediate (D4 exception). |

### Flows — polish

States: `default (live)`.

| # | As-built → proposed |
|---|---|
| FL1 | Native checkbox, em-dash label → kit `ToggleField` with a short label + hint. |
| FL2 | Intro/hint hard-coded English, `--text-muted` → `t()`, `--text-secondary`. |

### Subagent Inspector — polish

States: `default (live)`.

| # | As-built → proposed |
|---|---|
| SA1 | Roles notice = grey box, no icon/role, 7 i18n fragments, “Roles” not a link → `SettingsNotice` info + “Open Model roles” button. |
| SA2 | Intro shows internal package `pi-dashboard-subagents` → plain lead. |
| SA3 | 11 px tertiary text + native checkbox → kit `ToggleField`, 12 px secondary hint. |
| SA4 | Save error “HTTP 500: {body}” → human message (host Save bar). |
