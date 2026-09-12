## 1. Pure chain algebra (shared) — L1, see `packages/blackhole-plugin/src/shared/__tests__/chain-model.test.ts`

- [x] 1.1 Test `appendEntry` on an empty chain: `entries=[]`, `ref={provider:"p",id:"m"}` · call `appendEntry` · returns `[ref]`, `writeChain` gives primary only, input unchanged (test-plan #E1)
- [x] 1.2 Test `appendEntry` on `[A]` and `[A,B,C]` · call with `D` · `[A,D]` / `[A,B,C,D]`, `D` last fallback in `writeChain`, inputs unchanged (test-plan #E2)
- [x] 1.3 Test `recommendedDefaults` rank buckets: registry `[x-mini, y-haiku, z-flash, w-other]` distinct providers · call · ids `z-flash, y-haiku, x-mini`, `w-other` absent, `found:true` (test-plan #E3)
- [x] 1.4 Test registry order preserved within rank: `[p1/a-flash, p2/b-flash, p3/c-flash]` · call · exactly that order (test-plan #E4)
- [x] 1.5 Test cap + dedupe: 4 distinct-provider flash rows plus a duplicate `provider/id` · call · length 3, no duplicate `provider/id`, each entry deep-equals `{provider,id,cooldownHours:1}` (test-plan #E5)
- [x] 1.6 Test distinct-provider preference: `[g/1-flash, g/2-flash, g/3-flash, d/4-mini]` · call · chain `g/1-flash, d/4-mini, g/2-flash` (test-plan #E6)
- [x] 1.7 Test no candidate: registry `[]` and `[a/b-pro]` · call · `{chain:[], found:false}`, input not mutated (test-plan #E7)
- [x] 1.8 Timed test: 2000-row synthetic registry with 400 matches · call · completes under 50 ms (test-plan #P1)
- [x] 1.9 Implement `appendEntry` and `recommendedDefaults` in `packages/blackhole-plugin/src/shared/chain-model.ts` per design D5/D6; verify 1.1–1.8 pass and existing chain-model tests stay green.

## 2. Registry client — L1, see `packages/blackhole-plugin/src/client/__tests__/client-entry.test.ts` for the fetch-mock pattern

- [x] 2.1 Test slash-bearing id mapping: 200 `data:[{id:"openrouter/meta/llama-3", provider:"openrouter", reasoning:true}]` · `getModels()` · `{kind:"ok", models:[{provider:"openrouter", id:"meta/llama-3", reasoning:true}]}` (test-plan #E8)
- [x] 2.2 Test `thinkingLevelMap` is not consumed: row with `thinkingLevelMap:{high:null,max:"max"}` · `getModels()` · returned `ModelInfo` has no `supportedThinkingLevels` and no `thinkingLevelMap` (test-plan #E9)
- [x] 2.3 Test failure classes: fetch 503, fetch rejects, 200 `{}`, 200 `{data:"x"}` · `getModels()` · each resolves `{kind:"unavailable", reason}`; never rejects (test-plan #E27)
- [x] 2.4 Test malformed rows are skipped: 200 `data:[{id:"g/x"},{provider:"d"},{id:"d/y",provider:"d"}]` · `getModels()` · `kind:"ok"` with `[g/x, d/y]` only (test-plan #X3)
- [x] 2.5 Implement `getModels()` in `packages/blackhole-plugin/src/client/blackhole-api.ts` per design D1 (exact-match write direction documented on the helper); verify 2.1–2.4 pass.

## 3. ChainEditor — L1, see `packages/blackhole-plugin/src/client/__tests__/ChainEditor.test.tsx` (existing E18–E21, F1–F5 stay green)

- [x] 3.1 Test exact-match pick with slash id: registry has `openrouter/meta/llama-3` and `openrouter/meta`; entry 0 expanded · primitive `onSelect("openrouter/meta/llama-3")` · `onChange` entry 0 = `{provider:"openrouter", id:"meta/llama-3"}` (test-plan #E10)
- [x] 3.2 Test level clamp: entry row `reasoning:true`, override enabled · render · level primitive `supportedLevels` deep-equals the six blackhole levels, never `max` (test-plan #E11)
- [x] 3.3 Test non-reasoning row: `reasoning:false`, override enabled · render · `supportedLevels: ["off"]` (test-plan #E12)
- [x] 3.4 Test inherit vs `off`: entry without `thinking` · render, enable override, disable override · unchecked + no primitive + "inherit" text; then `thinking:"off"` with primitive `current:"off"`; then no `thinking` key (test-plan #E13)
- [x] 3.5 Test pick clears `contextWindow`: entry `{a/b, contextWindow:200000, cooldownHours:2, thinking:"high"}`, new row reasoning · pick `c/d` · `{provider:"c", id:"d", cooldownHours:2, thinking:"high"}` (test-plan #E22)
- [x] 3.6 Test level drop: entry `thinking:"high"`, new row `reasoning:false` · pick · no `thinking`, override unchecked, `blackhole-chain-<worker>-<i>-level-drop` visible naming the dropped level (test-plan #E23)
- [x] 3.7 Test `off` survives a non-reasoning pick: entry `thinking:"off"`, new row `reasoning:false` · pick · `thinking:"off"` retained, no drop notice (test-plan #E24)
- [x] 3.8 Test add cancel: chain `[A]`, registry ok · activate add control then Escape/blur without pick · `onChange` never called, adding row unmounted (test-plan #E25)
- [x] 3.9 Test add appends `{provider,id}` only: chain `[A]` · add control → `onSelect("g/x-flash")` · `onChange([A, {provider:"g", id:"x-flash"}])`, adding row unmounted (test-plan #E26)
- [x] 3.10 Test registry `ok → unavailable` after Retry: first load ok, Retry fetch rejects · Retry · entries keep stored ids, picker no longer mounted (test-plan #X2)
- [x] 3.11 Implement in `packages/blackhole-plugin/src/client/ChainEditor.tsx` per design D2–D5: props `models`, `registry` (`pending|ok|empty|unavailable`), `onRetryRegistry`; model primitive mounted only in `ok` inside a labelled group, plain-text span otherwise; override-thinking checkbox + level primitive; add control + adding row; empty state `blackhole-chain-<worker>-empty`; remove free-text provider/id inputs. Verify 3.1–3.10 pass.

## 4. BlackholeSettings — L1, see `packages/blackhole-plugin/src/client/__tests__/BlackholeSettings.test.tsx` (mock `GET /api/models` in all four states)

- [x] 4.1 Test base model set: file without `model`, registry ok · base primitive `onSelect("g/x-flash")`, Save · PUT `model` = `{provider:"g", id:"x-flash"}`; every tail contains `x-flash` before Save (test-plan #E14)
- [x] 4.2 Test base model clear (file-set): file `model:{g/x}` · clear, Save · PUT `model: null`, passes `validateBlackholeConfig` (test-plan #E15)
- [x] 4.3 Test base model clear (never-set) is a no-op: file without `model` · clear · Save absent; payload has no `model` key (test-plan #E16)
- [x] 4.4 Test staged content: all chains empty, `debug:false`, `debugLog:false`, `observeAfterTokens:15000`; registry 2 flash rows · defaults, Save · PUT has the three `*Model` = first, `*FallbackModels` = `[second]`, `debug:true`, `debugLog:true`, no `observeAfterTokens` (test-plan #E17)
- [x] 4.5 Test staged not written: as 4.4 · defaults without Save · PUT never called, host save control rendered (test-plan #E18)
- [x] 4.6 Test no candidate: registry `[a/b-pro]` · render · defaults `disabled`, explanation names flash/haiku/mini, no confirm dialog on click (test-plan #E19)
- [x] 4.7 Test confirm matrix: (a) chains empty → no dialog, staged; (b) observer `[A]` → dialog; decline leaves draft byte-equal; confirm stages per 4.4 (test-plan #E20)
- [x] 4.8 Test fewer-than-3 copy: registry with one flash row · defaults · chain length 1 per worker; copy states fewer than three staged (test-plan #E21)
- [x] 4.9 Test PUT 400 surfaces server message: PUT mocked 400 `{error:"observerModel.thinking must be one of…"}` · Save · message shown, draft kept, Save still available (test-plan #X1)
- [x] 4.10 Test registry change before defaults click: ok at load, Retry returns `[]` · click defaults · button disabled after retry resolves, nothing staged (test-plan #X4)
- [x] 4.11 Implement in `packages/blackhole-plugin/src/client/BlackholeSettings.tsx` per design D2, D6, D7: registry fetch on mount + retry; base-model row above the chains with clear; recommended-defaults action with `ui:confirm-dialog` when any chain is non-empty; pass `models`/`registry`/`onRetryRegistry` to each `ChainEditor`. Verify 4.1–4.10 pass and existing BlackholeSettings tests stay green.

## 5. Copy + i18n

- [x] 5.1 Add `zh-CN`/`hu` keys (inline English fallback at call sites) for: add control, entry group label, override-thinking label, inherit text, level-drop notice, empty state, registry unavailable/empty messages, retry, base-model label/clear, defaults label/help/no-candidate/fewer-than-3/confirm text, "not listed?" copy; remove `mProvider`/`mModelId`. Parity check: `scripts/i18n-parity.mjs` reports zero missing keys and both removed keys absent (test-plan #E28)

## 6. Browser E2E — L3, extend `tests/e2e/blackhole-settings.spec.ts`; route `/api/models` as in `tests/e2e/settings-default-model-catalogue.spec.ts`

- [x] 6.1 Empty state renders: routed config without observer keys, registry ok · load · `blackhole-chain-observer-empty` visible mentioning base/session tail; add button named with "observer" in the a11y tree (test-plan #F2)
- [x] 6.2 Add to empty chain, keyboard-only: same setup · Tab to `Add model to observer chain`, Enter, pick `x-flash` · empty state gone, one row with `g/x-flash`, Save bar present (test-plan #F1)
- [x] 6.3 No free-text inputs: routed observer `[A]`, registry ok · expand entry · no `textbox` named Provider/Model ID; picker `button` inside a `group` named with "observer" and "1" (test-plan #F3)
- [x] 6.4 Off-registry entry preserved: routed observer `[legacy/gone]`, registry without it · load, keyboard reorder, reload · trigger text `legacy/gone` throughout; move/remove enabled per position (test-plan #F4)
- [x] 6.5 Registry 503: routed observer `[A,B]`, `/api/models` 503 · load · stored ids as plain text, no picker button; add/base/defaults `disabled`; message + Retry; move-down on `A` still reorders (test-plan #F5)
- [x] 6.6 Retry converges: as 6.5 then re-route to 200 · click Retry · message gone, add enabled, picker triggers rendered, exactly one extra `/api/models` request (test-plan #F6)
- [x] 6.7 Pending state: deferred `/api/models` response · load · controls disabled, no unavailable message; after release, controls enable without reload (test-plan #F7)
- [x] 6.8 Empty registry: 200 `data:[]` · load · controls disabled, "no credentialed models" message, no Retry button (test-plan #F8)
- [x] 6.9 Base model updates tails before Save: routed config without `model`, registry ok · pick `g/x-flash` · all three `blackhole-chain-<worker>-tail-base` contain `x-flash`; Save bar present; PUT route counter 0 (test-plan #F9)
- [x] 6.10 Defaults confirm flow: routed observer `[A]`, registry 2 flash rows · defaults + Escape; defaults + confirm · after Escape `[A]` and no Save bar; after confirm rows show both flash ids and Save bar present (test-plan #F10)
- [x] 6.11 Add flow keyboard focus: as 6.2, no mouse · complete the add · focus stays within the chain region (new entry trigger or add button), not on body (test-plan #F11)

## 7. Verification, docs, review

- [x] 7.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm zero failures for `packages/blackhole-plugin`; run `npm run quality:changed` and fix Biome findings.
- [x] 7.2 Manual: build + restart, open `/settings/plugins/blackhole` on the live instance, stage recommended defaults, Save, and confirm `~/.pi/agent/pi-blackhole/pi-blackhole-config.json` gains observer/reflector/dropper chains + `debug`/`debugLog` while preserving unmanaged keys.
- [x] 7.3 Manual visual pass on picker density and alignment against the roles page across themes (test-plan: manual-only)
- [x] 7.4 Update rows in `packages/blackhole-plugin/src/client/AGENTS.md` (`ChainEditor.tsx`, `BlackholeSettings.tsx`, `blackhole-api.ts`, tests) and `packages/blackhole-plugin/src/shared/AGENTS.md` (`chain-model.ts`, test) with `See change: blackhole-model-picker-chains`; add the `tests/e2e/blackhole-settings.spec.ts.AGENTS.md` change note; refresh the package `README.md` "Model fallback chains" paragraph. Verify `kb dox lint` reports no stale/missing rows.
- [x] 7.5 Run `review-code` on the full diff before commit; record accepted follow-ups in this file.
