# Test Plan — default-model-follows-role

Stage: design   Generated: 2026-11-17

No clarifications: every Triple fills from the delta scenarios and design D1–D6.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | design D1 shared helper | decision-table | L1 | automated | roles `{planning:"anthropic/claude-sonnet-5-5:high", coding:"claude-haiku-5-5"}`; values `@planning`, `@planning:medium`, `@ghost`, `@validate` (unassigned), `@coding`, `anthropic/x:high` | `resolveDefaultModel(value, cfg)` | `@planning` → `{provider:"anthropic", id:"claude-sonnet-5-5", level:"high"}`; `@planning:medium` → level `medium`; `@ghost`/`@validate`/`@coding` → `{unresolved}`; `anthropic/x:high` returned verbatim (no level strip) |
| E2 | bridge-extension "Role-ref default model resolves at application time" | EP | L1 | automated | `defaultModel:"@planning"`, roles `planning:"anthropic/claude-sonnet-5-5"`, registry has it | brand-new startup `applyDefaultModel()` | `pi.setModel` called once with `anthropic/claude-sonnet-5-5` |
| E3 | bridge-default-model-gate "Apply default thinking level…" | decision-table | L1 | automated | rows: (`@planning`, level `low`, role `:high`) / (`@planning`, `""`, `:high`) / (`@planning:medium`, `""`, `:high`) / (`@coding`, `""`, no level) / (concrete, `""`) | `applyDefaultModel()` after `setModel` resolves | `setThinkingLevel` called with `low` / `high` / `medium` / not called / not called |
| E4 | bridge-extension "Preset load changes the next new session's model" | state-transition | L1 | automated | `defaultModel:"@planning"`; role file returns `anthropic/claude-sonnet-5-5`, then `proxy/cc/claude-sonnet-5-5` | two successive `applyDefaultModel()` calls with the file swapped between | first `setModel` = anthropic model, second = proxy model (no cache) |
| E5 | bridge-extension unresolved + no-provider scenarios | EP | L1 | automated | `@validate` unassigned; `@coding` → `claude-haiku-5-5` | `applyDefaultModel()` | returns `null`; `setModel` not called; `pendingDefaultModel` stays `null`; exactly one log line containing `@validate` / `@coding` |
| E6 | bridge-extension "Resolved model from a late custom provider applies on retry" | state-transition | L1 | automated | `@planning` → `local/ocg/longcat-2.5-preview-free`, registry lacks it at startup | startup apply, then registry gains the model and the retry fires | startup returns pending; retry calls `setModel` with the local model; with the role file swapped before retry → the new resolution is applied |
| E7 | spawn-model-choice "Thinking-only choice pairs with a role default" (REST) | EP | L1 | automated | Settings `defaultModel:"@planning"`, role `:high` | `POST /api/session/spawn {cwd, thinkingLevel:"low"}` | spawn args contain `--model anthropic/claude-sonnet-5-5 --thinking low`; 200 |
| E8 | same, plugin road | EP | L1 | automated | `ctx.defaultModel:"@planning"` | `mapPluginSpawnOptions({thinking:"low"}, ctx)` | `options.model === "anthropic/claude-sonnet-5-5"`, `options.thinking === "low"`, no `warning` |
| E9 | spawn-model-choice "Thinking-only choice with an unresolved role default" | fault (abort) | L1 | automated | Settings `defaultModel:"@validate"` (unassigned) | REST spawn with only `thinkingLevel:"low"` | 200; no `--model`; `--thinking low`; response has no error |
| E10 | spawn-model-choice "Promoted role default that does not resolve warns" | EP | L1 | automated | browser `spawn_session {cwd, model:"@validate"}`, role unassigned | session-action-handler spawn | spawned without `--model`; `spawn_result.success === true` with `choiceWarning` containing `validate` |
| E11 | spawn-model-choice "Role default reaches pi with the role level from a spawn surface" | EP | L1 | automated | folder home with Settings defaults `{defaultModel:"@planning", defaultThinkingLevel:""}` | user presses send without touching chips | `onSpawnSession` receives `model:"@planning"` and no `thinkingLevel` key |
| E12 | settings-panel mirror "Role ref mirrors its resolved model and level" | EP | L1 | automated | pi settings `{defaultProvider:"x", defaultModel:"y"}`; role `planning:"anthropic/claude-sonnet-5-5:high"` | config save partial `{defaultModel:"@planning", defaultThinkingLevel:""}` | pi file has `defaultProvider:"anthropic"`, `defaultModel:"claude-sonnet-5-5"`, `defaultThinkingLevel:"high"`; other keys unchanged |
| E13 | settings-panel mirror "Unresolved role ref is skipped, not failed" | fault (abort) | L1 | automated | `@validate` unassigned | config save `{defaultModel:"@validate"}` | response mirror `{ok:true, skipped:"unresolved-role"}`; pi file byte-identical |
| E14 | settings-panel mirror level precedence | decision-table | L1 | automated | persisted `@planning` (role `:high`); saves `{defaultThinkingLevel:"low"}` then `{defaultThinkingLevel:""}` | two saves | pi level `low`, then `high` (both keys derived on a level-only save) |
| E15 | settings-panel mirror "Preset load re-mirrors" + "Unrelated role edit…" | state-transition | L1 | automated | remirror module seeded with `@planning` → anthropic model | sequence: seed; call (unchanged); swap `planning` → proxy, call; save `@planning` (mirror) then pi file edited by hand, change role `review`, call; set concrete default, change roles, call | writes: none / one (proxy keys) / none / none |
| E16 | roles plugin re-mirror wiring | state-transition | L1 | automated | roles plugin with a stub `host.remirrorPiDefaults`; and with none registered | watcher `onChange` fires (role hash change) | stub called once per change; with no service registered: no throw, no call |
| E17 | role-model-bindings "Default model listed under its role" / "Usage follows a changed default" | state-transition | L1 | automated | stub `host.defaultModelRef` returning `@planning`, then `undefined` | `GET /api/roles/used-by` twice | first lists `Default model (new sessions)` under `planning`; second lists it nowhere |
| E18 | pi-agent-settings-editor drift scenarios | decision-table | L1 | automated | resolved default `proxy/cc/claude-sonnet-5-5` vs pi `anthropic/claude-sonnet-5-5`; unresolved `@validate`; concrete `claude-opus-5-5` (no `/`) | `PiSettingsPage` render | drift action shown / hidden / hidden; triggering the first writes `proxy` + `cc/claude-sonnet-5-5` |

### Performance

None. The change adds no latency or throughput budget; resolution is a synchronous read of one small JSON file per session start / spawn, as the shipped spawn road already does.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel "Picking a role persists the ref" | state-transition | L1 | automated | `/api/roles` fixture (live `planning` → anthropic, active `Anthropic`) | open Default model picker → Roles tab → click `[data-role='planning']` → Save | `PUT /api/config` partial `{defaultModel:"@planning", defaultThinkingLevel:""}`; `model-trigger-role-ref` shows `@planning` + `claude-sonnet-5-5` |
| F2 | settings-panel "Concrete pick replaces a role ref" / "Re-picking the role drops a hand-written suffix" | state-transition | L1 | automated | config `@planning`, then `@planning:low` | pick `anthropic/claude-opus-5-5` on Models tab; separately pick `@planning` on Roles tab | partials `{defaultModel:"anthropic/claude-opus-5-5"}` and `{defaultModel:"@planning"}` |
| F3 | settings-panel "Roles API absent" / "No hint without the roles API" | fault (abort) | L1 | automated | config `@planning`; `/api/roles` → 404 | render Sessions page, open picker | trigger shows `@planning` token; no `model-tab-role`; no `default-model-follows` / `default-model-dangling` |
| F4 | settings-panel callout requirement (hint + dangling + no named preset) | decision-table | L1 | automated | fixtures: (`@planning`, active `Anthropic`) / (`@validate` unassigned, active `Free`) / (`@planning`, live group active) | render | `default-model-follows` contains `@planning`, `claude-sonnet-5-5`, `Anthropic`, via `[data-role-ref]` / `default-model-dangling` contains `@validate`, `Free` / hint without a preset name |
| F5 | settings-panel "read the roles API … after each Default Model pick" | state-convergence | L1 | automated | `/api/roles` fixture whose response changes after the first call | mount (1 fetch) → pick `@coding` | ≥2 `/api/roles` fetches; hint converges to the second response's model |
| F6 | settings-panel level control scenarios | decision-table | L1 | automated | (`@planning`, `""`, role `:high`) / same then pick `low` / (`@validate`, `""`) then pick `low` | render / select | shows `high` + `role` tag / partial `{defaultThinkingLevel:"low"}`, `defaultModel` unchanged, no tag / shows `role` placeholder (not `off`), partial `{defaultThinkingLevel:"low"}` |
| F7 | design D3 one notice per condition | EP | L1 | automated | save response mirror `{ok:true, skipped:"unresolved-role"}` with `@validate` | Save | `default-model-dangling` rendered; `default-model-pi-mirror-skipped` absent |
| F8 | settings-panel role pick end to end | state-transition | L3 | automated | docker harness with roles plugin, role `planning` assigned | Settings → Sessions → picker → Roles → `@planning` → Save, then reload | `GET /api/config` → `defaultModel:"@planning"`; after reload `default-model-follows` names the active preset and the planning model |
| F9 | settings-panel "Hint follows a preset switch" | state-convergence | L3 | automated | harness with two presets assigning `planning` differently; default `@planning` | load the second preset on the Model roles page, then open Settings → Sessions | hint names the second preset and its `planning` model; `GET /api/config` still `@planning` |
| F10 | design D3 hint layout | visual/subjective | — | manual-only | follow hint + dangling notice, dark and light, narrow settings width | human looks | [judgment: hint reads as one sentence, RoleRef aligned, no awkward wraps] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D1 / bridge-extension unresolved | fault-injection (abort) | L1 | automated | `providers.json` unreadable / invalid JSON | `applyDefaultModel()` with `@planning` | no throw; `setModel` not called; one log line naming `@planning` |
| X2 | settings-panel mirror "Unparseable pi file is never overwritten" on the re-mirror path | fault-injection (abort) | L1 | automated | `~/.pi/agent/settings.json` truncated JSON | `host.remirrorPiDefaults()` after a resolution change | no throw; file byte-identical; one log line with the parse outcome |

---

## Coverage summary

- Requirements covered: 9/9 delta requirements (settings-panel ×4, bridge-extension ×1, bridge-default-model-gate ×1, spawn-model-choice ×1, pi-agent-settings-editor ×1, role-model-bindings ×1)
- Scenarios by class: edge 18 · perf 0 · frontend 10 · error 2
- Scenarios by level: L1 26 · L2 0 · L3 2 · manual 1 (F10)
- Scenarios by disposition: automated 29 · manual-only 1

## New infra needed

- none (L3 rows run on the existing docker harness, which ships the roles plugin — see `tests/e2e/role-aware-model-refs.spec.ts`)
