# Test Plan: pi-settings-full-coverage

Stage: design   Generated: 2026-10-17

No clarifications are open. Every Triple below resolved from the specs and design.md.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | editor: Typed patch | EP | L1 | automated | schema module + pi `docs/settings.md` table | parity test runs | the typed key set equals the spec list (bool/enum/mixed/int/string/`enabledModels`); no `PI_MANAGED_SETTINGS_KEYS` member is present; every `def` equals the docs default |
| E2 | editor: Typed patch | BVA | L1 | automated | `autocompleteMaxVisible` = 2, 3, 20, 21; `editorPaddingX` = -1, 0, 3, 4; `tuiMode` = `"regular"` | `applyPiSettingsPatch` | 3/20 and 0/3 are written; 2, 21, -1 and 4 give `400` naming the key; `tuiMode` gives `400` with the JSON-editor pointer; the file is byte-identical |
| E3 | editor: Typed patch | decision-table | L1 | automated | `terminal.images` ∈ {`"kitty"`, `"iterm2"`, `"auto"`, `false`, `true`, `"x"`}; `quietStartup` ∈ {`true`, `false`, `"header"`, `"x"`} | patch | listed values are written; `true` for `terminal.images` and `"x"` give `400` |
| E4 | editor: Typed patch | EP | L1 | automated | file `{compaction:{enabled:true,futureKnob:1}, terminal:{futureLeaf:2}, packages:[…], retry:{…}}` | patch `{shellPath:"/bin/zsh", terminal:{images:false}}` | `shellPath` and `terminal.images` are set; `futureKnob`, `futureLeaf`, `packages` and `retry` are deep-equal to before |
| E5 | editor: Typed patch | EP | L1 | automated | patch `{enabledModels:["a/*",""]}`, `{enabledModels:[123]}`, `{enabledModels:"a/*"}` | patch | each gives `400` naming `enabledModels`; nothing is written |
| E6 | editor: Typed patch | EP | L1 | automated | patch `{terminal:null}`, `{defaultTools:["read"]}`, `{defaultModel:"x"}` | patch | `400`: block-null error, JSON-editor pointer for `defaultTools`, managed-key error for `defaultModel`; nothing is written |
| E7 | editor: Raw replacement | EP | L1 | automated | raw text `{"transport":"quic","tuiMode":"weird","terminal":5}` | raw PUT with fresh token | write succeeds (new typed keys are not raw-checked) |
| E8 | editor: Raw replacement | EP | L1 | automated | frozen `RAW_LEGACY_TYPED` list | test inspects it | it equals exactly the 10 pre-change keys |
| E9 | legacy: reported masked | BVA | L1 | automated | values of length 31, 32 and 64; `""`; non-string `123` | read | 31 → `••••`; 32 and 64 → `…` + last 4; `""` and `123` are not listed |
| E10 | legacy: reported masked | decision-table | L1 | automated | auth.json for provider: absent / api_key same value / api_key different value / oauth / corrupt file | read | state `none` / `same` / `different` / `different` / `different` |
| E11 | legacy: reported masked | EP | L1 | automated | `providers.azure-openai-responses.apiKey`, `providers.anthropic-api.apiKey` (anthropic is an OAuth id), top-level `apiKey`, `apiKeys:{…}` | read | providers `azure`, `anthropic`, none; `apiKeys` is not listed |
| E12 | legacy: Move | EP | L1 | automated | settings `{providers:{zai:{apiKey:K}}}` only under `providers` | move `providers.zai.apiKey` | auth.json `zai:{type:"api_key",key:K}`; settings has no `providers` key |
| E13 | legacy: Move | decision-table | L1 | automated | actions: move with state `same`; move providerless `apiKey`; move missing key; move `anthropicApiKey` + `providers.anthropic.apiKey` | POST | each gives `400` with the refreshed list; auth.json and settings.json are byte-identical |
| E14 | legacy: Remove | decision-table | L1 | automated | remove with state `none` / `different` / `same` | POST | `400` / `400` / key deleted with other keys unchanged and auth.json unchanged |
| E15 | editor: Model scope | EP | L1 | automated | `enabledModels` `["openrouter/*","*sonnet*","anthropic/claude-opus-5-5:high","anthropic/*:high"]` + catalogue | `parseScope` then `serializeScope` without edits | entry set unchanged; `openrouter/*` and `*sonnet*` are patterns, `claude-opus-5-5` is a pick (suffix kept), `anthropic` is a whole provider (suffix kept) |
| E16 | editor: Model scope | EP | L1 | automated | catalogue id `openrouter/x:free` | `parseScope(["openrouter/x:free"])` | classified as a pick with id `openrouter/x:free`, not as `openrouter/x` with level `free` |
| E17 | editor: Model scope | EP | L1 | automated | catalogue provider `nv` with ids `nv/meta/llama` and `nv/qwen` | user toggles provider `nv` on and serialises | output is explicit picks `["nv/meta/llama","nv/qwen"]`, not `nv/*` |
| E18 | editor: Model scope | state-transition | L1 | automated | `["deepseek/*"]`, catalogue `deepseek/deepseek-flash`, `deepseek/deepseek-v4-pro` | deselect `deepseek-flash` | serialises to `["deepseek/deepseek-v4-pro"]` |
| E19 | editor: Model scope | EP | L1 | automated | stored `[]` | load | mode "All models"; dirty = false; no `enabledModels` in the patch |
| E20 | editor: Available themes | EP | L1 | automated | stub scanner: global `nord.json` (`name:"nord"`), package `tokyo.json` (`name:"tokyo-night"`), package `nord.json` (`name:"nord"`), `bad.json` (unparseable), `system.json`, a name containing `/` | GET | `themes` = `["dark","light","nord","system","tokyo-night"]` sorted, one `nord`, no `bad`, no user `system` duplicate, no `/` name |
| E21 | legacy: parse errors | EP | L1 | automated | truncated file `{"anthropicApiKey": "sk-ant-secret-value` and `{"k": sk-ant-SEC}` | GET + raw PUT | `parseError` / `400` messages match `^Invalid JSON( at line \d+, column \d+)?$` and contain no `sk-ant` |
| E22 | electron: API key detection | EP | L1 | automated | electron source tree | test greps `packages/electron/src` for `writeApiKey` / writes of `anthropicApiKey` | zero matches outside tests; `hasApiKeyConfigured` tests still pass |
| E23 | feature-detection: Settings rows not an override | EP | L1 | automated | tmux spawn argv/env builder with no user `tuiMode` | build spawn command | no `tuiMode` in argv, env or written settings |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | editor: pi settings page | state-transition | L1 | automated | SettingsPanel render | open Settings | rail has `pi-settings`; the Sessions page has no `pi-settings-section`; the drift banner still renders on the new page when defaults differ |
| F2 | editor: Form rows | EP | L1 | automated | file without `compaction.reserveTokens`; file `{transport:"quic"}` | render, edit `steeringMode`, Save | the reserve row shows `16384` with no Changed pill; the transport control shows `quic` selected; the patch is exactly `{steeringMode:…}` |
| F3 | editor: Form rows | state-transition | L1 | automated | `autocompleteMaxVisible` input | type `25`, press Save | inline error naming 3 to 20; `save` mock not called; source stays dirty |
| F4 | editor: Form rows | EP | L1 | automated | file `{theme:"dark"}` | activate reset, Save | patch `{theme:null}` |
| F5 | editor: Filtering | EP | L1 | automated | full schema | filter `terminal.images` / toggle "Set or changed only" with file `{theme,enabledModels}` / filter `zzz` | only the Image protocol row visible / only Terminal theme + Model cycling scope rows / all categories hidden and a message names `zzz` |
| F6 | editor: Model scope | state-transition | L1 | automated | "Selected only" with nothing picked | Save | no request; the editor shows the at-least-one error |
| F7 | editor: Model scope | fault-injection (abort) | L1 | automated | `/api/models?annotated=1` rejects | render, edit an unrelated key, Save | the editor shows a notice with no toggles; the patch has no `enabledModels` |
| F8 | legacy: cleanup in page | state-transition | L1 | automated | legacy list with `same`, `none`, `different` and providerless entries | render Form mode, then JSON mode | Form: Remove / Move / manual text / manual text; JSON: no action buttons and a "runs from Form mode" text |
| F9 | legacy: cleanup in page | state-transition | L1 | automated | queued Move | Undo, then Save; separately queue Move, switch mode with Discard | no move request in either path; the page is not dirty from cleanup |
| F10 | legacy: cleanup in page + D9 | state-transition | L1 | automated | queued Move + `steeringMode` edit; migrate returns success with etag E2, patch returns `400` | Save | move sent once; patch sent with E2; queue empty; `form.steeringMode` keeps the user value; `jsonBase` equals the cleanup snapshot raw; a retry Save sends only the patch |
| F11 | legacy: cleanup in page + D9 | state-transition | L1 | automated | queued Move + a field error in the form | Save | no migrate request and no patch request |
| F12 | editor: pi settings page | state-transition | L3 | automated | docker harness, seeded settings.json `{theme:"dark"}` | navigate Settings → pi settings, set Steering mode = all, press panel Save | toast/status shows saved; GET `/api/pi-settings` returns `steeringMode:"all"` and `theme:"dark"` |
| F13 | legacy: cleanup in page | state-transition | L3 | automated | docker harness, settings.json with `openaiApiKey` (≥32 chars), auth.json without `openai` | open pi settings, click Move to Providers, Save | the warning disappears; the harness auth.json has `openai.type == "api_key"`; settings.json has no `openaiApiKey`; the page DOM never contains the full key |
| F14 | editor: pi settings page | visual/subjective | — | manual-only | pi settings page in base dark, base light and one palette (nord) at 375/768/1440 | a human compares it to the approved mockup | [judgment: layout, rhythm and focal Save match `mockups/pi-settings-ui` with no visual regressions] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | legacy: Move | fault-injection (abort) | L1 | automated | `writeCredentialIfAbsent` throws for the 1st move | move `openaiApiKey` | `5xx`/`4xx` envelope without the value; settings.json still has `openaiApiKey`; auth.json unchanged |
| X2 | legacy: Move (concurrent Providers save) | fault-injection (race) | L1 | automated | an `openai` credential is written between plan and phase 2 | move `openaiApiKey` | `409` with refreshed list; auth.json keeps the Providers credential; settings.json still has `openaiApiKey` |
| X3 | legacy: Move (stale at phase 3) | fault-injection (race) | L1 | automated | settings.json `openaiApiKey` changed to v2 after phase 2 | move `openaiApiKey` (v1) | `409`; settings.json has `openaiApiKey: v2`; auth.json has v1; a fresh read reports `different` |
| X4 | legacy: Move (stale token) | fault-injection | L1 | automated | `baseEtag` mismatches | POST | `409`; both files byte-identical |
| X5 | legacy: reported masked (leak) | fault-injection (sentinel) | L1 | automated | fixture key `sk-ant-LEAKSENTINEL-…` placed in settings.json; every legacy path exercised (read, move ok, move 400, 409, auth failure, corrupt auth.json) | capture responses + logger | the sentinel never appears outside the `raw` field |
| X6 | editor: Available themes | fault-injection (abort) | L1 | automated | scanner throws | GET `/api/pi-settings` | `200`; `themes` = `["dark","light","system"]` |
| X7 | legacy: Move (lock) | fault-injection (delay) | L1 | automated | the settings lock is held past the retry budget during phase 1 | POST | `503 busy`; no auth.json write |

---

## Coverage summary

- Requirements covered: 17/17. Editor: Typed patch, Raw replacement, page, Form rows, Filtering, Model scope, Available themes. Legacy: reported masked, parse errors, Move, Remove, cleanup in page. Electron: API key detection (added) and the removed requirement (E22). Feature detection: no-op record (E23).
- Scenarios by class: edge 23 · perf 0 (no latency or throughput requirement in the specs) · frontend 14 · error 7
- Scenarios by level: L1 41 · L2 0 · L3 2
- Scenarios by disposition: automated 43 · manual-only 1

## New infra needed

- None. L1 exemplars: `packages/server/src/__tests__/pi-agent-settings.test.ts`, `pi-agent-settings-pi-parity.test.ts`, `packages/server/src/routes/__tests__/pi-settings-routes.test.ts`, `provider-auth-storage.test.ts`, `scan-legacy-provider-ids.test.ts`, `pi-resource-scanner.test.ts`, `packages/client/src/components/__tests__/PiSettingsSection.test.tsx`, `SettingsPanel.test.tsx`, `packages/extension/src/__tests__/filter-enabled-models.test.ts`, `packages/electron/src/__tests__/wizard-state.test.ts`. L3 exemplar: `tests/e2e/pi-settings-editor.spec.ts`.
