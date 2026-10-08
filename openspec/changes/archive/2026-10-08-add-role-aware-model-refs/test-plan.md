# Test Plan — add-role-aware-model-refs

Stage: design   Generated: 2026-10-08

Clarifications resolved at the hard gate (folded into `specs/role-model-bindings/spec.md`): projection deadline ≤ 5 s; scale 1000 bindings; automation "used by" covers global + every loaded folder.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | role-model-bindings: value grammar | EP | L1 | automated | `@coding:high` | `parseModelRef` | `{kind:"role", role:"coding", level:"high"}` |
| E2 | role-model-bindings: value grammar | BVA (`:` boundary) | L1 | automated | `openrouter/vendor:free` | `parseModelRef` | `{kind:"direct", model:"openrouter/vendor:free"}`, no level |
| E3 | role-model-bindings: value grammar | EP (invalid) | L1 | automated | `@bad name`, `@`, `@fast:` | `parseModelRef` | each rejected as invalid ref (no role kind returned) |
| E4 | role-model-bindings: shared resolver | decision-table (ref level × role level) | L1 | automated | roles `{fast:"anthropic/claude-haiku-4-5:low"}`; refs `@fast`, `@fast:medium`; role `{fast:"anthropic/claude-haiku-4-5"}` + `@fast` | `resolveModelRef` | levels `low`, `medium`, none respectively; model `anthropic/claude-haiku-4-5` in all |
| E5 | role-model-bindings: shared resolver | EP (unassigned) | L1 | automated | roles `{}` | `resolveModelRef("@research")` | `unresolved` with reason containing `research`; no model field |
| E6 | role-model-bindings: shared resolver (cfg.roles only) | decision-table | L1 | automated | `roles.fast=A`, `activePreset="cheap"`, `rolePresets.cheap.fast=B` | resolve `@fast` | resolves to `A` (preset not re-applied) |
| E7 | dashboard-roles-ownership (lookupRole contract kept) | regression | L1 | automated | `roles.fast="anthropic/claude-haiku-4-5:low"` | extension `lookupRole("@fast")` | `{literal:"anthropic/claude-haiku-4-5:low"}` verbatim |
| E8 | role-model-bindings: projectors | EP (field allow-list) | L1 | automated | blackhole projector registered | `replaceBindings("blackhole",[{field:"notAField",…}])` | rejected; store unchanged; projector `write` call count 0 |
| E9 | blackhole: acceptsField | BVA (chain index) | L1 | automated | fields `observerFallbackModels[0]`, `[7]`, `[-1]`, `observerFallbackModels`, `__proto__` | `acceptsField` | true, true, false, false, false |
| E10 | role-model-bindings: re-projection | state-transition | L1 | automated | binding `observerModel→@fast`, projected A | `providers.json` rewritten with `fast` unchanged but key order changed | 0 projector writes; pass log `unchanged:1` |
| E11 | role-model-bindings: status | state-transition (ok→dangling) | L1 | automated | binding projected `anthropic/claude-haiku-4-5` | `fast` removed from `roles` | status `dangling`; target still `anthropic/claude-haiku-4-5`; 0 writes |
| E12 | role-model-bindings: status | state-transition (ok→detached→ok) | L1 | automated | binding projected A; target edited to C | role change → pass; then `reattach` | after pass: `detached`, 0 writes; after reattach: 1 write with current resolution, status `ok` |
| E13 | role-model-bindings: store | EP | L1 | automated | binding projected A | unbind field | store lacks entry; target still A |
| E14 | blackhole: role-bound slot written concretely | EP | L1 | automated | PUT `observerModel:"@fast"`, `fast="anthropic/claude-haiku-4-5:low"` | blackhole PUT route | file `observerModel={provider:"anthropic",id:"claude-haiku-4-5",thinking:"low"}`; file text contains no `@`; binding recorded `ok` |
| E15 | blackhole: binding follows reorder | state-transition | L1 | automated | `observerFallbackModels[0]=@fast` (bound), `[1]=direct X` | PUT with entries swapped | binding now on `[1]`; `[0]` unbound; file `[0]=X` |
| E16 | blackhole: removing entry removes binding | state-transition | L1 | automated | `[1]` bound to `@fast` | PUT without `[1]`; then reassign `fast` | binding gone; pass writes nothing to `[1]` |
| E17 | blackhole: cooldown preserved | EP | L1 | automated | bound fallback entry `cooldownHours:2, contextWindow:64000` | reassign role | rewritten entry keeps `cooldownHours:2`, `contextWindow:64000` |
| E18 | blackhole: preset change rewrites only bound slots | decision-table | L1 | automated | `observerModel` bound, `reflectorModel` direct, unmanaged key `foo:1` | reassign `fast` | only `observerModel` changes; `reflectorModel` and `foo` byte-identical |
| E19 | grammar: llm oneOf | EP (invalid) | L1 | automated | `llm:{provider:"a",model:"b",role:"@fast"}` | configSchema validation | invalid |
| E20 | grammar: role pick persists | EP | L1 | automated | GrammarSettings, pick `@fast` on Role tab | Save Bar commit | POST body `llm:{role:"@fast"}`, no provider/model |
| E21 | grammar: preset change applies on next check | state-transition | L1 | automated | `llm.role="@fast"`, `fast`=A then B | two `/api/grammar/check` calls around reassignment | registry `find` called with A then B |
| E22 | grammar: direct unchanged | regression | L1 | automated | `llm:{provider,model}` | check | identical call to registry as before change |
| E23 | automation: role level suffix preserved | EP | L1 | automated | `fast="anthropic/claude-haiku-4-5:low"`, `model:"@fast"` | `resolveModel` | `anthropic/claude-haiku-4-5:low` |
| E24 | automation: unresolved role fallback | EP | L1 | automated | `model:"@gone"`, defaultModel D | `resolveModel` | `{model:D, error contains "@gone"}` |
| E25 | automation-content-view: custom role selectable | EP | L1 | automated | `/api/roles` includes custom `nightly` | open editor Role tab, pick `nightly` | saved yaml `model: "@nightly"`; no thinking-level control rendered |
| E26 | model-selector: Role tab gating | decision-table (allowRoles × /api/roles status) | L1 | automated | combos {absent,true}×{200,404} | render primitive | Role tab rendered only for (true,200) |
| E27 | model-selector: role pick emits ref | EP | L1 | automated | Role tab, roles incl. `fast` | click `fast` | `onSelect("@fast")` once |
| E28 | model-selector: current role ref | EP | L1 | automated | `current="@fast"`, `fast→anthropic/claude-haiku-4-5` | open picker | Role tab active; trigger text contains `@fast` and `anthropic/claude-haiku-4-5` |
| E29 | model-selector: unassigned flagged | EP | L1 | automated | role `research` unassigned | open Role tab | row `research` carries unassigned marker |
| E30 | plugin-ui-primitive-registry: contract | regression (type) | L1 | automated | three-prop call site | `tsc` on fixture | compiles; `UiPrimitiveMap["ui:model-selector"]` includes `allowRoles?: boolean` |
| E31 | model-selector: session one-shot | state-transition | L1 | automated | `coding→anthropic/claude-sonnet-4-5:high` | pick `@coding` in StatusBar | sends `set_model(anthropic/claude-sonnet-4-5)` then `set_thinking_level(high)`; trigger shows "via @coding" |
| E32 | model-selector: unsupported level skipped | decision-table | L1 | automated | resolved model `supportedThinkingLevels:["low","medium"]`, level `high` | pick role | `set_model` sent; no `set_thinking_level`; notice testid visible |
| E33 | model-selector: unassigned role no change | EP | L1 | automated | role unassigned | pick in StatusBar | no `set_model` sent; unassigned notice |
| E34 | model-selector: hint clears on direct pick | state-transition | L1 | automated | after E31 | user picks a direct model, `model_update` arrives | "via @coding" hint gone |
| E35 | role-model-bindings: used-by | EP | L1 | automated | blackhole `observerModel→@fast` (ok), grammar `llm.role=@fast`, one global + one folder automation `@fast` | read used-by for `fast` | 4 entries incl. blackhole status `ok`, both automations |
| E36 | role-model-bindings: service seam | regression | L1 | automated | `registerUsage` reporter | call dispose, read used-by | reporter not invoked; entries absent |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | role-model-bindings: deadline | threshold | L1 | automated | 1 binding, real temp-dir `fs.watch`, tmp+rename write of `providers.json` | target updated ≤ 5 s after rename | single change, 5 repeats, max |
| P2 | role-model-bindings: deadline at scale | threshold | L1 | automated | 1000 bindings over 3 fake projectors (in-memory write, 1 ms each), all `@fast` | all 1000 writes complete ≤ 5 s after rename | single reassignment |
| P3 | role-model-bindings: coalescing | threshold | L1 | automated | 5 writes to `providers.json` within 100 ms | exactly 1 projection pass logged | 2 s after last write |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | model-selector + blackhole + role-model-bindings | state-convergence | L3 | automated | harness with roles plugin; blackhole observer bound to `@fast` via UI | load another preset in Model roles page | blackhole settings slot converges to new concrete model ≤ 5 s; `GET` blackhole config shows it |
| F2 | model-selector: session one-shot | state-convergence | L3 | automated | harness session; pick `@coding` in StatusBar | load preset reassigning `coding` | status bar model stays the first resolution after 6 s |
| F3 | model-selector: Role tab keyboard | state-transition | L3 | automated | picker open with `allowRoles` | Tab to Role tab, ArrowDown, Enter | role selected; focus returns to trigger; tablist has `aria-selected` on active tab |
| F4 | role-model-bindings: used-by | state-convergence | L3 | automated | grammar `@fast` + blackhole `@fast` bound | open Model roles page | `@fast` row lists both usages with blackhole status |
| F5 | model-selector: Role tab visual fit | visual/subjective | — | manual-only | Role tab in narrow composer + settings dialog | human looks across 4 themes | [judgment: resolution text legible, no clipping — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | role-model-bindings: corrupt store | fault-injection (abort) | L1 | automated | `role-bindings.json` = `{not json` | service boot | starts with 0 bindings; one log line naming the file; 0 projector writes |
| X2 | role-model-bindings: projector failure isolation | fault-injection (abort) | L1 | automated | owner A `write` throws, owner B pending | pass | B written; log line with owner A + field; next pass retries A |
| X3 | role-model-bindings: absent owner | fault-injection (missing dep) | L1 | automated | bindings for `blackhole`, no projector registered | pass | pass log `skipped:N`, `failed:0`; store unchanged |
| X4 | role-model-bindings: load order | fault-injection (ordering) | L1 | automated | consumer registers projector after roles `onReady` boot pass | `registerProjector` | targeted pass writes that owner's changed bindings |
| X5 | role-model-bindings: change while down | state-transition | L1 | automated | store projected A; `providers.json` now maps role to B before service start | service boot (projector registered) | target written B during startup |
| X6 | role-model-bindings: atomic rename filename | fault-injection (platform) | L1 | automated | watcher receives event with filename `.providers.json.123.tmp` / `null` | debounce elapses | pass runs (hash compare), target updated |
| X7 | role-model-bindings: save vs pass race | fault-injection (interleave) | L1 | automated | slow blackhole save holding owner lock; `providers.json` change during it | pass for `blackhole` | pass runs after save; just-saved binding status `ok`, not `detached` |
| X8 | role-model-bindings: agent tool writer | integration | L1 | automated | temp HOME; `update_roles` set_role via role-model-tools writer | watcher | bound target re-projected |
| X9 | blackhole: unassigned role save | fault-injection (unresolved) | L1 | automated | PUT `observerModel:"@research"`, unassigned | route | 400 naming `@research`; file fingerprint unchanged; bindings unchanged |
| X10 | blackhole: roles plugin absent | fault-injection (missing service) | L1 | automated | bindings in store; service absent | PUT with concrete values; then PUT with `@fast` | first: file written, store byte-identical; second: rejected |
| X11 | blackhole: roles plugin returns after drift | state-transition | L1 | automated | binding projected A; file edited to C while service absent | service boot | binding `detached`; file still C |
| X12 | blackhole: external writer concurrent | fault-injection (interleave) | L1 | automated | fingerprint changes between projector read and write | projector write | no overwrite; binding `detached` |
| X13 | grammar: unassigned role check | fault-injection (unresolved) | L1 | automated | `llm.role="@fast"`, `fast` unassigned | `/api/grammar/check` | outcome code `model_role_unassigned`, message contains `@fast`; registry not called |
| X14 | role-model-bindings: inert without roles plugin | fault-injection (missing plugin) | L3 | automated | harness with roles plugin disabled | open blackhole settings + StatusBar picker | no Role tab in either; existing direct models editable as before |

---

## Coverage summary

- Requirements covered: 21/21 (role-model-bindings 9, model-selector 2, plugin-ui-primitive-registry 1, automation-run-lifecycle 1, automation-content-view 1, grammar-settings-plugin 2, blackhole-plugin-settings 1 + regressions on dashboard-roles-ownership)
- Scenarios by class: edge 36 · perf 3 · frontend 5 · error 14
- Scenarios by level: L1 52 · L2 0 · L3 5
- Scenarios by disposition: automated 57 · manual-only 1

## New infra needed

- none (L3 uses the existing docker harness; roles-plugin disabled state via existing plugin enable/disable config)
