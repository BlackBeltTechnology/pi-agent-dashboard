# Test Plan — retro-ux-model-selector

Stage: design   Generated: 2026-10-12

Levels: L1 = vitest (`packages/**/__tests__/*.test.ts[x]`). L3 = Playwright `tests/e2e/*.spec.ts` in the docker harness on the shared `captureStates` helper (`retro-ux-identity-connectivity`, spec `ui-state-capture`) with this change's fixtures (task 2.1). Probe matrix = `{base,dark}`, `{base,light}`, `{nord,dark}` × 375 / 768 / 1440; probes = `contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator` from `tests/e2e/helpers/computed-contrast.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | model-selector: RoleRef display — follows | EP | L1 | automated | `<RoleRef role="@fast" model="anthropic/claude-haiku-4-5" level="low" />` | render | text "@fast" in the role token; visible "claude-haiku-4-5"; `.sr-only` span "anthropic/"; `textContent` contains "anthropic/claude-haiku-4-5"; level chip "low" with sr-only "thinking"; no `aria-label` attribute |
| E2 | model-selector: RoleRef display — once / unresolved / labels | decision table (mode × model present × labels) | L1 | automated | `mode="once"` with model; `follows` with no model; `follows` with model + `labels={{ noModel: "Nincs modell" }}` and no model | render | once: model then "from @fast", no role token; no model: warning pill "No model assigned" with `--severity-warning-*` classes; translated label shown when passed |
| E3 | model-selector: RoleRef runtime boundary | EP | L1 | automated | source of `packages/dashboard-plugin-runtime/src/RoleRef.tsx` + `src/index.ts` | scan | exported from `index.ts`; no import path containing `packages/client`, `pi-dashboard-client-utils` or `fetch(` |
| E4 | model-selector: Role tab (MODIFIED) | EP | L1 | automated | `allowRoles`, roles fast (assigned, low), research (unassigned), nightly (custom); `current="@fast"` | open | tabs "Models"/"Roles" with `role="tab"`, `aria-selected`, `aria-controls`; Roles panel `role="tabpanel"`; fast row has check icon + `aria-current="true"` and renders RoleRef; research row shows "No model assigned" with `data-testid="role-unassigned"`; clicking `@fast` calls `onSelect("@fast")` |
| E5 | model-selector: Role tab — trigger | EP | L1 | automated | `current="@fast"` resolving to `anthropic/claude-haiku-4-5:low` | render | trigger visible text "@fast", "claude-haiku-4-5", "low"; `textContent` contains "anthropic/claude-haiku-4-5"; `aria-haspopup="dialog"` |
| E6 | model-selector: resolve once (MODIFIED) | EP | L1 | automated | `useRolePick` host picks `@coding` resolving to `anthropic/claude-sonnet-4-5:high` | pick | `model-via-role` text "from @coding"; session model + level set; no "via" text |
| E7 | model-selector: resolve once — notices | decision table (unassigned / level-skipped / unavailable) | L1 | automated | `/api/roles` stub per case | pick `@fast` | `role-pick-notice` is a warning callout (`--severity-warning-*` classes, icon, `role="status"`, `data-kind` kept); level-skipped text says the level was left unchanged |
| E8 | model-selector: favorites filter (MODIFIED) | EP | L1 | automated | two favorites, toggle handler | open; click filter; click ★ | filter text "Favorites only" with `aria-pressed`; pressed state uses `--tint-blue-*`; ★ `aria-label` "Favorite <model>", `aria-pressed`; no `text-amber-*`/`border-amber-*` class; ★ classes give 44 px below `sm`, 32 px from `sm` |
| E9 | model-selector: capability badges (MODIFIED) | EP | L1 | automated | models with `metadataSource` catalog / fallback / absent | open | catalog: icons, no "assumed"; fallback: icons + "assumed", badge `title` still contains "assumed"; absent: no badge; no `?` text |
| E10 | model-selector: refresh failures (MODIFIED) | EP | L1 | automated | non-empty list + 2 `refreshErrors` | open | `model-refresh-errors` holds a warning pill "2 providers unavailable" and a button "Open providers" with `data-testid="model-provider-settings-link"`; no provider names; models still selectable |
| E11 | model-selector: recovery + empty-and-errored (MODIFIED) | decision table (errors none / some) | L1 | automated | empty list after post-open `models_list`, with and without `refreshErrors` | open; rerender | headline "No models available", help line, secondary button "Open provider settings" (`model-provider-settings-link`); no Retry control; reopen fires one refresh |
| E12 | model-selector: conformance — refreshing / no roles / headers | EP | L1 | automated | empty list awaiting refresh; Roles tab with no roles; populated list | open | refreshing line has `role="status"` + spinner; no-roles text says where to define roles; group headers 12 px semibold `--text-secondary`; sublabel/ctx not `--text-muted`; no palette class in the dropdown |
| E13 | role-model-bindings: status vocabulary | decision table (ok / detached / dangling) | L1 | automated | `GET /api/roles/used-by` with three entries for `@fast` | render roles page | ok: no pill; detached: pill "Detached" `data-status="detached"`; dangling: pill "Role unassigned, keeps its last model"; entry text "blackhole · observerModel" kept; role rendered by RoleRef |
| E14 | role-model-bindings + blackhole: chain slot statuses | EP | L1 | automated | chain entries: `@coding` detached (file value `anthropic/claude-sonnet-4-5`), `@research` dangling (last model kept), `@research` just picked (no value) | render ChainEditor | summaries render RoleRef with the file value; pills per E13; third shows "No model assigned"; detached slot shows a warning callout with "Reattach to @coding"; `…-entry-0-role` text is exactly "@coding" |
| E15 | blackhole: level-drop notice | EP | L1 | automated | entry with `thinking: "high"` switched to a non-reasoning model | select | `blackhole-chain-observer-0-level-drop` is a warning callout containing "high" and "so the level was dropped"; no emoji |
| E16 | blackhole: no hex fallbacks | EP | L1 | automated | source of `BlackholeSettings.tsx` | scan | no `var(--severity-[a-z-]+,#` match |
| E17 | roles-settings-ui: global assignment (MODIFIED) | EP | L1 | automated | roles map with fast assigned, research unassigned | render; click research pill | pills render RoleRef; research pill shows "No model assigned" and clicking it opens `roles-model-picker`; no "+ Add model" text |
| E18 | roles-settings-ui: conformance | decision table (dirty / setup / level drop) | L1 | automated | pending change on coding; no assigned roles; editing coding with an unsupported level | render | dirty: "Unsaved" pill with `roles-row-coding-dirty`; setup: callout with "No roles have been set up — set up now" and `--severity-warning-*` classes; level drop: callout "…so the level was dropped."; no class references `--accent-warning`; headings 12 px semibold secondary |
| E19 | automation-content-view: role hint | EP | L1 | automated | pick `@coding` in CreateAutomationDialog | select | `create-model-role-level-hint` text names `@coding` and says model and thinking level follow the role; no level control |
| E20 | grammar-settings-plugin: model-required prompt | EP | L1 | automated | grammar draft with no `llm` | render | `grammar-model-required` is a warning callout ≥ 12 px with `--severity-warning-*` classes |
| E21 | cross-cutting: i18n | EP | L1 | automated | every key from task 3.11 (client, roles, blackhole, automation, grammar) | key sweep + `node scripts/i18n-parity.mjs` | each key present in en, hu, zh-CN; parity exit 0 |
| E22 | regression: existing suites after task 3.10 | regression | L1 | automated | `ModelSelector.test.tsx`, `role-pick.test.tsx`, `OpenSpecRunConfig.test.tsx`, `RolesSettingsSection.test.tsx`, `ChainEditor.test.tsx`, `BlackholeSettings.test.tsx`, `CreateAutomationDialog.test.tsx`, `GrammarSettings.test.tsx` | run | all pass with only the edits task 3.10 lists |

### Performance

None. No new fetch: `RoleRef` is presentational; role data still comes from the existing `GET /api/roles` on open (`model-selector` "Model list refresh on dropdown open" unchanged).

### Frontend quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | model-selector: keyboard grid | state-transition | L1 | automated | 4 models, empty filter | open; ArrowDown ×2; Enter | filter `role="combobox"`, `aria-haspopup="grid"`, `aria-expanded="true"`; list `role="grid"`, rows `role="row"`, rowgroups `aria-labelledby` header ids; `aria-activedescendant` moves row 1 → 3; `onSelect` called with row 3's `provider/id` |
| F2 | model-selector: keyboard grid — ★ cell and caret | state-transition (caret at end / mid-text) | L1 | automated | filter "" then "sonnet" with caret after "son" | ArrowRight, Enter; then ArrowRight | empty filter: active descendant becomes the ★ cell and Enter toggles favorite once; mid-text: caret moves, active descendant unchanged |
| F3 | model-selector: tabs + popover | state-transition | L1 | automated | `allowRoles`, open on Models | ArrowRight on the tablist; Escape | Roles tab selected and focused (roving `tabindex`); panel `role="dialog"` `aria-modal="false"` `aria-label` "Choose a model"; Escape closes and focus is on the trigger |
| F4 | model-selector: current model not by colour | EP | L1 | automated | `current` = second model | open | that row has `aria-selected="true"` and a check icon; no `text-[var(--accent-blue)]` class on any row |

### Error handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | model-selector: resolve once — roles API down | fault-injection (500) | L1 | automated | `/api/roles` → 500 | pick `@fast` in a session picker | session model unchanged; `role-pick-notice` warning callout with `data-kind="unavailable"` |
| X2 | model-selector: Role tab — roles plugin absent | fault-injection (404) | L1 | automated | `/api/roles` → 404 with `allowRoles` | open | no tablist rendered; Models grid behaves as before |

### L3 — rendered UI (docker harness)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| G1 | model-selector: conformance — probes | EP over fixture states | L3 | automated | picker fixtures `models`, `favs`, `nomatch`, `refreshing`, `empty`, `errors`, `roles`, `noroles` | `captureStates` over the probe matrix | 0 contrast/size/focus failures in every state, theme and width |
| G2 | model-selector + role-model-bindings + automation + grammar: host probes | EP over fixture states | L3 | automated | host fixtures `persistent`, `once`, `notice`, `runconfig`, `automation`, `chain` | `captureStates` | 0 failures |
| G3 | roles-settings-ui: probes | EP over fixture states | L3 | automated | roles fixtures `pills`, `setup`, `editor` | `captureStates` | 0 failures |
| G4 | model-selector: targets at widths | BVA (375 / 1440) | L3 | automated | composer trigger, ★ toggles, tabs | measure boxes | ≥ 44 px tall (★ 44×44) at 375; ≥ 32 px at 1440 |
| G5 | model-selector: RoleRef uniform across hosts | EP | L3 | automated | `@fast` → `anthropic/claude-haiku-4-5:low` shown in the grammar trigger, the Roles tab row and the roles settings pill | read rendered RoleRef nodes | identical visible text ("@fast", "claude-haiku-4-5", "low") and identical accessible text in all three |
| G6 | model-selector: keyboard end-to-end | state-transition | L3 | automated | composer with ≥ 3 models | Tab to trigger, Enter, type "son", ArrowDown, Enter | dropdown opened with focus in the filter; the selected model becomes the composer model; focus back on the trigger |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | visual fidelity to the approved board | visual/subjective | — | manual-only | `mockups/after/**` vs the proposed column of `mockups/model-selector.html` | human side-by-side review | [judgment: real render matches the approved design] |

---

## Coverage summary

- Requirements covered: 16/16 — model-selector 10 (RoleRef display E1 E2 E3 G5; keyboard grid F1 F2 F3 F4 G6; conformance E12 G1 G4; Role tab E4 E5 X2; resolve once E6 E7 X1; favorites E8; capability badges E9; refresh failures E10; recovery + empty-and-errored E11), role-model-bindings 1 (E13 E14), roles-settings-ui 2 (E17 E18 G3), blackhole-plugin-settings 1 (E14 E15 E16), automation-content-view 1 (E19 G2), grammar-settings-plugin 1 (E20 G2)
- Scenarios by class: edge 22 · perf 0 · frontend 4 · error 2 · rendered-UI 6 · manual 1
- Scenarios by level: L1 28 · L2 0 · L3 6 · — 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- Fixtures `tests/e2e/fixtures/retro-ux/model-selector.ts` (task 2.1) and `retro-ux-identity-connectivity` task 2.1 (`ui-capture.ts`).
- New `packages/dashboard-plugin-runtime/src/__tests__/RoleRef.test.tsx` (exemplar `SlotPill.test.tsx`).
