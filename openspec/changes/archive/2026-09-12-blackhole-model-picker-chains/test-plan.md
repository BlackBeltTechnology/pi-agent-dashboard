# Test Plan — blackhole-model-picker-chains

Stage: design   Generated: 2026-05-20

Stance: falsify. Requirement refs point at `specs/blackhole-plugin-settings/spec.md` scenario titles and `design.md` decisions. Registry = `GET /api/models`; in L1 it is mocked via `fetch`, in L3 via `page.route` (see `tests/e2e/settings-default-model-catalogue.spec.ts`). Config in L3 is `page.route`d on `/api/plugins/blackhole/config` exactly as `tests/e2e/blackhole-settings.spec.ts` does. Every L1 payload assertion round-trips through the real `validateBlackholeConfig`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Adding to an empty chain / D5 | BVA (chain length 0) | L1 | automated | `entries = []`, `ref = {provider:"p", id:"m"}` | `appendEntry(entries, ref)` | returns `[ref]`; `writeChain` of it yields `{ primary: ref, fallbacks: undefined }`; input array unchanged |
| E2 | Adding to a non-empty chain / D5 | BVA (length 1 and 3) | L1 | automated | `entries = [A]` and `[A,B,C]` | `appendEntry(entries, D)` | `[A,D]` and `[A,B,C,D]`; `writeChain` puts `D` last in fallbacks; input arrays unchanged |
| E3 | Candidates come from the registry only / D6 rank | EP (rank buckets) | L1 | automated | registry `[x-mini, y-haiku, z-flash, w-other]` (all distinct providers) | `recommendedDefaults(models)` | `chain` ids ordered `z-flash, y-haiku, x-mini`; `w-other` absent; `found: true` |
| E4 | D6 registry order within rank | stable-sort | L1 | automated | registry `[p1/a-flash, p2/b-flash, p3/c-flash]` | `recommendedDefaults` | ids in exactly registry order `a-flash, b-flash, c-flash` |
| E5 | Staged content (cap 3, no dup) | BVA (4 candidates, 1 duplicate) | L1 | automated | registry with 4 distinct-provider flash rows plus a duplicate `provider/id` of the first | `recommendedDefaults` | `chain.length === 3`, no two entries share `provider/id`, each entry deep-equals `{provider,id,cooldownHours:1}` with no other keys |
| E6 | Distinct-provider preference / D6 | decision-table | L1 | automated | registry `[g/1-flash, g/2-flash, g/3-flash, d/4-mini]` | `recommendedDefaults` | chain = `g/1-flash, d/4-mini, g/2-flash` (provider not yet present beats higher-ranked same-provider; fill by rank afterward) |
| E7 | No candidate available / D6 | BVA (0 matches) | L1 | automated | registry `[]` and registry `[a/b-pro]` | `recommendedDefaults` | `{ chain: [], found: false }` for both; input not mutated |
| E8 | D1 slash-bearing id mapping | EP (id contains `/`) | L1 | automated | `GET /api/models` 200 `data:[{id:"openrouter/meta/llama-3", provider:"openrouter", reasoning:true}]` | `getModels()` | `{kind:"ok", models:[{provider:"openrouter", id:"meta/llama-3", reasoning:true}]}` |
| E9 | D1 no `thinkingLevelMap` consumption | negative | L1 | automated | 200 row with `thinkingLevelMap:{high:null, max:"max"}` | `getModels()` | returned `ModelInfo` carries no `supportedThinkingLevels` and no `thinkingLevelMap` key |
| E10 | Model is chosen from the live registry (slash id, exact match) / D1 write direction | EP | L1 | automated | ChainEditor with registry ok containing `openrouter/meta/llama-3` and `openrouter/meta`; entry 0 expanded | model primitive `onSelect("openrouter/meta/llama-3")` | `onChange` entry 0 = `{provider:"openrouter", id:"meta/llama-3", ...}` (never `id:"llama-3"` nor `provider:"openrouter/meta"`) |
| E11 | Thinking level uses the shared level picker (clamp) / D4 | EP (supportedLevels) | L1 | automated | registry ok; entry model row `reasoning:true`; override enabled | render | level primitive receives `supportedLevels` deep-equal `["off","minimal","low","medium","high","xhigh"]` — never `max` |
| E12 | Non-reasoning model → `off` only / D4 | EP | L1 | automated | entry model row `reasoning:false`; override enabled | render | level primitive receives `supportedLevels: ["off"]` |
| E13 | Inherited thinking is distinguishable from `off` / D4 | state-transition | L1 | automated | loaded entry `{provider,id}` (no `thinking`) | (a) render; (b) enable override; (c) disable override | (a) checkbox unchecked, no level primitive rendered, text "inherit"; (b) `onChange` entry has `thinking:"off"` and primitive rendered with `current:"off"`; (c) `onChange` entry has no `thinking` key (`normalizeModel` round-trip) |
| E14 | Base model set / D7 | EP (never-set → set) | L1 | automated | config file without `model`; registry ok | base-model primitive `onSelect("g/x-flash")`, Save | PUT body `model` deep-equals `{provider:"g", id:"x-flash"}`; every chain tail text contains `x-flash` before Save |
| E15 | Clearing the base model / D7 | EP (file-set → cleared) | L1 | automated | config file `model:{provider:"g",id:"x"}` | clear control, Save | PUT body has `model: null`; passes `validateBlackholeConfig` |
| E16 | D7 clear on never-set is a no-op | boundary | L1 | automated | config file without `model` | clear control | Save stays absent (payload equals baseline); PUT body, if forced, has no `model` key |
| E17 | Staged content (all three workers + debug) / D6 | decision-table | L1 | automated | file: all chains empty, `debug:false`, `debugLog:false`, `observeAfterTokens:15000`; registry with 2 flash rows | defaults action, Save | PUT body: `observerModel`/`reflectorModel`/`dropperModel` = first candidate, each `*FallbackModels` = `[second]`, `debug:true`, `debugLog:true`; `observeAfterTokens` absent from body (untouched) |
| E18 | Defaults are staged, not written (dirty gate) / D6 | state | L1 | automated | as E17 | defaults action (no Save) | `fetch` PUT never called; host save control rendered; draft differs from baseline |
| E19 | No candidate available (UI) | BVA | L1 | automated | registry ok `[a/b-pro]` | render | defaults button `disabled`; explanation text names flash/haiku/mini; clicking fires no confirm dialog |
| E20 | Existing chains are replaced only on confirmation / D6 | decision-table (empty vs non-empty × confirm/decline) | L1 | automated | (a) all chains empty; (b) observer has 1 entry | defaults action; for (b) decline, then confirm | (a) no `ui:confirm-dialog` mounted, staged immediately; (b) dialog mounted; decline → draft byte-equal to before; confirm → staged per E17 |
| E21 | D6 fewer-than-3 copy | BVA (1 candidate) | L1 | automated | registry with exactly one flash row | defaults action | staged chain length 1 for each worker; visible copy states fewer than three models were staged |
| E22 | Picking a model clears `contextWindow` / D4 | state | L1 | automated | entry `{provider:"a",id:"b",contextWindow:200000,cooldownHours:2,thinking:"high"}`; new row `reasoning:true` | pick `c/d` | `onChange` entry = `{provider:"c",id:"d",cooldownHours:2,thinking:"high"}` — no `contextWindow` |
| E23 | Picking a non-reasoning model drops an incompatible level / D4 | state-transition | L1 | automated | entry `thinking:"high"`; new row `reasoning:false` | pick | `onChange` entry has no `thinking`; override checkbox unchecked; notice element `blackhole-chain-<worker>-<i>-level-drop` visible with text naming the dropped level |
| E24 | Pick of a non-reasoning model with `thinking:"off"` keeps it | boundary | L1 | automated | entry `thinking:"off"`; new row `reasoning:false` | pick | `thinking:"off"` retained; no drop notice |
| E25 | Add flow cancel leaves chain unchanged / D5 | state-transition (illegal edge) | L1 | automated | observer chain `[A]`; registry ok | activate add control, then Escape / blur without pick | `onChange` never called; adding row unmounted; chain still `[A]` |
| E26 | Add flow appends `{provider,id}` only / D5 | EP | L1 | automated | observer chain `[A]` | add control → primitive `onSelect("g/x-flash")` | `onChange([A, {provider:"g", id:"x-flash"}])` — exactly two keys on the new entry; adding row unmounted |
| E27 | Registry client failure classes → result, never throw / D1 | EP (503, network error, malformed body, 200 non-list) | L1 | automated | `fetch` mocked: 503; rejects; 200 `{}`; 200 `{data:"x"}` | `getModels()` | each resolves `{kind:"unavailable", reason:<string>}`; no rejection |
| E28 | i18n parity for new keys | static | L1 | automated | `i18n.ts` after change | `scripts/i18n-parity.mjs` / existing parity test | zero missing keys between `zh-CN` and `hu`; `mProvider`/`mModelId` absent from both |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D6 pure function on a large registry | micro perf (timed) | L1 | automated | 2000-row synthetic registry, 400 matching | `recommendedDefaults` completes < 50 ms in vitest | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Adding an entry to an empty chain (rendered) | state-convergence | L3 | automated | routed config: no observer keys; routed `/api/models` 200 with `[g/x-flash, d/y-mini]` | keyboard-only: Tab to `Add model to observer chain`, Enter, pick `x-flash` | `blackhole-chain-observer-empty` gone; one entry row rendered with text `g/x-flash`; host Save bar present |
| F2 | Adding an entry to an empty chain (empty state) | rendered | L3 | automated | routed config with no observer keys; registry ok | load page | `blackhole-chain-observer-empty` visible and its text mentions base/session tail; add button in accessibility tree with name containing "observer" |
| F3 | Model is chosen from the live registry (no free text) | a11y-tree | L3 | automated | routed config observer `[A]`; registry ok | expand entry | accessibility tree has no `textbox` named "Provider…"/"Model ID…"; has a `button` (model picker trigger) inside a `group` whose name contains "observer" and "1" |
| F4 | Entry not present in the registry is still shown | convergence | L3 | automated | routed config observer `[{provider:"legacy",id:"gone"}]`; registry ok without it | load; reorder via keyboard; reload | trigger text shows `legacy/gone` before and after; move/remove buttons enabled per position; after reload without Save the value is unchanged |
| F5 | Registry request fails (rendered) | state-transition | L3 | automated | routed config observer `[A,B]`; `/api/models` routed to 503 | load | entries `A`,`B` rendered with stored ids as plain text (no picker `button`); add button `disabled`; base-model control `disabled`; defaults `disabled`; message + `Retry` button visible; move-down on `A` still reorders |
| F6 | Registry request fails → retry converges to ok | state-transition | L3 | automated | as F5, then re-route `/api/models` to 200 | click `Retry` | message gone; add button enabled; picker trigger rendered on entries; exactly one additional `/api/models` request observed |
| F7 | Registry request is pending | state (in-flight) | L3 | automated | `/api/models` routed to a deferred (never-resolving until released) response | load | add/base/defaults `disabled`; no unavailable message; after releasing the response, controls enable without reload |
| F8 | Registry lists no models | state | L3 | automated | `/api/models` 200 `{object:"list", data:[]}` | load | registry-dependent controls disabled; message states no credentialed models; no `Retry` button |
| F9 | Setting the base model updates every tail before Save | convergence | L3 | automated | routed config, no `model`; registry ok | pick base model `g/x-flash` | all three `blackhole-chain-<worker>-tail-base` texts contain `x-flash`; Save bar present; no PUT yet (route counter 0) |
| F10 | Existing chains are replaced only on confirmation (rendered) | dialog flow | L3 | automated | routed config observer `[A]`; registry ok with 2 flash rows | click defaults, press Escape; click defaults, confirm | after Escape: observer still `[A]`, no Save bar; after confirm: observer rows show the two flash ids; Save bar present |
| F11 | Adding an entry — keyboard only end-to-end | keyboard | L3 | automated | as F1 | Tab/Enter/arrow only, no mouse | new entry appears; focus lands on the new entry's picker trigger or the add button (assert focus is within the chain region, not lost to body) |
| F12 | Look and feel of the picker inside the chain card | visual/subjective | — | manual-only | `/settings/plugins/blackhole` with 3 populated chains | human looks across themes | [judgment: picker density and alignment with the roles page — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Save with a picked model still passes the server validator | fault-injection (PUT 400) | L1 | automated | `PUT /api/plugins/blackhole/config` routed to 400 `{error:"observerModel.thinking must be one of…"}` | Save after staging | host error surface shows the server message; draft not reset; Save remains available |
| X2 | Registry fails after a successful load | fault-injection (abort mid-session) | L1 | automated | first `getModels` ok; click Retry with fetch rejecting | Retry | state transitions `ok → unavailable`; existing entries keep their stored ids; picker no longer mounted |
| X3 | Malformed registry row skipped, not fatal | fault-injection (bad data) | L1 | automated | 200 `data:[{id:"g/x"}, {provider:"d"}, {id:"d/y", provider:"d"}]` | `getModels()` | `kind:"ok"` with models `[g/x, d/y]` (row without `id` dropped; missing `provider` derived only when `id` has a `/` — else dropped) |
| X4 | Defaults with a registry that changed between load and click | race | L1 | automated | registry ok at load; retry returns `[]` before click | defaults click | button disabled after the retry resolves; no chain staged |

---

## Coverage summary

- Requirements covered: 22/22 spec scenarios (every MODIFIED + ADDED scenario has ≥1 row) + design D1–D7
- Scenarios by class: edge 28 · perf 1 · frontend 12 · error 4
- Scenarios by level: L1 33 · L2 0 · L3 11
- Scenarios by disposition: automated 44 · manual-only 1

## New infra needed

- none — L1 uses the existing vitest + `validateBlackholeConfig` round-trip pattern in `packages/blackhole-plugin/src/**/__tests__/`; L3 extends `tests/e2e/blackhole-settings.spec.ts` with `page.route` on `/api/models` (pattern in `tests/e2e/settings-default-model-catalogue.spec.ts`).
