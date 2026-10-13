# Test Plan — mcp-client-project-overrides

Stage: design   Generated: 2026-10-11

No open clarifications: every Triple is filled from the specs, design D1–D9 and the mockup `mockups/mcp-project-override/`.

## Scenarios

### Edge-case (core: classification and effective view)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | effective: override merges onto the kept global | EP | L1 | automated | global `docs {url, headers.Authorization}`; trusted project `docs {enabled:false}` | `getEffectiveView(project)` | exactly one `docs` row; `provenance:"pi-global"`; `enabled:false`; `entry.url` = global url; header redacted; `projectOverride.keys` = `["enabled"]` |
| E2 | effective: orphan override | EP | L1 | automated | project `ghost {enabled:false}`, no global `ghost` | view | folder row `ghost` inactive, `piError` = `server "ghost" needs "command" or "url", or a global server to override` |
| E3 | effective: override of an invalid global | EP | L1 | automated | global `docs {command:"x", exposure:"bogus"}`; project `docs {exposure:"direct"}` | view | folder row `docs` with the orphan message; no active `docs` row |
| E4 | effective: override of a collision loser | EP | L1 | automated | global file `dev-radius` then `dev_radius` (second dropped); project `dev_radius {enabled:false}` | view | `dev_radius` folder row with the orphan message; `dev-radius` unaffected |
| E5 | effective: bad keys | EP | L1 | automated | project `docs {enabled:false, timeout:5}` | view | folder row `docs` with `an override can only set enabled, exposure, toolExposure`; global `docs` row active and unchanged |
| E6 | effective: `isProjectOverride` uses `=== undefined` | EP | L1 | automated | project `docs {url:null, enabled:false}`; `docs {type:"http"}`; `docs {url:""}` | view | each treated as a whole-entry replace and reported with pi's validation message, never merged |
| E7 | effective: merged validation | EP | L1 | automated | global valid `docs`; project `docs {exposure:"nope"}` | view | folder row with pi's exposure validation message; global row unchanged |
| E8 | effective: untrusted override | decision-table | L1 | automated | project `docs {enabled:false}`, trust predicate false | view | global `docs` enabled; folder row inactive, reason `project-not-trusted` |
| E9 | effective: exemptions | EP | L1 | automated | global `dev-radius {url, auth:{provider:"radius"}}`; project override `dev-radius {exposure:"direct"}` | view | merged row active (no `global-only-auth`, no `name-collision` deactivation) |
| E10 | effective: aliases displayed resolved | EP | L1 | automated | project override `docs {exposure:"codemode-deferred", toolExposure:{search:"codemode-deferred"}}` | view | row `exposure` shows `codemode`; the raw override keeps the literal |
| E11 | provenance: replace still marked | EP | L1 | automated | project `docs {url:"https://other"}` | view | `docs` row `provenance:"pi-folder"`, `overridesGlobal:true` |
| E12 | pi-message golden | EP | L1 | automated | the three override messages | compare `classifyProjectEntry` output with strings taken from pi 1.1.0 `dist/extensions/mcp/config.js` | byte-equal messages (path prefix stripped) |

### Edge-case (writer)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| W1 | enabled: smallest write, decision table | decision-table | L1 | automated | global `enabled` ∈ {absent, `true`, `false`} × existing override `enabled` ∈ {absent, `true`, `false`} × request ∈ {on, off} | `setEnabled(name, req, project)` | file matches design D4 table for all 18 combos; `enabled ?? true` comparison; empty override deleted |
| W2 | enabled: no-op creates no file | EP | L1 | automated | no `.pi/mcp.json`; global `docs` enabled | `setEnabled("docs", true, project)` | no file created; IO spy shows zero writes |
| W3 | enabled: other keys survive | EP | L1 | automated | override `{enabled:false, exposure:"direct", toolExposure:{a:"hidden"}}` | turn on | override = `{exposure:"direct", toolExposure:{a:"hidden"}}` |
| W4 | enabled: disable global-only writes override only | EP | L1 | automated | global `docs` with `headers`, `env`, `oauth.clientSecret`, `auth` | disable at project scope | folder file contains exactly `"docs": {"enabled": false}`; no `omitted` in the result |
| W5 | setProjectOverride: null deletes, absent keeps | EP | L1 | automated | override `{enabled:false, exposure:"direct"}` | patch `{exposure:null}`; then `{}`; then `{enabled:null}` | `{enabled:false}`; unchanged; entry deleted |
| W6 | setProjectOverride: no kept base | EP | L1 | automated | no global `ghost`; and global invalid `docs` | patch `{enabled:false}` | refusal `no-global-server`; file byte-identical |
| W7 | setProjectOverride: precedence | EP | L1 | automated | global file unparseable | patch `{enabled:false}` | refusal `unparseable` (not `no-global-server`) |
| W8 | setProjectOverride: schema rejects secrets | EP | L1 | automated | patch carrying `headers` (via service call) | write | refused before IO |
| W9 | saveServer: override shape refused at project scope | EP | L1 | automated | `saveServer("docs", {enabled:false}, project)`; rename where `previousName` entry is an override | save | `invalid-entry` naming the project-override route; no write |
| W10 | saveServer: `{url:null}` not treated as override | EP | L1 | automated | `saveServer("docs", {url:null}, project)` | save | refused with pi's validation message (not the override message) |
| W11 | collisions: global write ignores folder overrides | decision-table | L1 | automated | trusted known folder with override `dev-radius {enabled:false}`; then with full entry `dev-radius {url}` | global `ensureServerEntry("dev_radius", …)` | override case: write succeeds; full-entry case: refused `name-collision` naming the folder file |
| W12 | override write scope is project only | EP | L1 | automated | global scope | `setProjectOverride` | refused; no file touched |
| W13 | legacy detection: exact copy | decision-table | L1 | automated | folder = `folderCopyOf(global).copy` + `enabled:false` (+ copied `exposure`) | `isLegacyFolderCopy` | true |
| W14 | legacy detection: folder secret vetoes | EP | L1 | automated | as W13 + folder `headers.Authorization` | detect | false |
| W15 | legacy detection: other field differs | EP | L1 | automated | folder `url` differs; folder `type:"http"` with no url | detect | false for both |
| W16 | convert: keeps only differing override keys | EP | L1 | automated | legacy copy with `enabled:false`, `exposure` equal to global | `convertLegacyCopy` | folder entry `{enabled:false}`; result carries `previous` = original raw |
| W17 | convert: nothing differs → entry removed | EP | L1 | automated | legacy copy equal to global apart from omitted secrets | convert | folder entry deleted; `previous` returned |
| W18 | apple-tools unaffected | EP | L1 | automated | hostless service, global scope | `ensureServerEntry` as `apple-tools/src/install.ts` calls it | identical output to pre-change fixture |

### Edge-case (routes)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | route: body validated before scope | EP | L1 | automated | `enabled:"no"`; `exposure:"bogus"`; `toolExposure:{a:"bogus"}`; `toolExposure:"x"` with an unknown cwd | `PUT …/servers/docs/project-override` | `400` naming the field; scope parser and file IO spies not called |
| R2 | route: alias accepted | EP | L1 | automated | `toolExposure:{a:"codemode-deferred"}` | PUT | `200`; written raw keeps the literal |
| R3 | route: global scope refused | EP | L1 | automated | no `cwd` | PUT | `400`; no write |
| R4 | route: unknown folder | EP | L1 | automated | `cwd` not known | PUT | `403` (admission refusal); no write |
| R5 | route: response shapes | EP | L1 | automated | write leaving keys; write emptying the override | PUT | `{ok:true, override:{…}}`; `{ok:true, removed:true}` |
| R6 | route: unauthenticated | EP | L1 | automated | no auth | PUT and `POST …/convert-to-override` | refused before any file read |
| R7 | route: convert returns previous | EP | L1 | automated | legacy copy | `POST …/convert-to-override` | `{ok:true, previous:<raw>}`; a non-legacy entry → refused, file unchanged |
| R8 | route: exact restore | state-transition | L1 | automated | override `{enabled:false, toolExposure:{search:"direct"}}` | DELETE then PUT raw with absent keys `null` | file bytes for the entry identical to the original |

### Frontend-quirk (client)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | folder page: override badge text | EP | L1 | automated | rows with `projectOverride.keys` `["enabled"]` (enabled false), `["enabled"]` (true), `["exposure"]` | render `ServerList` folder scope | badges "Off in this folder", "On in this folder", "Exposure: direct in this folder"; a "Reset to global" button per overridden row |
| F2 | folder page: switch calls the right op | state-transition | L1 | automated | global row, no override | toggle off | `setEnabled(name,false,project)` called once; pending until resolve; reverts + inline error on reject |
| F3 | Reset with exact undo | state-transition | L1 | automated | overridden row with `toolExposure` | Reset → Undo | DELETE then `PUT …/project-override` with the raw keys and `null` for absent ones; toast `mcp-folder-undo-toast` |
| F4 | Remove of an orphan row uses the override route for undo | state-transition | L1 | automated | orphan row `ghost {enabled:false}` | Remove → Undo | undo calls `PUT …/project-override`, not `PUT /servers/:name`; switch is disabled on that row |
| F5 | Remove of a whole-entry row keeps today's undo | state-transition | L1 | automated | folder full entry | Remove → Undo | undo calls `PUT /servers/:name` with the raw entry |
| F6 | legacy strip + convert | state-transition | L1 | automated | legacy copy row | click Convert → Undo | `POST …/convert-to-override`; then `PUT /servers/:name` with `previous` |
| F7 | panel: radiogroup state | EP | L1 | automated | override `{enabled:false}`; global exposure `direct` | open Project settings | radio Off checked and focused; exposure select first option "Inherit (direct)"; `toolExposure` rendered read-only |
| F8 | panel: save writes exactly the choice | decision-table | L1 | automated | Inherit / On / Off × exposure Inherit / `hidden` | Save | patch `enabled` = `null` / `true` / `false` and `exposure` = `null` / `"hidden"` respectively |
| F9 | untrusted pending note | state-transition | L1 | automated | view `trusted:false`; global `docs` on | toggle off | write called; row shows "applies once the project is trusted"; switch shows global state (on) |
| F10 | shadowed global row | EP | L1 | automated | global `docs` + folder full entry `docs` | render | global row switch, Reset and Project settings unavailable |
| F11 | pill excludes orphan/invalid override rows | EP | L1 | automated | 2 effective servers + orphan `ghost` + untrusted folder row | render `FolderMcpSection` | "2 servers" with no off-count from `ghost`; untrusted row still counted as today |
| F12 | `omitted` UI removed | EP | L1 | automated | `setEnabled` result without `omitted` | toggle off on a global row | no `mcp-folder-omitted-*` node rendered |
| F13 | radiogroup arrow keys | state-transition | L3 | automated | folder page with an overridden server (docker harness) | open panel, focus Inherit, press ArrowRight | On becomes checked; accessible name reads "On" |
| F14 | mobile: bottom sheet + targets | EP | L3 | automated | viewport 390 × 844 | open the row sheet and the panel | panel anchored bottom; badges have no inline action; Reset / Project settings in the sheet; every action ≥ 44 × 44 px |
| F15 | end-to-end override round trip | state-transition | L3 | automated | docker harness: global `docs` in `~/.pi/agent/mcp.json`, trusted folder | switch off in folder page → `pi mcp list --json` in that cwd | folder file `{"docs":{"enabled":false}}`; pi lists `docs` disabled; global file unchanged |
| M1 | visual fidelity to the mockup | — | — | manual-only | built folder page, dark + light + one non-base palette | compare with `mockups/mcp-project-override/screenshots/` | layout, labels and states match the approved mockup |

## Coverage

| Requirement | Scenarios |
|---|---|
| mcp-client-config: effective configuration | E1–E10, E12, F15 |
| mcp-client-config: layer provenance | E1, E11 |
| mcp-client-config: writes atomic / closed set / collisions | W6, W7, W9–W11 |
| mcp-client-config: enabled flag | W1–W4 |
| mcp-client-config: schema | W8, W9, R1 |
| mcp-client-config: in-process service | W18, W5, W16 |
| mcp-client-config: HTTP surface | R1–R8 |
| folder-section: page follows project rules (badges, orphan, pill) | F1, F4, F11 |
| folder-section: mobile | F14 |
| folder-section: per-project settings | F2, F3, F7–F10, F13 |
| folder-section: replace whole entry | F5 (unchanged editor path; existing `FolderMcpPage.test.tsx` override tests renamed) |
| folder-section: legacy conversion | W13–W17, F6, R7 |

## Exemplars

- E*: `packages/mcp-client-plugin/src/core/__tests__/effective-view.test.ts`
- W*: `packages/mcp-client-plugin/src/core/__tests__/config-writer.test.ts` (W11: `config-writer-admission.test.ts`; W18: `service.test.ts`; W8: `schema.test.ts`)
- R*: `packages/mcp-client-plugin/src/server/__tests__/routes.test.ts` (R4: `routes-admission.test.ts`)
- F1–F10, F12: `packages/mcp-client-plugin/src/client/__tests__/FolderMcpPage.test.tsx`; F11: `FolderMcpSection.test.tsx`
- F13, F15: `tests/e2e/mcp-client-harness-integration.spec.ts`; F14: `tests/e2e/mcp-client-folder-mobile.spec.ts`

## New infra needed

None. The pi-message golden (E12) reads the installed pi dist at test time. After `update-pi-core-1-1-adopt-apis` that is 1.1.0; before it, the test is skipped with a reason when `dist/extensions/mcp/config.js` lacks `OVERRIDE_KEYS`.
