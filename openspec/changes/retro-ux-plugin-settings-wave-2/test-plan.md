# Test Plan — retro-ux-plugin-settings-wave-2

Stage: design   Generated: 2026-10-18

Levels: L1 = vitest (`packages/**/__tests__/*.test.ts[x]`, `scripts/__tests__/*.test.mjs`). L3 = Playwright `tests/e2e/*.spec.ts` against the docker harness (port from `.pi-test-harness.json`), reusing wave 1's `captureStates` helper and `page.route` fixtures. Probe matrix = `{base,dark}`, `{base,light}`, `{nord,dark}` × 375 / 768 / 1440. "Kit" = `dashboard-plugin-runtime/src/settings-fields.tsx`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings-panel: SettingsStatusPill | EP (tone) | L1 | automated | `tone` success / info / warning / error / neutral, label `Password rejected`, with and without `icon` | render | classes reference `--severity-<tone>-{bg,border,fg}`; label text present; icon `aria-hidden="true"`; no palette class, hex or `rgba(`; font class ∈ {11,12} px |
| E2 | settings-panel: SettingsItem | decision table (collapsible × status × actions × body) | L1 | automated | `title="Profile 3"`, status `Not paired`, actions [Connect], body; `collapsible` true/false; `defaultOpen` true/false | render; click summary | collapsible → `<details>` whose `<summary>` contains title AND status pill; collapsed still shows `Not paired`; summary min-height ≥ 44 px + `focus-ring`; non-collapsible → no `<details>`; `testId` on root |
| E3 | settings-panel: SettingsFacts | EP | L1 | automated | rows `[["OBS version","31.0.2"],["Password","Accepted"]]` | render | `<dl>` with 2 `<dt>`/`<dd>`; dt `--text-secondary`, dd `--text-primary`; 12 px |
| E4 | settings-panel: SettingsTable | BVA (width) | L1 | automated | 5 columns, 2 rows, caption | render | `<th scope="col">` × 5; caption present; wrapper has `overflow-x-auto`; 12 px |
| E5 | settings-panel: group meta 12 px | EP | L1 | automated | `SettingsGroup meta="3 fields"` | render | meta element `text-[12px]` + `--text-secondary`; no `text-[11px]` in the summary |
| E6 | plugin-settings-consistency: kit adoption, per plugin | EP (15 plugins) | L1 | automated | each listed plugin's settings component rendered with a fixture config | render; query body | 0 `input[type=checkbox]` (mcp-client: outside `ServerEditor`); every boolean control `role="switch"`; every labelled control has an accessible name; hint ids resolve via `aria-describedby` |
| E7 | plugin-settings-consistency: no identity header | EP | L1 | automated | apple-tools, flows-anthropic-bridge, grammar, quota, system-one, mcp-client bodies | render | no heading/text node equal to the plugin `displayName` ("Apple Tools", "Provider Quota", "Grammar & Spelling", …) or id (`quota`, `grammar`, `flows-anthropic-bridge`, `apple-tools`) |
| E8 | plugin-settings-consistency: switch naming | EP | L1 | automated | browser, chat-gateway, grammar, quota bodies | render | master switches named "Relay connections", "Answer Discord messages", "Check grammar in the composer", "Check quotas"; testids `browser-enabled-toggle`, `grammar-enabled`, `quota-enable` kept; none named "Enabled"/"Enable"/"On" |
| E9 | plugin-settings-consistency: field validation — chat-gateway map | EP | L1 | automated | channel folders `discord:1:-=/a\ndiscord:2 /b` | type; attempt host Save | field error naming line 2, `aria-invalid`; draft source reports invalid; commit not called |
| E10 | plugin-settings-consistency: empty allowed folders | EP | L1 | automated | allowed folders `""` | edit | warning notice "no session can start"; no field error; draft commit allowed |
| E11 | plugin-settings-consistency: cost ranges | BVA | L1 | automated | Seats `0`, `1`, `""`; Break after `0`, `1`, `120`, `121`; custom price `-1`, `0` | type each | invalid (0, "", 0, 121, -1) → field error + commit blocked; valid (1, 1, 120, 0) → no error; empty never written as 0 |
| E12 | plugin-settings-consistency: automation retention | BVA | L1 | automated | Runs to keep `""`, `0`, `1` | type | `""`/`0` → field error (no silent 100); `1` → valid |
| E13 | grammar: min < max | BVA | L1 | automated | Shortest 3999/4000/4001 with Longest 4000 | type | 4000 and 4001 → error naming the current Longest value, Advanced group open, commit blocked; 3999 → valid |
| E14 | apple-tools: state → pill decision table | decision table (state × appPresent) | L1 | automated | `READY_PENDING_GRANTS`+appPresent false; `READY_PENDING_GRANTS`+true; `NO_INSTALL_METHOD`+false; `OS_TOO_OLD`; `OS_VERSION_UNKNOWN`; `UNSUPPORTED_PLATFORM`; `INSTALL_FAILED`; `CONFIG_UNPARSEABLE`; `CONFIG_WRITE_FAILED`; pending request | render with stubbed status | pills "Not installed", "Installed", "Can't install automatically", "macOS too old", "macOS version unknown", "Unsupported platform", "Install failed", "Config unreadable", "Config not saved", "Checking"; no raw token text; notice for every non-Installed/Checking state; no "Ready" pill |
| E15 | quota: reason → pill | decision table (reason) | L1 | automated | provider on with data; `no-credential`; `peer-rejected`; `no-data`; `no-adapter`; provider off | render | "Signed in"/"Not signed in"/"Request refused"/"No quota reported"/"Not supported"; off → no pill; `quota-provider-<id>-reason` on the non-signed-in pill |
| E16 | quota: ToS warning visible | EP | L1 | automated | quota plugin enabled, body rendered | render | `quota-tos-warning` is a visible warning notice above the provider list; no `title=` carrying the warning text |
| E17 | quota: retry fields | decision table (retry on/off) | L1 | automated | `retry.enabled` false / true | render | off → number fields disabled, no preview; on → preview notice ≥ 12 px; unit chips `ms` inside labels |
| E18 | flows-anthropic-bridge: gate mapping | decision table (force × disable) | L1 | automated | (f,f), (t,f), (f,t), (t,t) | render; pick option; commit | selects Automatic / Always on / Off / none+warning; commit payload for Automatic `{forceCanonical:false,disableCanonical:false}`, Always on `{true,false}`, Off `{false,true}`; (t,t) unchanged until the user picks |
| E19 | flows-anthropic-bridge: status table | decision table (status × peers) | L1 | automated | sessions `active`, `waiting_peers`, `degraded`, `probing`; peer ok true/false+reason | render | pills "Active"/"Waiting for peers"/"Degraded"/"Checking"; peers "Loaded"/"Missing"+reason; no raw enum, no ✓/✗ glyph |
| E20 | mcp-client: one primary action | decision table (empty × populated) | L1 | automated | 0 servers; 3 servers | render | empty → exactly one primary "Add server" (`mcp-empty-add`), no toolbar Add; populated → exactly one primary (`mcp-add-server`), Refresh secondary |
| E21 | mcp-client: live pills | EP | L1 | automated | live `connected` 14 tools; `needs-auth`; not checked; unknown | render | "Connected · 14 tools", "Sign-in needed" + `/mcp login <name>`, "Not checked by pi", "State unknown"; no `needs-auth` text |
| E22 | browser: profile grouping | decision table (installed per profile) | L1 | automated | 4 profiles, 1 with extension | render | 1 card under "Chrome profiles with the extension"; collapsed "Other Chrome profiles" group with meta "3 · extension missing"; status pills in each card summary |
| E23 | browser: zero-dialog disabled reason | EP | L1 | automated | profile `hasToken:false` | render | switch disabled; hint "Pair this profile first" linked by describedby |
| E24 | system-one: hierarchy + validation | EP | L1 | automated | 1 backend; Add-backend id `-bad`, URL `ftp://x` | render; type | 4 `SettingsGroup`s, no nested card shadow class; Remove backend danger style with name "Remove <id>"; id/URL errors visible and linked; Add disabled |
| E25 | obs-studio: state words + code | EP | L1 | automated | instance state `stop-failed`; not-provisioned | render | human state word pill; `pi-obs provision` in `<code>` with copy action; no backtick character in text |
| E26 | goal: per-browser label | EP | L1 | automated | default | render | auto-restart switch shows "This browser" pill; toggling writes `pi-dashboard.goal.autoRespawnDefault` only |
| E27 | dashboard-shell-slots: host chrome | decision table (health) | L1 | automated | row healthy; disabled; not loaded; error; missing requirement; no status | render `PluginSettingsPage` | pill absent / "Off" / "Not loaded" / "Failed to load" / "Needs setup" / "Status unknown"; enable control `role="switch"` named "Enabled", testid `plugin-page-toggle-<id>`; back link `plugin-page-back-to-index` precedes `plugin-page-chrome` in DOM; title `text-lg`; no `accent-blue-500`, `--text-muted`, `text-[10px]`, `--accent-` text classes |
| E28 | dashboard-plugin-loader: claims gated | decision table (pref × variant) | L1 | automated | `showPluginInternals` off/on × full/compact chrome | render | off → no slot id text anywhere; on + full → collapsed "Plugin internals" listing slots; on + compact → slots inside "Plugin details"; deps always shown |
| E29 | settings-panel: Developer toggle | state | L1 | automated | localStorage empty; toggle on | render Developer page; click | "Show plugin internals" switch off by default; on → localStorage key set; no dashboard config write |
| E30 | dashboard-plugin-loader: load error exception | EP | L1 | automated | row `{loaded:false, error:"Bridge path conflict: x"}` | render | "This plugin failed to load." sentence + copyable block with full error |
| E31 | plugin-settings-consistency: i18n | EP | L1 | automated | new/changed keys in grammar (and any plugin with a catalog) | run plugin i18n tests + `node scripts/i18n-parity.mjs` | every new key present in each catalog the plugin ships; parity exits 0 |
| E32 | client-build-config: @source coverage | EP | L1 | automated | `index.css` + every package with a `settings-section` claim | run repo test | passes with the 10 added lines; removing `@source "../../quota-plugin/src"` makes it fail naming `quota-plugin` |
| E33 | settings-kit lint: counts | decision table (violation kind) | L1 | automated | fixture roots with `type="checkbox"`, `<select`, `#fbbf24`, `rgba(1,2,3,.5)`, `text-red-400`, `text-[10px]`, `text-[var(--text-muted)]`, `<h3>Provider Quota</h3>` in a claimed component; same tokens in an exempt `ServerEditor.tsx` | `scan` + `ratchet` | each counted once per kind; exempt file not counted; count above baseline → fail naming file; equal/below → pass and lists repaired |
| E34 | settings-kit lint: zero baseline | EP | L1 | automated | repo after this change | `node scripts/settings-kit-guard.mjs` | exit 0; baseline has no entry for the 15 plugins |
| E35 | theme-token guard: plugin roots | EP | L1 | automated | `SCAN_ROOTS` | read + fixture hex fallback in a quota-plugin file | every plugin client tree listed; new violation in `packages/quota-plugin/src` fails |
| E36 | all surfaces: probes | decision table (state × theme × width) | L3 | automated | every board state of the 15 bodies + host chrome via `page.route` fixtures | `captureStates` | contrast / size / focus-indicator lists empty for each plugin body and chrome |
| E37 | cost: inputs editable | EP | L3 | automated | `/settings/plugins/cost-estimator` in 3 themes | read computed style | Seats/Break-after border width ≥ 1 px, border colour = `--border-secondary`, background = `--bg-tertiary` |
| E38 | dashboard-shell-slots: back link target | BVA (breakpoint) | L3 | automated | plugin page at 375 and 1440 | measure `plugin-page-back-to-index` | height ≥ 44 at 375, ≥ 32 at 1440; positioned above the chrome card |
| E39 | settings-panel: table scroll | BVA | L3 | automated | flows-anthropic-bridge degraded fixture at 375 | measure | `document.documentElement.scrollWidth` ≤ viewport width; table wrapper scrolls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | plugin-settings-consistency: cost no keystroke write | state-transition | L1 | automated | cost page, Seats 1 | type `1` then `2` | 0 `plugin_config_write` sends; Save bar shows 1 unsaved change; after host Save exactly one write with `{seats:12}` only |
| F2 | plugin-settings-consistency: commit sends owned keys | state-transition | L1 | automated | apple-tools draft path changed; a `plugin_config_update` arrives with a new key `discoveredAt` | host Save | payload contains only `imcpServerPath`; config after server merge keeps `discoveredAt` |
| F3 | plugin-settings-consistency: clean draft adopts broadcast | state-transition | L1 | automated | chat-gateway clean; dirty on `steerPrefix` | `plugin_config_update` changes `steerPrefix` and `defaultCwd` | clean → both adopted; dirty → `steerPrefix` keeps the user's value, `defaultCwd` adopted |
| F4 | plugin-settings-consistency: chat-gateway Save move | state-transition | L1 | automated | chat-gateway page | render; edit Default folder | no in-body Save button; draft source `plugin:chat-gateway` dirty; host Save → one write |
| F5 | flows-anthropic-bridge: Save move + loading | state-transition | L1 | automated | status fetch pending, then resolves with 0 sessions | mount; resolve | "Checking sessions…" first, then info notice; no `flows-anthropic-bridge-save`; gate change marks `plugin:flows-anthropic-bridge` dirty |
| F6 | plugin-settings-consistency: secret discard | state-transition | L1 | automated | chat-gateway token typed `abc` | host Discard; then Save with blank token | token field empty after Discard; commit payload omits `token` when blank |
| F7 | browser: collapsed card keeps state | state-transition | L3 | automated | profile with extension collapsed | collapse/expand via keyboard (Tab, Enter) | summary pills visible while collapsed; focus ring visible on summary |
| F8 | dashboard-shell-slots: body rhythm | invariant | L3 | automated | flows page body with 2 top-level blocks | measure | gap between blocks = host spacing step; neither block has a top margin |
| F9 | visual fidelity to approved board | visual/subjective | — | manual-only | `mockups/after/**` vs the proposed column of `mockups/plugin-settings-wave-2.html` | human side-by-side review | [judgment: real render matches the approved design] |
| F10 | real provisioning flows | hardware / external service | — | manual-only | macOS with iMCP; Discord bot; OBS host; Chrome with the Playwright extension | run each flow end to end | [judgment: states and notices match the board on real systems; harness has no provisioning seam] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | browser: per-profile write failure | fault-injection (abort) | L1 | automated | `PUT /api/browser/profile` → 500 for profile A | Save token on A | error notice + "Try again" inside A's card only; typed token kept in input; B card + relay switch usable; token not in notice or Copy details |
| X2 | browser: relay switch failure | fault-injection (abort) | L1 | automated | `PUT /api/browser/enabled` → 500 | toggle | switch reverts; error notice; profile list still rendered (no page blank) |
| X3 | apple-tools: status unavailable | fault-injection (abort) | L1 | automated | status route → 404 | mount | "Could not check iMCP on this Mac…" sentence + Try again + Copy details; `404` only in copied text; path field still rendered |
| X4 | grammar: load failure | fault-injection (abort) | L1 | automated | `GET /api/config/plugins/grammar` rejects | mount | load-error notice + Try again; draft commit disabled until a successful load |
| X5 | grammar: save failure | fault-injection (abort) | L1 | automated | POST → 500 | host Save | sentence shown; `grammar config save failed (500)` only in Copy details |
| X6 | subagents: save failure | fault-injection (abort) | L1 | automated | POST → 500 body `boom` | host Save | sentence; `HTTP 500` and `boom` only in Copy details |
| X7 | system-one: load + key errors | fault-injection (abort) | L1 | automated | config GET → `E_PARSE`; key PUT → `ApiError{code:"E_KEY"}` | mount; Save key | sentences; codes only in Copy details; `system-one-load-error` kept |
| X8 | obs-studio: load failure | fault-injection (abort) | L1 | automated | status → 503 | mount | human error + Try again; no `Request failed: 503` visible |
| X9 | flows-anthropic-bridge: fetch failure | fault-injection (abort) | L1 | automated | status fetch rejects after a successful one | Refresh | previous table kept; error notice + Try again + Copy details |
| X10 | chat-gateway: secret never in details | fault-injection (abort) | L1 | automated | commit with token `s3cr3t` → 500 | host Save | copied details and notice do not contain `s3cr3t` |
| X11 | blackhole: parse error + registry unavailable | fault-injection (abort) | L1 | automated | config unparseable; registry → 503 | mount | error notice with Check again + Copy details (parser text only there); registry notice with Retry, no `503` visible; no `--accent-red` class |

---

## Coverage summary

- Requirements covered: 26/26 (11 delta specs).
- Scenarios by class: edge 39 · perf 0 · frontend 10 · error 11
- Scenarios by level: L1 52 · L2 0 · L3 6 · manual 2
- Scenarios by disposition: automated 58 · manual-only 2

## New infra needed

- `page.route` fixtures for the 15 plugins' status/config routes (extends wave 1's `tests/e2e/fixtures/retro-ux/`).
- `scripts/settings-kit-guard.mjs` + `scripts/settings-kit-baseline.json` + tests (modelled on `scripts/theme-token-guard.mjs`).
