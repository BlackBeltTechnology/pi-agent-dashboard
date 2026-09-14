# Test Plan — extract-mcp-client-plugin

Stage: apply   Generated: 2026-09-13   Markers: 0 open

## Clarifications — resolved 2026-09-13

- [x] **C1** `GET /effective` budget: p95 ≤ 200ms for 50 servers × 4 layers, in-process (P1).
- [x] **C2** Undo toast lifetime: host toast default duration (F16).
- [x] **C3** Install/upgrade action busts the 30s verdict cache → immediate refetch (X9).
- [x] **E8** Both servers keys present: write under the key the adapter reads first (cite adapter code in the test), leave the other.
- [x] **E34** Prerelease ≥ floor is `ok` (semver compare with `includePrerelease`).
- [x] **E37** Subdirectory admission mirrors kb `isAllowedCwd` verdict exactly.
- [x] **F5** Switching transport tab then Save unsets the previous transport in the patch.
- [x] **X8** Adapter loads run in a worker thread under `adapterLoadTimeoutMs` (design D10) → 504.
- [x] **X22** Service serialises writes per target path (both land).
- [x] Trivia decided: E44 "0 servers" / "1 server"; E45 `localeCompare` with `numeric: true` (`2` before `10`, case-insensitive); E48 writer always produces `0600`; X21 undo failure shows the raw entry as copyable JSON in the error toast.

---

## Scenarios

Requirement refs: `CFG` = mcp-client-config, `SET` = mcp-client-settings, `FLD` = mcp-client-folder-section, `APL` = apple-tools-provisioning delta, `DMS` = dashboard-mcp-server delta. Levels: L1 vitest, L3 Playwright vs docker harness (derived port from `.pi-test-harness.json`), `electron` bundle check.

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | CFG/HTTP name validation | BVA | L1 | automated | name of length 1 (`a`) | `PUT /servers/a` `{scope:global,set:{command:"/bin/x"}}` | 200; entry `a` written |
| E2 | CFG/HTTP name validation | BVA | L1 | automated | name of length 128 | same PUT | 200 |
| E3 | CFG/HTTP name validation | BVA | L1 | automated | name of length 129 | same PUT | 400 naming `name`; no IO (ConfigIO spy: 0 reads, 0 writes) |
| E4 | CFG/HTTP name validation | BVA | L1 | automated | name `""` (empty segment, `PUT /servers/`) | route call | 404 or 400; no IO |
| E5 | CFG/HTTP name validation | EP (invalid partitions) | L1 | automated | names `a/b`, `a\b`, `a\u0007b`, `.`, `..`, `%2e%2e` (decoded `..`), `__proto__`, `constructor`, `prototype` | one PUT per name | each 400; no IO for any |
| E6 | CFG/HTTP name validation | EP (valid partition) | L1 | automated | name `my server` (space), `%E2%9C%93` (decoded `✓`) | PUT | 200; file key is the decoded string |
| E7 | CFG/Writes target only Pi-owned layers | decision-table (scope × cwd) | L1 | automated | scope=`global` with cwd supplied / scope=`project` without cwd / scope=`project` with cwd / unknown scope | PUT | global+cwd → cwd ignored, writes global path; project−cwd → 400; project+known cwd → writes `<cwd>/.pi/mcp.json`; unknown → 400 |
| E8 | CFG/Alias key preserved | decision-table (existing keys) | L1 | automated | target file with (a) `mcpServers` only, (b) `mcp-servers` only, (c) both, (d) neither | upsert `x` | (a) under `mcpServers`; (b) under `mcp-servers`, no `mcpServers` added; (c) written under the key the adapter reads first (test cites the adapter's `mcpServers ?? mcp-servers` line), other key byte-identical; (d) `mcpServers` created |
| E9 | CFG/Writes are merge-only | EP | L1 | automated | file `{"$schema":"x","unknownTop":{"k":1},"mcpServers":{"a":{"command":"a","weird":[1]},"b":{...}}}` | patch `a` `set:{args:["1"]}, unset:["weird"]` | `a` = `{command:"a",args:["1"]}`; `b`, `$schema`, `unknownTop` byte-equal |
| E10 | CFG/Writes are merge-only | BVA (empty patch) | L1 | automated | `set:{}`, `unset:[]` | PUT | 200, file byte-identical (no rewrite) OR rewritten but semantically identical — assert semantic equality + mtime unchanged if no-op |
| E11 | CFG/Unset | BVA | L1 | automated | `unset:["nonexistent"]` | PUT | 200; no error; other fields untouched |
| E12 | CFG/Prototype key refused | EP | L1 | automated | service call `ensureServerEntry("__proto__", …)` and `setServerDisabled("constructor", …)` and `checkConfigFiles({serverName:"prototype"})` | each call | refusal `invalid-name`; no file read for ensure/setDisabled; `Object.prototype` unpolluted (`({}).polluted === undefined`) |
| E13 | CFG/Prototype key refused | EP (payload keys) | L1 | automated | `set:{"__proto__":{"polluted":true}}` inside a valid server patch | PUT | 400 (schema: no such field) or key dropped; `({}).polluted === undefined` afterwards |
| E14 | CFG/Disabled flag semantics | state-transition | L1 | automated | Pi-global entry `{command:"a",disabled:true}`, stub port: merged view says enabled after removal | enable at global | entry is `{command:"a"}`; exactly 1 write |
| E15 | CFG/Disabled flag semantics | state-transition | L1 | automated | Pi-global entry `{disabled:true}` only (no other keys), stub port merged view enabled | enable | `mcpServers.x` key absent; sibling servers kept |
| E16 | CFG/Disabled flag semantics | state-transition | L1 | automated | Pi-global entry `{disabled:true}`, stub port merged view still disabled (shared layer disables) | enable | entry `{disabled:false}`; port loader called exactly once; ≤2 writes |
| E17 | CFG/Disabled flag semantics | state-transition (illegal edge) | L1 | automated | server absent from Pi-global, merged view disabled via `<cwd>/.mcp.json` import | enable at project | `<cwd>/.pi/mcp.json` gains `{x:{disabled:false}}`; `~/.pi/agent/mcp.json` byte-identical |
| E18 | CFG/Disabled flag semantics | state-transition | L1 | automated | server already enabled everywhere | enable | no `disabled` key written; file semantically unchanged |
| E19 | CFG/Disabled flag semantics | state-transition | L1 | automated | server enabled at global | disable at project scope for known cwd | `<cwd>/.pi/mcp.json` has `disabled:true`; global file byte-identical |
| E20 | CFG/Layer model provenance | decision-table (kind × path) | L1 | automated | provenance stubs: `user`/global path; `project`/`<cwd>/.pi/mcp.json`; `project`/`<cwd>/.mcp.json`; `import` with path == global path; server absent from map | classify each | Pi global (writable) / Pi folder (writable) / Shared (ro) / Shared labelled importKind (ro) / Other + source kind (ro) |
| E21 | CFG/Layer model provenance | EP | L1 | automated | server in shared `.mcp.json` AND `.pi/mcp.json` AND global | effective view for cwd | `provenance` = [Pi folder, Shared, Pi global] in precedence order; fields = adapter-merged result (stub returns a known merge) |
| E22 | CFG/Redaction | decision-table (field × own/inherited) | L1 | automated | `bearerToken`, `oauth.clientSecret`, `headers{Authorization,Accept}`, `env{API_KEY,PATH}`, `requestHeadersCommand.env{X_SECRET}` each defined (a) in shared layer, (b) in the scope's Pi-owned layer | effective view at that scope | (a) scalar → marker; records → `{redacted:true, keys:[{name,secret}]}` with `Authorization`/`API_KEY`/`X_SECRET` secret=true, `Accept`/`PATH` secret=false; `JSON.stringify(response)` contains no secret value; (b) plain values present |
| E23 | CFG/Redaction | EP (scope crossing) | L1 | automated | secret defined in Pi global | effective view at project scope for cwd | redacted (global is not the project scope's writable layer) |
| E24 | CFG/Global view uses no project layers | EP | L1 | automated | server `process.cwd()` contains `.mcp.json` and `.pi/mcp.json` with server `leak` | `GET /effective` (no cwd) | `leak` absent; port loader received cwd under `os.tmpdir()`; that dir is empty; ConfigIO spy shows no read under `process.cwd()` |
| E25 | CFG/JSONC | EP | L1 | automated | layer file `{ /* c */ "mcpServers": { "a": { "command": "a", }, }, }` | read + upsert `b` | read: no parse error, `a` present; write: valid JSON, `a`+`b` present, comments gone |
| E26 | CFG/Schema transport exclusivity | decision-table (transports in resulting entry) | L1 | automated | resulting layer entry has {command}, {url}, {socket}, {command,url}, {url,socket}, {command,url,socket}, {} | writer validation | first three accepted; any ≥2 → `transport-conflict` naming every transport present; {} → accepted by writer (≥1 rule is HTTP-only) |
| E27 | CFG/Schema ≥1 transport (HTTP) | decision-table | L1 | automated | resulting entry {} and (a) lower source defines server, (b) none | PUT | (a) 200; (b) 400 naming `command`,`url`,`socket`; no write |
| E28 | CFG/Schema ≥1 transport (HTTP) | EP (cwd used for merge) | L1 | automated | project scope, cwd=K; server defined only in K's `.mcp.json` | PUT `{disabled:true}` at project | port loader invoked with cwd=K (not scratch, not `process.cwd()`); 200 |
| E29 | CFG/Schema defaults | EP | L1 | automated | schema property with `default` (e.g. a settings key) | PUT settings `{set:{oneKey:v}}` and PUT server `{set:{command:"x"}}` | written objects contain exactly the set keys; `useDefaults` off |
| E30 | CFG/Schema coverage | compile-time assertion (fail-closed) | L1 | automated | (a) real schema; (b) schema with `bearerToken` misspelled; (c) schema missing `disabled`; (d) type missing a schema key | `tsc` on the key-set test | (a) passes; (b)(c)(d) each fail compile (per `verify-compile-time-assertions-fail-closed`) |
| E31 | CFG/Schema Ajv strict | EP | L1 | automated | schema containing `x-secret`,`x-transport`,`x-atomic` | `new Ajv({strict:true})` + `addKeyword` ×3 + `compile` | compiles without throw; removing one `addKeyword` → compile throws `unknown keyword` |
| E32 | CFG/Global settings merge-only | EP | L1 | automated | file `{settings:{a:1,b:2},mcpServers:{x:{…}},other:1}` | `PUT /settings {set:{a:9},unset:["b"]}` | `settings` = `{a:9}`; `mcpServers`, `other` byte-equal |
| E33 | CFG/Global settings fallthrough | decision-table (Pi-global × shared × default) | L1 | automated | key set in Pi-global only / shared only / both / neither | effective view `settings[key].source` | Pi global / Shared(path) / Pi global / `default` with adapter default value |
| E34 | CFG/Adapter verdict | BVA (semver vs floor 2.20.0) | L1 | automated | installed `2.19.99`, `2.20.0`, `2.20.1`, `2.30.0`, `3.0.0-beta.1`, `"garbage"`, package.json absent | `adapterVerdict()` | below-floor(installed,floor) / ok / ok / ok / ok (includePrerelease) / unparseable / absent |
| E35 | CFG/Adapter verdict probe path | decision-table | L1 | automated | stub port global path `<tmp>/agent/mcp.json`; adapter at `<tmp>/agent/npm/node_modules/…` vs `<tmp>/agent/node_modules/…` vs neither | probe | ok (npm/) / ok (node_modules/) / absent; `~/.pi/agent` never stat'd (fs spy) |
| E36 | CFG/Adapter verdict cache | BVA (TTL 30s) | L1 | automated | fake timers; first probe → ok | second call at t=29.9s; third at t=30.1s after swapping package.json to 2.0.0 | 2nd: no fs read, ok; 3rd: fs read, below-floor |
| E37 | CFG/Project-scope admission | decision-table | L1 | automated | known set `{/k}`; cwd `/k`, `/k/`, `/k/../k`, `/k/../other`, `/other`, `/k/sub` (subdir, not worktree), worktree `/wt` whose git main checkout is `/k`, symlink `/lnk→/k` | project write | admitted: `/k`, `/k/`, `/k/../k`, `/wt`, `/lnk` (canonicalised); refused with no write: `/k/../other`, `/other`; `/k/sub` gets whatever verdict the moved kb `isAllowedCwd` test asserts (parity test: same input table, same verdicts for kb and mcp-client) |
| E38 | CFG/Service `readServerEntry` | EP | L1 | automated | port whose `loadMcpConfig` throws | `readServerEntry("iMCP", global)` | returns raw file entry; loader never called |
| E39 | CFG/Service check/write parity | decision-table (existing entry × fields) | L1 | automated | existing `{url:"u"}` + fields `{command}`; existing `"string"` + any; file unparseable; file absent + `{command}`; existing `{command:"old"}` + `{command:"new"}` | `checkConfigFiles` then `ensureServerEntry` with same args | verdict pairs equal: transport-conflict/transport-conflict; entry-not-object ×2; unparseable ×2; ok/written; ok/written — and `checkConfigFiles` performed 0 writes in every case |
| E40 | CFG/Service ensureAdapterPackage | EP | L1 | automated | `settings.json` `{packages:["npm:a"],other:{x:1}}` / `{packages:["npm:pi-mcp-adapter"]}` / `{}` / absent / unparseable | call | `["npm:a","npm:pi-mcp-adapter"]`+`other` kept / unchanged (no rewrite) / `{packages:[…]}` / file created / refused `unparseable`, byte-identical |
| E41 | CFG/Service ensureServerEntry preserves fields | EP | L1 | automated | existing `iMCP` `{command:"old",disabled:true,directTools:["a"],unknown:1}` | `ensureServerEntry("iMCP",{command:"new"},global)` | `{command:"new",disabled:true,directTools:["a"],unknown:1}` |
| E42 | CFG/HTTP remove returns entry | EP | L1 | automated | folder entry `{command:"a",unknownKey:{n:[1]},"weird key":true}` | `DELETE /servers/x?cwd=K` then `PUT /servers/x {scope:project,cwd:K,set:<returned>}` | DELETE body `removed` deep-equals original; after PUT the file entry deep-equals original |
| E43 | CFG/HTTP patch shape | EP (invalid) | L1 | automated | body `{scope:"global",command:"x"}` (whole entry, no `set`) | PUT | 400; no IO |
| E44 | FLD/Pill text | decision-table (servers × disabled × parseError) | L1 | automated | (4,1,no) / (4,0,no) / (0,0,no) / (4,1,yes) / (0,0,yes) | render `SlotPill` | "4 servers · 1 off" / "4 servers" / "0 servers" (and (1,0,no) → "1 server") / text + error marker whose `aria-label` contains failing path / error marker only |
| E45 | SET/Server list sorted | EP | L1 | automated | servers `b`, `A`, `a`, `Z`, `10`, `2` | render | DOM order `2, 10, a, A, b, Z` (`localeCompare` with `numeric: true`, `sensitivity: "base"`; ties keep input order) |
| E46 | APL/dependsOn matrix | decision-table (mcp-client × apple-tools enabled) | L1 | automated | (on,on) / (off,on) / (on,off) / (off,off) | loader run | order [mcp-client, apple-tools] and service observed / apple-tools `missingDeps:["mcp-client"]`, not loaded, no throw / only mcp-client loaded / neither |
| E47 | DMS/Provisioning refuse | decision-table (existing `pi-dashboard` shape) | L1 | automated | absent / `{url:"old",disabled:true,headers:{A:"b"}}` / `{command:"x"}` / `"str"` / file JSONC-commented / file unparseable / servers under `mcp-servers` | boot provisioning | created / url+protocolVersion refreshed, `disabled`+`headers` kept / refused, byte-identical, existing message / refused / written, comments dropped, siblings kept / refused / written under `mcp-servers`, no `mcpServers` |
| E48 | CFG/Written permissions | EP | L1 | automated | existing file `0600`; existing `0644` | upsert | resulting mode `0600` in both cases (writer always hardens) |
| E49 | CFG/PI_CODING_AGENT_DIR | EP | L1 | automated | `PI_CODING_AGENT_DIR=<tmp>/custom` (real adapter port via dynamic import) | global write + effective view + verdict | write lands `<tmp>/custom/mcp.json`; view reports that path as Pi global; probe stats `<tmp>/custom/npm/node_modules/pi-mcp-adapter` |
| E50 | CFG/Production bundling | EP | electron | automated | `BUNDLED_PLUGINS` list | bundle-completeness test | contains `mcp-client-plugin`; built client bundle exports the settings section + pill claims |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | CFG/HTTP effective view | tail-latency | L1 (timed) | automated | 50 servers × 4 layers, 20 sequential `GET /effective?cwd=K` (worker already warm) | p95 ≤ 200ms | 20 calls |
| P5 | CFG/Worker spawn | micro-perf (call count) | L1 | automated | 100 sequential effective-view calls, no timeout | `Worker` constructor called exactly 1× | single test |
| P2 | CFG/Adapter verdict cache | micro-perf (call count) | L1 | automated | 1000 `adapterVerdict()` calls within 30s | fs reads == 1 | single test |
| P3 | SET/`useEffectiveConfig` dedupe | micro-perf (request count) | L1 | automated | 3 components mount simultaneously for cwd K; 2 for global | fetch calls == 2 (one per key) | mount |
| P4 | CFG/Interrupted write | soak / crash-consistency | L1 | automated | 200 iterations: spawn child that writes and is `SIGKILL`ed at a random point after tmp creation | after each: target parses AND equals old or new content; no leftover file matching a predictable name; leftover random tmp count reported | 200 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | SET/Adapter status single state | state-convergence | L1 | automated | mocked `/adapter` verdict `below-floor{installed:2.19.0,floor:2.20.0}` | render | pill text and banner text both contain `2.19.0` and `2.20.0`; every `switch`, Add, Save `disabled=true`; editor opens with `role=dialog` fields as text |
| F2 | SET/Adapter status | state-transition | L1 | automated | verdict `absent` → then `ok` (mock swap + refetch) | rerender | `absent`: install action present, list rows still rendered read-only; `ok`: in ONE act() flush pill, banner removal and enabled controls all change (no intermediate render with pill=ok but switches disabled) |
| F3 | SET/Toggle | state-transition (optimistic + revert) | L1 | automated | Pi-global row enabled; `PUT …/disabled` mocked to reject after 100ms | click switch | t<100ms: `aria-busy=true`; after reject: switch `aria-checked` back to previous, inline error text on that row only; other rows untouched |
| F4 | SET/Toggle | state-transition (double-click) | L1 | automated | slow PUT (500ms) | click switch twice within 50ms | exactly 1 PUT issued (pending state blocks second) OR 2 PUTs with final state = last response — assert invariant: final `aria-checked` equals server's last persisted value |
| F5 | SET/Editor transport tabs | state-transition | L1 | automated | layer entry `{url:"u"}`, effective also has `command` from lower layer | open editor | initial tab `url`; `command`/`args`/`env`/`socket` inputs absent from DOM; switching to `command` tab hides url fields; Save from `command` tab with `command:"x"` sends `set:{command:"x"}, unset:["url"]` (previous transport's fields unset automatically; only fields the layer entry defined are unset) |
| F6 | SET/Editor validation | EP | L1 | automated | command tab, `command` empty | Save | inline error at `command`; summary list at top with 1 item; 0 PUT calls |
| F7 | SET/Editor unknown fields | EP | L1 | automated | entry `{command:"a",unknownField:{n:1}}` | edit `args`, Save | patch is `set:{args:[…]}` only; `unknownField` never in `unset` |
| F8 | SET/Override shared | EP | L1 | automated | shared server, effective `{url:"u",timeout:5}` | Override, change `timeout`→7, Save | PUT body `{scope:"global",set:{timeout:7}}` — no `url`; provenance after refetch lists Pi global + Shared |
| F9 | SET/Override x-atomic record | BVA (keys 0/1/3) | L1 | automated | inherited `env` marker `keys:[{API_KEY,secret},{PATH},{HOME}]` / 1 key / 0 keys | choose "Override env" | note "3 inherited keys incl. 1 secret will no longer apply" / "1 … 0 secrets" / no note or "0 keys"; record editor starts with 0 rows; Save with 1 row sends `set:{env:{X:"1"}}` only |
| F10 | SET/Secret masking | decision-table (field × own/inherited × pattern) | L1 | automated | own `headers.Authorization`, own `env.MY_TOKEN`, own `env.PATH`, inherited `bearerToken` marker | open editor | first two: `type=password`-equivalent bullets + reveal toggle; `PATH`: plain; inherited: placeholder text, NO reveal toggle, and after Save patch omits `bearerToken` |
| F11 | SET/Secret reveal resets | state-transition | L1 | automated | reveal `Authorization` | close editor, reopen | value masked again |
| F12 | SET/Global settings draft source | state-transition | L1 | automated | change one setting | (a) host `isDirty()`; (b) navigate away; (c) host Save | (a) true; (b) host discard-confirm rendered, Cancel keeps value; (c) `commit` sends `PUT /settings {set:{k:v}}` with exactly 1 key, then `isDirty()` false |
| F13 | SET/Global settings fallback labels | decision-table | L1 | automated | key absent everywhere / defined in shared | render | "default" label + adapter default value / shared layer label + clear button text "use inherited" |
| F14 | SET/No local save button | EP | L1 | automated | section rendered | query | no `button` named Save inside the section root (host Save Bar only) |
| F15 | FLD/Pill loading + not-tracked | state-transition | L1 | automated | fetch pending → resolves 403 → session list changes → fetch resolves 200 | render timeline | pending: placeholder element with same `offsetHeight` as pill; 403: text "not tracked", muted class, 0 further fetches for 2s; after list change: exactly 1 new fetch, pill shows counts |
| F16 | FLD/Remove override undo | state-transition | L1 | automated | override chip on `x`; DELETE returns `removed:{disabled:true,unknown:1}` | click remove → click Undo | PUT `{scope:project,cwd,set:{disabled:true,unknown:1}}` issued; after Undo the chip returns. Just-after-expiry variant: advance fake timers to host toast default + 1ms → toast gone, no Undo control, 0 PUTs |
| F17 | FLD/Folder page not-allowed | EP | L1 | automated | route `/folder/<enc(/unknown)>/mcp`, fetch → 403 | render | not-allowed empty state; 0 server rows; no retry fetch within 2s; no Override/switch controls |
| F18 | FLD/Worktree pill cwd | EP | L1 | automated | worktree card cwd `/wt` under folder `/k` | render pill | fetch URL contains `cwd=%2Fwt`, never `%2Fk` |
| F19 | FLD/Folder enable over global disable | state-convergence | L1 | automated | server disabled at Pi global, pill shows "3 servers · 1 off" | switch on at folder page (mock PUT ok, refetch returns enabled) | PUT `…/disabled {scope:project,cwd,disabled:false}`; pill converges to "3 servers" |
| F20 | FLD/Inherited hints | EP | L1 | automated | server in Pi global, not in folder layer | open row | every field carries "inherited from Pi global" hint; folder override row (defined in `.pi/mcp.json` with `disabled`,`args`) → chip lists exactly `disabled, args` |
| F21 | SET+FLD/Mobile | BVA (viewport 639/640) | L3 | automated | `/settings/plugins/mcp-client` at 390×844 and at 639px, 640px | open editor | ≤639: editor is bottom sheet (bounding box bottom == viewport bottom); 640: modal (centered); every `button`/`switch`/row action bounding box ≥44×44 at 390px |
| F22 | FLD/Mobile chips | BVA | L3 | automated | folder page at 390px with an override chip | inspect chip; open row editor | chip has no remove `button`; sheet contains "Remove override" |
| F23 | SET/Keyboard-only | state-transition (focus order) | L3 | automated | settings page, editor open | Tab through | focus visits: every transport tab, every field, Advanced disclosure, Save, Close — in DOM order; each focused element has visible focus ring (computed outline/box-shadow ≠ none); Escape closes editor |
| F24 | SET/Accessibility floor | axe | L3 | automated | settings page (list + editor open), folder page | `axe.run` | 0 violations at `serious`/`critical`; contrast checks pass in all 4 themes |
| F25 | SET/Section renders once | EP | L3 | automated | navigate via plugin row settings affordance | URL + DOM | URL `/settings/plugins/mcp-client`; exactly 1 element with the section `data-testid` |
| F26 | APL/Missing-dependency banner | state-transition | L1 | automated | `/api/plugins` row `apple-tools {enabled:true,loaded:false,missingDeps:["mcp-client"]}` | render apple-tools section | banner text contains `mcp-client`, link href to plugins index; no "Run installer" button; with `loaded:true` → no banner, installer offered (macOS + app present) |
| F27 | APL/Settings surface trimmed | EP | L1 | automated | apple-tools section on macOS provisioned host | render | no enable/disable switch; no direct-tools control; link href `/settings/plugins/mcp-client` |
| F28 | SET/Editor field renderer coverage | type-coverage | L1 | automated | every `ServerEntry` + `McpSettings` schema field | render editor with all fields populated | each field has a widget or the JSON-fallback editor; none missing from DOM (assert count == schema property count) |
| F29 | FLD/Back | state-transition | L3 | automated | open folder page from sidebar pill (previous view: sessions) | click Back | shell shows the sessions view, URL restored to pre-pill URL |
| F31 | SET/Plugin settings group | state-transition | L1 | automated | `usePluginConfig` → `{adapterLoadTimeoutMs:10000}` | set `2500`, host Save | `plugin_config_write {id:"mcp-client",config:{adapterLoadTimeoutMs:2500}}` issued; 0 `PUT /settings`; then `isDirty()` false |
| F32 | SET/Plugin settings group | BVA (1000/120000) | L1 | automated | enter `999`, `1000`, `120000`, `120001` | blur | inline range error shown / none / none / shown; with an error present the draft source's `commit` is not callable by the host Save (source reports invalid) |
| F33 | SET/Plugin settings group | fault-injection (partial commit) | L1 | automated | timeout → `2500` AND adapter setting → `k:v`; `PUT /settings` mocked 409 | host Save | `plugin_config_write` issued; `PUT /settings` issued; `isDirty()` still true; error text rendered inside the adapter settings group only |
| F34 | SET/504 list state | fault-injection | L1 | automated | `GET /effective` → 504 `{timeoutMs:1000}` | render | list error state text contains `1000`; retry button issues exactly 1 fetch; a link/anchor targets the timeout field (focus moves to it) |
| F35 | FLD/504 on pill + page | fault-injection | L1 | automated | folder view fetch → 504 | render pill; render page | pill error marker `aria-label` contains timeout; page error state with retry issuing exactly 1 request; no stale rows |
| F30 | mockups visual parity | visual/subjective | — | manual-only | live settings + folder pages vs `mockups/*.html` | human compares | [judgment: layout/spacing "matches mockup" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | CFG/IO failure write-failed | fault-injection (abort) | L1 | automated | ConfigIO `writeFile` rejects `EACCES` / `ENOSPC` / `mkdir` rejects `EACCES` | upsert | result `write-failed` with `code` = injected code; target byte-identical; no tmp file left in target dir |
| X2 | CFG/IO failure mid-sequence | fault-injection (abort at rename) | L1 | automated | `rename` rejects `EXDEV` | upsert | `write-failed{code:EXDEV}`; target byte-identical; tmp file removed (cleanup attempted) |
| X3 | CFG/Unparseable target | EP | L1 | automated | target `{ "mcpServers": ` (truncated) | upsert / disable / settings patch / `ensureAdapterPackage` on truncated `settings.json` | each refused `unparseable` naming path + parser message; byte-identical; HTTP 409 |
| X4 | CFG/Unparseable layer in view | fault-injection | L1 | automated | `.mcp.json` unparseable, `.pi/mcp.json` + global valid | effective view for cwd | 200; `layerErrors:[{path:<cwd>/.mcp.json,message}]`; servers from the two valid layers present; server only in broken layer absent |
| X5 | CFG/Network guard | fault-injection (guard refuses) | L1 | automated | `networkGuard` preHandler stub replies 403 | `GET /effective`, `GET /schema`, `GET /adapter`, `PUT /servers/x`, `DELETE`, `PUT …/disabled`, `PUT /settings` | each: 403 body from guard; ConfigIO spy 0 reads/0 writes; adapter port 0 calls |
| X6 | CFG/Auth | fault-injection | L1 | automated | request without plugin auth | every route | same rejection status other plugin routes give; no IO |
| X7 | CFG/Adapter port throws during read | fault-injection (abort) | L1 | automated | port `loadMcpConfig` throws `Error("boom")` | `GET /effective` | 500 with sanitised message (no stack, no file contents); process alive; subsequent request works |
| X8 | CFG/Adapter timeout (D10) | fault-injection (delay) | L1 | automated | worker script that busy-loops (sync) forever; `adapterLoadTimeoutMs: 1000` | `GET /effective` | 504 `{error:"adapter-timeout",timeoutMs:1000}` at t≈1000ms (±200); a `setTimeout(…,500)` scheduled at t=0 fires by t=700 (event loop free); `worker.terminate` called 1×; next `GET /effective` with a sane worker → 200 and `Worker` constructor count now 2 |
| X8b | CFG/Adapter timeout BVA | BVA (config range) | L1 | automated | plugin-config writes `999`, `1000`, `120000`, `120001`, `"10s"`, `10000.5` | `POST /api/config/plugins/mcp-client` | 400 / 200 / 200 / 400 / 400 / 400; after each 400 the next request's port call still receives the previous accepted value |
| X8c | CFG/Enable merge times out | fault-injection (delay) | L1 | automated | entry `{command:"a",disabled:true}`; merge load hangs | enable at global | 504; file entry is `{command:"a"}` (removal landed, no `disabled:false`); exactly 1 write |
| X8d | CFG/Write-only ops never spawn worker | EP | L1 | automated | factory with default port | `ensureServerEntry`, `checkConfigFiles`, `ensureAdapterPackage`, `readServerEntry`, `setDirectTools` | `Worker` constructor spy count 0 |
| X9 | SET/Verdict after install | fault-injection (state change) | L1 | automated | verdict `absent` cached; then adapter package appears on disk | install action completes | client issues `GET /adapter?fresh=1` (or equivalent bust) immediately; server re-probes (fs read count +1 despite TTL); pill/banner/readOnly flip to `ok` in one render |
| X10 | CFG/Service disabled | fault-injection (dependency absent) | L1 | automated | `mcp-client` disabled | loader | `ctx.consume("mcp-client.config")` from another plugin → `undefined`; apple-tools not loaded; index `missingDeps` |
| X11 | APL/Consume undefined | fault-injection | L1 | automated | apple-tools registered without mcp-client (loader bypassed in test) | `registerPlugin` | throws with message naming `mcp-client.config`; no partial route registration |
| X12 | APL/write-failed mapping | fault-injection | L1 | automated | stubbed service `ensureServerEntry` → `write-failed{code:ENOSPC}` | installer write run | terminal state `CONFIG_WRITE_FAILED`; message contains `ENOSPC`; exit non-zero |
| X13 | APL/Other refusals mapping | decision-table | L1 | automated | service → `unparseable` / `entry-not-object` / `transport-conflict` / `invalid-name` | write run | each → `CONFIG_UNPARSEABLE`; the closed 9-state enum has no new member (type test) |
| X14 | APL/Check-mode parity | EP | L1 | automated | existing `iMCP {url:"u"}` | `--check` then write run | both `CONFIG_UNPARSEABLE` with transport-conflict message; write run performed 0 writes |
| X15 | APL/CLI hostless | fault-injection (no host) | L1 | automated | run `bin/install.ts` entry with no dashboard ctx, `PI_CODING_AGENT_DIR=<tmp>`, fake `imcp-server` binary | write run | `<tmp>/mcp.json` gains `iMCP.command`; `<tmp>/settings.json` packages gains `npm:pi-mcp-adapter`; `grep -r "mcpServers" packages/apple-tools/src` finds no writer |
| X16 | DMS/Verdict degrade | fault-injection | L1 | automated | mcp-client disabled | provisioning surface reads adapter state | `{kind:"unknown",floor:"2.20.0"}`; `/mcp` route still 200 |
| X17 | DMS/Warn once on first /mcp | state-transition | L1 | automated | verdict `below-floor` | register plugin; then 3 requests to `/mcp` | logger.warn count: 0 after register; 1 after first request; still 1 after third |
| X18 | DMS/Boot provisioning refuse | fault-injection | L1 | automated | global file unparseable | server boot | provisioning error surfaced in log; file byte-identical; server still starts |
| X19 | SET/Effective fetch fails | fault-injection | L1 | automated | `GET /effective` → 500 | render section | error state with retry action; no skeleton stuck; retry issues a new fetch |
| X20 | SET/Save fails | fault-injection | L1 | automated | editor Save → PUT 409 unparseable | Save | editor stays open; summary shows server message with path; fields keep operator values |
| X21 | FLD/Undo fails | fault-injection | L1 | automated | Undo PUT → 500 | click Undo | error toast containing the removed entry as copyable JSON (`<pre>`/`<code>` text deep-equals the DELETE `removed` payload); chip stays absent |
| X22 | CFG/Concurrent writes | race | L1 | automated | two `ensureServerEntry` for different servers on the same file started in the same tick | await both | both results ok; final file contains both entries; ConfigIO write calls for that path did not overlap (second `writeFileAtomic` starts after first resolves — spy timestamps) |
| X23 | E2E/harness integration | end-to-end | L3 | automated | docker harness, both plugins enabled | toggle iMCP off on MCP page; run installer; then disable `mcp-client` + restart | harness `~/.pi/agent/mcp.json` `iMCP` has `disabled:true` AND `command`; plugins index shows apple-tools `missingDeps`; apple-tools panel has no Run installer |

---

## Coverage summary

- Requirements covered: 31/31 requirement headings (CFG 13, SET 10, FLD 6, APL 3 incl. REMOVED, DMS 2)
- Scenarios by class: edge 50 · perf 5 · frontend 35 · error 26
- Scenarios by level: L1 104 · L3 9 · electron 1 · — 1 (manual-only)
- Scenarios by disposition: automated 115 · manual-only 1
- Rows carrying `[NEEDS CLARIFICATION]`: none (13 resolved above, see D10 for X8)

## New infra needed

- X8 / P5 need a stub worker script (busy-loop) under the plugin's `__tests__/` — trivial.
- P4 (crash-consistency soak) needs a child-process harness that `SIGKILL`s a writer mid-sequence; none exists in `packages/*/src/**/__tests__/`. Small (one helper), L1.
- F24 needs `@axe-core/playwright` in `tests/e2e/` devDependencies if not already present.
- Otherwise none — L1 vitest with injected `ConfigIO`/adapter port and L3 Playwright vs the docker harness cover every row.
